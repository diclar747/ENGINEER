import { prisma } from '../database/prisma';
import { ZeroKnowledgeSecurity } from '../security/zero-knowledge';
import { OcrAiService } from '../services/ocr-ai.service';
import { PaymentService } from '../services/payment.service';
import { BancardService } from '../services/bancard.service';
import { QrPdfService } from '../services/qr-pdf.service';
import { StorageService } from '../storage/storage.service';
import { NiroService } from '../services/niro.service';
import {
  Medication,
  parseMedications,
  mergeMedications,
  removeMedication,
  formatMedications,
  medicationConflicts,
} from '../services/medication.util';
import { AiPromptService, PromptScope } from '../services/ai-prompt.service';
import { MedicationReminderService } from '../services/medication-reminder.service';
import { EmailService } from '../services/email.service';
import { NlpHandler } from './nlp-handler';
import { config } from '../config';
import bcrypt from 'bcryptjs';

export interface InboundMessage {
  from: string; // Phone number e.g. "595981123456"
  body?: string;
  mediaBuffer?: Buffer;
  mediaMimeType?: string;
  mediaFilename?: string;
}

export interface BotResponse {
  replyText: string;
  mediaAttachment?: {
    buffer: Buffer;
    mimetype: string;
    filename: string;
    caption?: string;
    /** 'image' sends as an inline photo (e.g. payment QR); default 'document'. */
    kind?: 'image' | 'document';
  };
}


/** Decodes a `data:<mime>;base64,<...>` string (as produced by QRCode.toDataURL)
 *  into a BotResponse mediaAttachment ready to send as an inline image. */
function qrAttachment(dataUrl: string | undefined | null, caption: string): BotResponse['mediaAttachment'] | undefined {
  if (!dataUrl) return undefined;
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) return undefined;
  return { buffer: Buffer.from(m[2], 'base64'), mimetype: m[1], filename: 'pago-qr.png', caption, kind: 'image' };
}

/**
 * Consulta libre a la IA. El system prompt sale de /admin → IA (AiPromptService),
 * según el momento del usuario: PRE_REGISTRO (aún no registrado) o MIEMBRO_ACTIVO.
 */
async function askNiro(
  userText: string,
  opts: { name?: string; scope?: PromptScope } = {}
): Promise<string | null> {
  if (!NiroService.enabled || !userText || userText.trim().length < 4) return null;
  const system = await AiPromptService.getSystemPrompt(opts.scope || 'GENERAL');
  return NiroService.chat([
    { role: 'system', content: system + (opts.name ? ` El usuario se llama ${opts.name}.` : '') },
    { role: 'user', content: userText.trim() },
  ]);
}

/** Traduce por código de idioma explícito (ES/GN/PT/EN). PT/EN caen a ES si faltan. */
function trLang(l: string, m: { es: string; gn: string; pt?: string; en?: string }): string {
  switch ((l || 'ES').toUpperCase()) {
    case 'GN': return m.gn;
    case 'PT': return m.pt ?? m.es;
    case 'EN': return m.en ?? m.es;
    default: return m.es;
  }
}

/** minúsculas, sin acentos y sin signos al principio/fin — para comparar respuestas cortas. */
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim();
}

/** ¿La respuesta a una confirmación *[1]* Sí / *[2]* No es un "sí"?
 *  Tolera "1", "1 …", "si", "sí", "sip", "dale", "ok", "listo", "correcto",
 *  "confirmo", "continuar", "de acuerdo", un 👍 / ✅, y el texto del botón
 *  copiado ("[1] Sí, continuar ✅"). Antes solo `=== '1'` / includes('si') → un
 *  "Sí" con tilde o un "dale" caían al else y reiniciaban el paso (loop). */
function isAffirmative(text: string): boolean {
  const raw = (text || '').trim();
  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(raw) && /[\u{1F44D}\u{1F44C}✅\u{1F64C}]/u.test(raw)) {
    return true; // 👍 👌 ✅ 🙌 a secas
  }
  const t = norm(raw);
  if (!t) return false;
  if (/^2\b/.test(t) || /\bno\b/.test(t)) return false;
  return (
    /^1\b/.test(t) ||
    /\b(si|sisi|sip|sipi|sipe|dale|ok|oka|okey|okay|listo|correcto|correctos|correcta|correctas|confirmo|confirmar|confirmado|confirmados|continuar|continua|proceder|proseguir|acepto|aceptar|adelante|va|vale|bien|exacto|exactos|asi es|es correcto|son correctos|de acuerdo|deacuerdo|afirmativo|yes|claro|obvio|todo bien|esta bien)\b/.test(t)
  );
}

/** ¿Es un "no / corregir" explícito a la confirmación de datos? */
function isNegative(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  return (
    /^2\b/.test(t) ||
    /\b(no|nel|nop|corregir|corregi|corrige|corregilo|incorrecto|incorrectos|esta mal|estan mal|mal|equivocado|error|editar|cambiar|modificar|rehacer|de nuevo)\b/.test(t)
  );
}

/** Saludo / charla / audio sin datos ("buenos días", "hola", "probando"…). */
function isSmallTalk(text: string): boolean {
  const t = norm(text);
  if (!t) return true;
  return /^(hola+|ola|oi|ey+|hey|holis|buenas|buen[oa]s? (dias?|tardes?|noches?)|buen dia|que tal|qué tal|como (estas|andas|va)|todo bien|saludos|gracias|test|prueba|probando|probrando|ping|hello|hi+|estas ahi|hay alguien|start|empezar|iniciar)$/.test(t);
}

/** ¿El texto parece un nombre y apellido reales (no un saludo ni un número)? */
function looksLikeFullName(text: string): boolean {
  const t = (text || '').trim();
  if (!t || /\d/.test(t) || t.length < 5 || t.length > 60) return false;
  if (isSmallTalk(t) || isResetCmd(t) || isAffirmative(t) || isNegative(t)) return false;
  const words = t.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w));
  return words.length >= 2 && words.length <= 6;
}

// Condiciones médicas del Paso 6 — editables desde /admin (tabla MedicalConditionOption).
// Si la tabla está vacía o falla, se usa esta lista por defecto (incluye "Válvulas cardíacas").
type CondOpt = { code: string; labelEs: string; labelGn: string };
const DEFAULT_CONDITIONS: CondOpt[] = [
  { code: 'DIABETES', labelEs: 'Diabetes', labelGn: 'Diabetes' },
  { code: 'EPILEPSIA', labelEs: 'Epilepsia', labelGn: 'Epilepsia' },
  { code: 'HIPERTENSION', labelEs: 'Hipertensión Arterial', labelGn: 'Hipertensión' },
  { code: 'MARCAPASOS', labelEs: 'Marcapasos / Cardiopatía', labelGn: "Marcapasos / Ñe'ãrasy" },
  { code: 'VALVULAS', labelEs: 'Válvulas cardíacas', labelGn: 'Válvulas cardíacas' },
];
async function getConditionOptions(): Promise<CondOpt[]> {
  try {
    const rows = await prisma.medicalConditionOption.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
    // "Ninguna / Mba'eve" no es una condición: el bot agrega esa opción aparte.
    const filtered = rows.filter(
      (r) => !/ningun|mba.?eve|^none$/i.test(`${r.labelEs} ${r.labelGn} ${r.code}`)
    );
    if (filtered.length) {
      return filtered.map((r) => ({ code: r.code, labelEs: r.labelEs, labelGn: r.labelGn }));
    }
  } catch {
    /* tabla nueva / DB no disponible → fallback */
  }
  return DEFAULT_CONDITIONS;
}

/** Comando global disponible en CUALQUIER paso: volver a empezar / menú. */
function isResetCmd(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  return /^(reiniciar|reinicio|reiniciar todo|empezar de nuevo|empezar de cero|empezar de vuelta|volver a empezar|comenzar de nuevo|arrancar de nuevo|de nuevo|otra vez|start over|restart|reset|cancelar|salir|menu|menu principal|inicio|volver al inicio)$/.test(t);
}

/** Disparador global de recuperación de PIN. */
function isRecoverPinCmd(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  return /\b(recuperar pin|recupera pin|olvide mi pin|olvide el pin|olvide mi clave|perdi mi pin|perdi el pin|no recuerdo mi pin|resetear mi pin|recuperar mi pin|forgot my pin|reset my pin|recover pin|esqueci meu pin|esqueci minha senha|recuperar minha senha)\b/.test(t);
}

const OTP_TTL_MS = 10 * 60 * 1000;
/** Genera un código de 6 dígitos y lo persiste hasheado en OtpCode (key = phone o "email:<id>"). */
async function issueOtp(key: string): Promise<string> {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await prisma.otpCode.updateMany({
    where: { phoneNumber: key, purpose: 'PROFILE_CHANGE', consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.otpCode.create({
    data: {
      phoneNumber: key,
      codeHash: await bcrypt.hash(code, 10),
      purpose: 'PROFILE_CHANGE',
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  return code;
}
/** Verifica y consume un código. */
async function checkOtp(key: string, code: string): Promise<boolean> {
  const row = await prisma.otpCode.findFirst({
    where: { phoneNumber: key, purpose: 'PROFILE_CHANGE', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt.getTime() < Date.now()) return false;
  const ok = await bcrypt.compare(String(code || '').trim(), row.codeHash);
  await prisma.otpCode.update({
    where: { id: row.id },
    data: ok ? { consumedAt: new Date() } : { attempts: { increment: 1 } },
  });
  return ok;
}

export class BotStateMachine {
  /**
   * Main dispatch entry point for WhatsApp conversational engine
   */
  public static async handleMessage(msg: InboundMessage): Promise<BotResponse> {
    const rawPhone = msg.from.replace(/[^0-9]/g, '');
    const cleanText = (msg.body || '').trim();

    // 1. Fetch user or initialize placeholder
    let user = await prisma.user.findUnique({
      where: { phoneNumber: rawPhone },
      include: {
        emergencyContacts: true,
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    // Check if user doesn't exist
    if (!user) {
      user = await prisma.user.create({
        data: {
          phoneNumber: rawPhone,
          onboardingState: 'STEP1_WELCOME',
          status: 'PENDING_PAYMENT',
          language: 'ES',
        },
        include: {
          emergencyContacts: true,
          subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      return {
        replyText:
          `👋 *¡Hola! Bienvenido a Doorway Cortex Bio-Pass* — tu pasaporte médico de emergencia.\n` +
          `👋 *Mba'éichapa! Terereg̃uahẽ Doorway Cortex Bio-Pass-pe* — nde pasaporte médico emergencia-pegua.\n` +
          `👋 *Olá! Bem-vindo ao Doorway Cortex Bio-Pass* — seu passaporte médico de emergência.\n` +
          `👋 *Hi! Welcome to Doorway Cortex Bio-Pass* — your emergency medical passport.\n\n` +
          `⏱️ El registro dura menos de 3 minutos / O cadastro leva menos de 3 minutos / Takes under 3 minutes.\n\n` +
          `*Elegí tu idioma · Eiporavo nde ñe'ẽ · Escolha seu idioma · Choose your language:*\n` +
          `*[1]* Español 🇪🇸 / 🇵🇾\n` +
          `*[2]* Guaraní 🇵🇾\n` +
          `*[3]* Português 🇧🇷\n` +
          `*[4]* English 🇬🇧\n\n` +
          `_Respondé con 1, 2, 3 o 4._`,
      };
    }

    // Helper to get / save temporary onboarding buffer
    const getTempData = () => {
      try {
        return user?.onboardingData ? JSON.parse(user.onboardingData) : {};
      } catch {
        return {};
      }
    };

    const updateState = async (newState: string, extraData?: any, userUpdates?: any) => {
      const mergedData = { ...getTempData(), ...(extraData || {}) };
      await prisma.user.update({
        where: { id: user!.id },
        data: {
          onboardingState: newState,
          onboardingData: JSON.stringify(mergedData),
          ...(userUpdates || {}),
        },
      });
    };

    const state = user.onboardingState;

    // Idioma del usuario. `tr()` toma ES y GN siempre; PT/EN son opcionales y, si
    // falta la traducción de un texto puntual, cae a ES (nunca deja el mensaje vacío).
    const lang: 'es' | 'gn' | 'pt' | 'en' =
      user.language === 'GN' ? 'gn' : user.language === 'PT' ? 'pt' : user.language === 'EN' ? 'en' : 'es';
    const tr = (es: string, gn: string, pt?: string, en?: string) =>
      lang === 'gn' ? gn : lang === 'pt' ? pt ?? es : lang === 'en' ? en ?? es : es;

    // Comando global — funciona en CUALQUIER paso del registro: "reiniciar",
    // "empezar de nuevo", "volver a empezar", "menu", "cancelar", "de nuevo"…
    // Para un miembro ACTIVO no se borra nada: se lo lleva a su menú.
    if (isResetCmd(cleanText)) {
      if (user.status === 'ACTIVE') {
        // Miembro activo: no se toca su ficha. Se lo deja en el menú y el
        // siguiente mensaje ("menu"/cualquier cosa) muestra el menú real.
        await updateState('ACTIVE_MEMBER', {});
        return {
          replyText:
            `🔄 *Listo, volviste al menú principal.*\n\n` +
            `Escribí *MENU* para ver tus opciones, o directamente lo que querés hacer ` +
            `(ej: "subir estudio", "agregar medicación", "cambiar contacto").`,
        };
      }
      await updateState('STEP1_WELCOME', {});
      return {
        replyText:
          `🔄 *Empezamos de nuevo · Ñepyrũ jey · Recomeçar · Start over.*\n\n` +
          `*[1]* Español 🇪🇸  *[2]* Guaraní 🇵🇾  *[3]* Português 🇧🇷  *[4]* English 🇬🇧\n\n` +
          `_Escribí *REINICIAR* en cualquier momento para volver acá._`,
      };
    }

    // ==========================================
    // RECUPERACIÓN DE PIN (comando global)
    // ==========================================
    if (isRecoverPinCmd(cleanText) && !state.startsWith('RECOVER_PIN_')) {
      if (!user.pinHash) {
        return { replyText: tr(`Todavía no tenés un PIN configurado. Escribí *MENU* para registrarte.`, `Nderehai gueteri PIN. Ehai *MENU*.`, `Você ainda não tem um PIN. Escreva *MENU* para se cadastrar.`, `You don't have a PIN yet. Type *MENU* to register.`) };
      }
      if (!user.recoveryKeyHash) {
        return {
          replyText: tr(
            `Tu cuenta se creó antes de la Clave de Recuperación, así que este método no está disponible.\n` +
              `Escribí a *soporte@bio-pass.com* para un reseteo verificado por un administrador.`,
            `Nde cuenta oñemoheñói Clave de Recuperación mboyve. Ehai *soporte@bio-pass.com*.`,
            `Sua conta foi criada antes da Chave de Recuperação. Escreva para *soporte@bio-pass.com* para um reset verificado.`,
            `Your account predates the Recovery Key. Email *soporte@bio-pass.com* for an admin-verified reset.`
          ),
        };
      }
      const waCode = await issueOtp(rawPhone);
      // El OTP por email es la 2ª capa del PRD — solo si hay SMTP configurado y el
      // usuario tiene correo. Si no, se recupera con OTP de WhatsApp + selfie + Recovery Key.
      const useEmail = EmailService.enabled && !!user.email;
      let emailLine = '';
      if (useEmail) {
        const emCode = await issueOtp(`email:${user.id}`);
        emailLine = tr(
          `\n📧 Te enviamos otro código a *${user.email}*.`,
          `\n📧 Romondo ambue código *${user.email}* -pe.`,
          `\n📧 Enviamos outro código para *${user.email}*.`,
          `\n📧 We sent another code to *${user.email}*.`
        );
        EmailService.send({
          to: user.email!,
          subject: 'Bio-Pass — Código de recuperación de PIN',
          template: 'generic',
          html: `<p>Tu código de recuperación de PIN es:</p><h2 style="letter-spacing:4px">${emCode}</h2><p>Vence en 10 minutos. Si no lo pediste, ignorá este correo.</p>`,
        }).catch((e) => console.error('[recover] email OTP failed:', e?.message));
      }
      await updateState('RECOVER_PIN_OTP', { recStartedAt: Date.now(), recHasEmail: useEmail });
      return {
        replyText: tr(
          `🔓 *Recuperación de PIN*\n\n` +
            `Código por WhatsApp: *${waCode}*` + emailLine + `\n\n` +
            (useEmail
              ? `Respondé con *los dos códigos* separados por espacio (ej: 123456 654321).`
              : `Respondé con ese código.`) +
            `\n\nEscribí *CANCELAR* para salir.`,
          `🔓 *PIN Recuperación*\n\nCódigo WhatsApp rupive: *${waCode}*` + emailLine + `\n\n` +
            (useEmail ? `Embohovái *mokõive código* espacio-pe.` : `Embohovái upe código.`) + `\n\n*CANCELAR* resei hag̃ua.`,
          `🔓 *Recuperação de PIN*\n\nCódigo por WhatsApp: *${waCode}*` + emailLine + `\n\n` +
            (useEmail ? `Responda com *os dois códigos* separados por espaço (ex: 123456 654321).` : `Responda com esse código.`) +
            `\n\nEscreva *CANCELAR* para sair.`,
          `🔓 *PIN Recovery*\n\nWhatsApp code: *${waCode}*` + emailLine + `\n\n` +
            (useEmail ? `Reply with *both codes* separated by a space (e.g. 123456 654321).` : `Reply with that code.`) +
            `\n\nType *CANCEL* to exit.`
        ),
      };
    }

    if (state === 'RECOVER_PIN_OTP') {
      if (/^(cancelar|cancel|salir)$/.test(norm(cleanText))) {
        await updateState(user.status === 'ACTIVE' ? 'ACTIVE_MEMBER' : 'STEP1_WELCOME', {});
        return { replyText: tr(`Recuperación cancelada.`, `Recuperación oñemboyke.`, `Recuperação cancelada.`, `Recovery cancelled.`) };
      }
      const tmp = getTempData();
      const codes = (cleanText.match(/\d{4,8}/g) || []);
      const okWa = codes[0] ? await checkOtp(rawPhone, codes[0]) : false;
      const okEmail = tmp.recHasEmail ? (codes[1] ? await checkOtp(`email:${user.id}`, codes[1]) : false) : true;
      if (!okWa || !okEmail) {
        return {
          replyText: tr(
            `Códigos incorrectos o vencidos. Reintentá, o escribí *RECUPERAR PIN* para pedir nuevos.`,
            `Código ndoikói. Eha'ã jey térã ehai *RECUPERAR PIN*.`,
            `Códigos incorretos ou vencidos. Tente de novo ou escreva *RECUPERAR PIN* para novos.`,
            `Wrong or expired codes. Try again, or type *RECOVER PIN* for new ones.`
          ),
        };
      }
      await updateState('RECOVER_PIN_SELFIE', {});
      return {
        replyText: tr(
          `✅ Códigos verificados.\n\n📸 Ahora mandá una *selfie sosteniendo tu cédula* junto a un papel con la *fecha de hoy* escrita a mano.`,
          `✅ Código oĩporã.\n\n📸 Emondo peteĩ *selfie nde cédula reheve* ha peteĩ kuatia ko ára árape ojehai.`,
          `✅ Códigos verificados.\n\n📸 Agora envie uma *selfie segurando seu documento* junto a um papel com a *data de hoje* escrita à mão.`,
          `✅ Codes verified.\n\n📸 Now send a *selfie holding your ID* next to a paper with *today's date* handwritten.`
        ),
      };
    }

    if (state === 'RECOVER_PIN_SELFIE') {
      if (!msg.mediaBuffer) {
        return { replyText: tr(`Necesito la *foto (selfie con cédula y papel fechado)* para continuar.`, `Aikotevẽ pe *ta'anga* rehóvo.`, `Preciso da *foto (selfie com documento e papel datado)* para continuar.`, `I need the *photo (selfie with ID and dated paper)* to continue.`) };
      }
      const saved = await StorageService.saveFile('recovery_selfies', `rec_${user.id}_${Date.now()}.jpg`, msg.mediaBuffer);
      await updateState('RECOVER_PIN_KEY', { recSelfieUrl: saved.fileUrl });
      return {
        replyText: tr(
          `✅ Selfie recibida (queda para auditoría).\n\n🗝️ Ingresá tu *Clave de Recuperación de 16 caracteres* (con o sin guiones).`,
          `✅ Selfie og̃uahẽ.\n\n🗝️ Emoĩ nde *Clave de Recuperación 16 caracteres*.`,
          `✅ Selfie recebida (fica para auditoria).\n\n🗝️ Digite sua *Chave de Recuperação de 16 caracteres* (com ou sem hífens).`,
          `✅ Selfie received (kept for audit).\n\n🗝️ Enter your *16-character Recovery Key* (with or without dashes).`
        ),
      };
    }

    if (state === 'RECOVER_PIN_KEY') {
      const rk = ZeroKnowledgeSecurity.normalizeRecoveryKey(cleanText);
      if (rk.length !== 16) {
        return { replyText: tr(`La clave tiene *16 caracteres*. Revisá e ingresala de nuevo.`, `Clave oguereko *16 caracteres*.`, `A chave tem *16 caracteres*. Verifique e digite de novo.`, `The key has *16 characters*. Check and re-enter it.`) };
      }
      const match = user.recoveryKeyHash ? await bcrypt.compare(rk, user.recoveryKeyHash) : false;
      if (!match) {
        return { replyText: tr(`Esa Clave de Recuperación no coincide. Verificá que sea la que anotaste en el registro.`, `Ko clave ndoikói.`, `Essa Chave de Recuperação não confere. Verifique se é a que você anotou no cadastro.`, `That Recovery Key doesn't match. Make sure it's the one you saved at registration.`) };
      }
      await updateState('RECOVER_PIN_NEWPIN', { recKey: rk });
      return {
        replyText: tr(
          `✅ *Clave verificada.*\n\n🔐 Creá tu *PIN nuevo de 4 dígitos*.`,
          `✅ *Clave oĩporã.*\n\n🔐 Emoheñói *PIN pyahu 4 papapýgui*.`,
          `✅ *Chave verificada.*\n\n🔐 Crie seu *novo PIN de 4 dígitos*.`,
          `✅ *Key verified.*\n\n🔐 Create your *new 4-digit PIN*.`
        ),
      };
    }

    if (state === 'RECOVER_PIN_NEWPIN') {
      const m = cleanText.match(/\b\d{4}\b/);
      if (!m) {
        return { replyText: tr(`El PIN nuevo debe tener *4 dígitos*.`, `PIN pyahu oguerekova'erã *4 papapy*.`, `O novo PIN deve ter *4 dígitos*.`, `The new PIN must be *4 digits*.`) };
      }
      const newPin = m[0];
      const tmp = getTempData();
      const rk: string = tmp.recKey || '';
      let oldPin: string | null = null;
      try {
        const shards = await prisma.recoveryShard.findMany({
          where: { userId: user.id },
          orderBy: { shardIndex: 'asc' },
        });
        const sealed = shards.map((s) => s.shardData).join('');
        if (sealed && user.encryptionSalt) {
          oldPin = ZeroKnowledgeSecurity.openWithRecoveryKey(sealed, rk, user.encryptionSalt);
        }
      } catch (e: any) {
        console.error('[recover] no se pudo abrir el envelope:', e?.message);
      }

      const newSalt = ZeroKnowledgeSecurity.generateSalt(16);
      let newBlob: string;
      try {
        const plain =
          oldPin && user.encryptedMedicalBlob && user.encryptionSalt
            ? ZeroKnowledgeSecurity.decryptWithPin(user.encryptedMedicalBlob, oldPin, user.encryptionSalt)
            : { fullName: user.fullName, recoveredAt: new Date().toISOString(), consultationHistory: [] };
        newBlob = ZeroKnowledgeSecurity.encryptWithPin(plain, newPin, newSalt);
      } catch (e: any) {
        console.error('[recover] blob no recuperable, se crea uno nuevo:', e?.message);
        newBlob = ZeroKnowledgeSecurity.encryptWithPin(
          { fullName: user.fullName, recoveredAt: new Date().toISOString(), blobResetOnRecovery: true, consultationHistory: [] },
          newPin,
          newSalt
        );
      }

      const newPinHash = await ZeroKnowledgeSecurity.hashPin(newPin);
      const resealed = ZeroKnowledgeSecurity.sealWithRecoveryKey(newPin, rk, newSalt);
      const mid = Math.ceil(resealed.length / 2);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          pinHash: newPinHash,
          encryptionSalt: newSalt,
          encryptedMedicalBlob: newBlob,
          webVaultInitialized: false,
          failedPinAttempts: 0,
          pinLockedUntil: null,
          onboardingState: user.status === 'ACTIVE' ? 'ACTIVE_MEMBER' : 'STEP8_PAYMENT',
          onboardingData: null,
        },
      });
      await prisma.recoveryShard.deleteMany({ where: { userId: user.id } });
      await prisma.recoveryShard.createMany({
        data: [
          { userId: user.id, shardIndex: 0, shardData: resealed.slice(0, mid) },
          { userId: user.id, shardIndex: 1, shardData: resealed.slice(mid) },
        ],
      });

      return {
        replyText: tr(
          `✅ *PIN restablecido.*\n\nYa podés usar tu nuevo PIN de 4 dígitos en la web y para desbloquear tu ficha.\n\n_Escribí *MENU* para ver tus opciones._`,
          `✅ *PIN oñemoambue.*\n\nIkatúma reiporu nde PIN pyahu.\n\n_Ehai *MENU*._`,
          `✅ *PIN redefinido.*\n\nJá pode usar seu novo PIN de 4 dígitos na web e para desbloquear sua ficha.\n\n_Escreva *MENU* para ver as opções._`,
          `✅ *PIN reset.*\n\nYou can now use your new 4-digit PIN on the web and to unlock your card.\n\n_Type *MENU* to see your options._`
        ),
      };
    }

    // ==========================================
    // ONBOARDING FLOW (100% SELF-SERVICE)
    // ==========================================

    // STEP 1: WELCOME & LANGUAGE
    if (state === 'STEP1_WELCOME' || state === 'UNREGISTERED') {
      const c = norm(cleanText);
      // [1] ES · [2] GN · [3] PT · [4] EN
      const dbLang: 'ES' | 'GN' | 'PT' | 'EN' =
        c === '2' || c.includes('guarani') ? 'GN'
        : c === '3' || c.includes('portug') || c.includes('brasil') ? 'PT'
        : c === '4' || c.includes('ingl') || c.includes('english') ? 'EN'
        : 'ES';
      await updateState('STEP1B_TERMS', { language: dbLang }, { language: dbLang });

      const termsUrl = `${config.baseUrl}/api/legal/terminos`;
      const idiomaMsg =
        dbLang === 'GN' ? "✅ *Ñe'ẽ: Guaraní.*"
        : dbLang === 'PT' ? '✅ *Idioma: Português.*'
        : dbLang === 'EN' ? '✅ *Language: English.*'
        : '✅ *Idioma: Español.*';

      return {
        replyText:
          `${idiomaMsg}\n\n` +
          trLang(dbLang, {
            es:
              `📄 *Términos y Condiciones*\n` +
              `Antes de empezar, leé y aceptá nuestros Términos:\n${termsUrl}\n\n` +
              `Respondé *ACEPTO* para continuar.`,
            gn:
              `📄 *Términos ha Condiciones*\n` +
              `Eñepyrũ mboyve, emoñe'ẽ ha eñemoneĩ ore Términos:\n${termsUrl}\n\n` +
              `Embohovái *ACEPTO* rehóvo.`,
            pt:
              `📄 *Termos e Condições*\n` +
              `Antes de começar, leia e aceite nossos Termos:\n${termsUrl}\n\n` +
              `Responda *ACEITO* para continuar.`,
            en:
              `📄 *Terms & Conditions*\n` +
              `Before we start, please read and accept our Terms:\n${termsUrl}\n\n` +
              `Reply *I ACCEPT* to continue.`,
          }),
      };
    }

    // STEP 1B: TERMS & CONDITIONS ACCEPTANCE (check obligatorio del PRD)
    if (state === 'STEP1B_TERMS') {
      const t = norm(cleanText);
      const accepted = /\b(acepto|aceito|i accept|accept|de acuerdo|si acepto|sim aceito|yes)\b/.test(t) || t === '1';
      if (!accepted) {
        const termsUrl = `${config.baseUrl}/api/legal/terminos`;
        return {
          replyText: tr(
            `Para usar Bio-Pass necesitás aceptar los Términos:\n${termsUrl}\n\nRespondé *ACEPTO* para continuar.`,
            `Reiporu hag̃ua Bio-Pass eñemoneĩ va'erã Términos:\n${termsUrl}\n\nEmbohovái *ACEPTO*.`,
            `Para usar o Bio-Pass você precisa aceitar os Termos:\n${termsUrl}\n\nResponda *ACEITO* para continuar.`,
            `To use Bio-Pass you must accept the Terms:\n${termsUrl}\n\nReply *I ACCEPT* to continue.`
          ),
        };
      }
      await updateState('STEP2_DOCUMENT', {}, { termsAcceptedAt: new Date() });
      return {
        replyText: tr(
          `✅ *Términos aceptados.*\n\n` +
            `📸 *Paso 2/9 (Documento de Identidad):*\n` +
            `Enviá una *foto NÍTIDA de tu Cédula / Documento de Identidad* (frente y dorso). ` +
            `De ahí leemos tu nombre, número, fecha y lugar de nacimiento.`,
          `✅ *Términos oñeñemoneĩ.*\n\n` +
            `📸 *Paso 2/9 (Cédula):*\n` +
            `Emondo *ta'anga potĩ nde Cédula rehegua* (henondépe ha ijatukupépe). Upégui rolee opa nde mba'ekuaa.`,
          `✅ *Termos aceitos.*\n\n` +
            `📸 *Passo 2/9 (Documento de Identidade):*\n` +
            `Envie uma *foto NÍTIDA do seu documento* (frente e verso). ` +
            `Daí lemos seu nome, número, data e local de nascimento.`,
          `✅ *Terms accepted.*\n\n` +
            `📸 *Step 2/9 (ID Document):*\n` +
            `Send a *clear photo of your ID* (front and back). ` +
            `We'll read your name, number, date and place of birth from it.`
        ),
      };
    }

    // STEP 2: DOCUMENT UPLOAD & OCR
    if (state === 'STEP2_DOCUMENT') {
      // Se acumula entre varias fotos (frente + dorso) y entre foto + texto/audio:
      // nunca se pisa un dato bueno con uno vacío.
      const prev = getTempData();
      let extractedName = (prev.extractedName || '').trim();
      let extractedCi = (prev.extractedCi || '').trim();
      let ciPhotoUrl = (prev.ciPhotoUrl || '').trim();
      let extractedDob = (prev.extractedDob || '').trim();
      let extractedBirthPlace = (prev.extractedBirthPlace || '').trim();
      let extractedSex = (prev.extractedSex || '').trim();
      const keepBest = (cur: string, next?: string) => (next && next.trim() ? next.trim() : cur);

      if (msg.mediaBuffer) {
        const saved = await StorageService.saveFile('ci_documents', `ci_${user.id}_${Date.now()}.jpg`, msg.mediaBuffer);
        // El frente suele tener la foto/nombre; el dorso, más datos. Se guarda el primero como principal.
        ciPhotoUrl = ciPhotoUrl || saved.fileUrl;
        const ocrResult = await OcrAiService.processCiImage(msg.mediaBuffer, msg.mediaFilename || 'ci.jpg');
        extractedName = keepBest(extractedName, ocrResult.fullName);
        extractedCi = keepBest(extractedCi, (ocrResult.ciNumber || '').replace(/[^0-9]/g, ''));
        extractedDob = keepBest(extractedDob, ocrResult.dateOfBirth);
        extractedBirthPlace = keepBest(extractedBirthPlace, ocrResult.birthPlace);
        extractedSex = keepBest(extractedSex, ocrResult.sex);
      } else if (cleanText) {
        // Texto tecleado o transcripto de audio ("me llamo Carlos Benítez, cédula 3.500.200").
        // Primero la IA de Niro; si falla, el split simple por coma.
        const ai = await NiroService.extractFields(
          cleanText,
          'De este texto de una persona registrándose, extraé: fullName (nombre y apellidos completos, como los diría en una cédula) y ciNumber (número de cédula, SOLO dígitos, sin puntos).'
        );
        if (ai?.fullName) extractedName = keepBest(extractedName, String(ai.fullName));
        if (ai?.ciNumber) extractedCi = keepBest(extractedCi, String(ai.ciNumber).replace(/[^0-9]/g, ''));
        if (!extractedName || !extractedCi) {
          const parts = cleanText.split(/[,:;]/);
          const digitRun = (cleanText.match(/\d[\d.\s]{5,}\d/) || [])[0];
          if (parts.length >= 2 && parts[0].trim()) {
            extractedName = keepBest(extractedName, parts[0]);
            extractedCi = keepBest(extractedCi, parts.slice(1).join(' ').replace(/[^0-9]/g, ''));
          } else if (digitRun && !extractedCi) {
            // Mandaron solo el número de cédula.
            extractedCi = keepBest(extractedCi, digitRun.replace(/[^0-9]/g, ''));
          } else if (!extractedName && !ai?.fullName && !ai?.ciNumber && looksLikeFullName(cleanText)) {
            extractedName = cleanText.trim();
          } else if (!ai?.fullName && !ai?.ciNumber && !digitRun) {
            // Saludo / audio de charla / texto sin datos → NO se guarda como nombre.
            // Se le vuelve a pedir la foto de la cédula (no se toca el buffer).
            await updateState('STEP2_DOCUMENT', { extractedName, extractedCi, ciPhotoUrl, extractedDob, extractedBirthPlace, extractedSex });
            return {
              replyText:
                `📸 Para el *Paso 2* necesito una *foto de tu cédula* (frente y dorso). ` +
                `De ahí saco tu nombre y número automáticamente.\n\n` +
                `_Si preferís tipear: *Nombre y Apellido, Número de cédula* — ej: Carlos Benítez, 3500200_`,
            };
          }
        }
      }

      // Todavía falta algo — guardá lo que haya y pedí solo lo que falta.
      if (!extractedName || !extractedCi) {
        await updateState('STEP2_DOCUMENT', { extractedName, extractedCi, ciPhotoUrl, extractedDob, extractedBirthPlace, extractedSex });
        const falta = !extractedName && !extractedCi ? 'tu nombre y tu número de cédula' : !extractedName ? 'tu nombre completo' : 'tu número de cédula';
        return {
          replyText:
            `😕 No pude leer bien ${falta} de la foto.\n\n` +
            (extractedName ? `✅ Tengo: *${extractedName}*\n` : '') +
            (extractedCi ? `✅ Tengo cédula: *${extractedCi}*\n` : '') +
            `\n📸 Mandá una *foto más nítida de tu cédula* (bien iluminada, sin reflejos, que se lea todo). De ahí sacamos todos tus datos.\n` +
            `_Si la cámara falla, podés escribir tu nombre y número de cédula._`,
        };
      }

      await updateState('STEP2_CONFIRM_CI', {
        extractedName,
        extractedCi,
        ciPhotoUrl,
        extractedDob,
        extractedBirthPlace,
        extractedSex,
      });

      const extraLines = [
        extractedDob && `🎂 *Fecha de nacimiento:* ${extractedDob}`,
        extractedBirthPlace && `📍 *Lugar de nacimiento:* ${extractedBirthPlace}`,
        extractedSex && `⚧ *Sexo:* ${extractedSex}`,
      ].filter(Boolean).join('\n');

      return {
        replyText:
          `🔍 *Datos detectados automáticamente:*\n\n` +
          `👤 *Nombre:* ${extractedName}\n` +
          `🆔 *Cédula:* ${extractedCi}\n` +
          (extraLines ? `${extraLines}\n` : '') +
          `\n¿Son correctos?\n` +
          `*[1]* Sí, continuar ✅\n` +
          `*[2]* No — mandar otra foto de la cédula 📸`,
      };
    }

    // STEP 2 CONFIRMATION
    if (state === 'STEP2_CONFIRM_CI') {
      const tempData = getTempData();

      // "No / corregir" → se limpia el buffer y se pide OTRA FOTO de la cédula.
      // La foto trae todos los datos (nombre, Nº, fecha, lugar, sexo), así que no
      // se le hace volver a tipear nada.
      if (isNegative(cleanText)) {
        await updateState('STEP2_DOCUMENT', {
          extractedName: '',
          extractedCi: '',
          extractedDob: '',
          extractedBirthPlace: '',
          extractedSex: '',
        });
        return {
          replyText: tr(
            `📸 Ok, mandá de nuevo una *foto nítida de tu cédula* (frente y, si podés, dorso). De ahí leemos todos tus datos.`,
            `📸 Néi, emondo jey peteĩ *ta'anga potĩ nde cédula rehegua* (henondépe ha, ikatúramo, ijatukupépe). Upégui rolee opa nde mba'ekuaa.`
          ),
        };
      }

      // Respuesta que no es un "sí" claro NI un "no" claro: NO se reinicia el paso
      // (eso era un loop infinito "Datos detectados" ⇄ "escribí tu nombre"). Se
      // vuelve a mostrar la MISMA pregunta de confirmación.
      if (!isAffirmative(cleanText)) {
        return {
          replyText:
            `🔍 *Confirmá tus datos:*\n\n` +
            `👤 *Nombre:* ${tempData.extractedName || '—'}\n` +
            `🆔 *Cédula:* ${tempData.extractedCi || '—'}\n\n` +
            `Respondé *1* si son correctos, o *2* para corregirlos.`,
        };
      }

      await updateState('STEP3_CONTACT', {}, {
        fullName: tempData.extractedName,
        ciNumber: tempData.extractedCi,
        ciFrontUrl: tempData.ciPhotoUrl,
        dateOfBirth: tempData.extractedDob || undefined,
        birthPlace: tempData.extractedBirthPlace || undefined,
        sex: tempData.extractedSex || undefined,
      });

      return {
        replyText: tr(
          `✅ *Identidad registrada.*\n\n` +
            `🚨 *Paso 3/9 (Contacto de Emergencia):*\n` +
            `Escribí el nombre y teléfono de la persona a quien debemos avisar si te pasa algo.\n\n` +
            `_Ejemplo: María Pérez, 0981-123-456 (Madre)_`,
          `✅ *Nde identidad oñeguarda.*\n\n` +
            `🚨 *Paso 3/9 (Contacto de Emergencia):*\n` +
            `Ehai téra ha teléfono pe persóna romomarandúva'erãva oĩ ramo mba'e ndéve.\n\n` +
            `_Techapyrã: María Pérez, 0981-123-456 (Sy)_`,
          `✅ *Identidade registrada.*\n\n` +
            `🚨 *Passo 3/9 (Contato de Emergência):*\n` +
            `Escreva o nome e telefone da pessoa que devemos avisar se algo acontecer com você.\n\n` +
            `_Exemplo: Maria Pérez, 0981-123-456 (Mãe)_`,
          `✅ *Identity registered.*\n\n` +
            `🚨 *Step 3/9 (Emergency Contact):*\n` +
            `Type the name and phone of the person we should call if something happens to you.\n\n` +
            `_Example: Maria Perez, 0981-123-456 (Mother)_`
        ),
      };
    }

    // STEP 3: EMERGENCY CONTACT
    if (state === 'STEP3_CONTACT') {
      const contactParts = cleanText.split(/[,:\-]/);
      const contactName = contactParts[0]?.trim() || 'Contacto de Emergencia';
      const contactPhone = contactParts[1]?.trim() || '0981000000';
      const relationship = contactParts[2]?.trim() || 'Familiar';

      // Save emergency contact to database
      await prisma.emergencyContact.create({
        data: {
          userId: user.id,
          fullName: contactName,
          phoneNumber: contactPhone,
          relationship,
          isPrimary: true,
        },
      });

      await updateState('STEP4_ADDRESS', { contactName, contactPhone });

      return {
        replyText: tr(
          `✅ *Contacto de emergencia guardado:* ${contactName} (${contactPhone})\n\n` +
            `🏠 *Paso 4/9 (Domicilio):*\n` +
            `Escribe tu dirección exacta (calle, número de casa, barrio y ciudad).\n\n` +
            `_Ejemplo: Avda. Mariscal López 1234, Barrio Villa Morra, Asunción_`,
          `✅ *Nde contacto de emergencia oñeguarda:* ${contactName} (${contactPhone})\n\n` +
            `🏠 *Paso 4/9 (Nde róga renda):*\n` +
            `Ehai nde dirección exacta (calle, tapỹi papapy, barrio ha táva).\n\n` +
            `_Techapyrã: Avda. Mariscal López 1234, Barrio Villa Morra, Paraguay_`,
          `✅ *Contato de emergência salvo:* ${contactName} (${contactPhone})\n\n` +
            `🏠 *Passo 4/9 (Endereço):*\n` +
            `Escreva seu endereço exato (rua, número, bairro e cidade).\n\n` +
            `_Exemplo: Av. Mariscal López 1234, Villa Morra, Assunção_`,
          `✅ *Emergency contact saved:* ${contactName} (${contactPhone})\n\n` +
            `🏠 *Step 4/9 (Address):*\n` +
            `Type your exact address (street, house number, neighborhood and city).\n\n` +
            `_Example: Mariscal López Ave 1234, Villa Morra, Asunción_`
        ),
      };
    }

    // STEP 4: ADDRESS
    if (state === 'STEP4_ADDRESS') {
      await updateState('STEP5_EMAIL', { address: cleanText }, { address: cleanText });

      return {
        replyText: tr(
          `✅ *Domicilio registrado.*\n\n` +
            `📧 *Paso 5/9 (Correo Electrónico):*\n` +
            `Ingresa tu correo electrónico para enviarte facturas, comprobantes y tu respaldo histórico.\n\n` +
            `_Ejemplo: usuario@correo.com_`,
          `✅ *Nde róga renda oñeguarda.*\n\n` +
            `📧 *Paso 5/9 (Correo Electrónico):*\n` +
            `Ehai nde correo electrónico romondo hagua ndéve factura, comprobante ha nde respaldo.\n\n` +
            `_Techapyrã: puruhára@correo.com_`,
          `✅ *Endereço registrado.*\n\n` +
            `📧 *Passo 5/9 (E-mail):*\n` +
            `Informe seu e-mail para enviarmos faturas, comprovantes e seu backup histórico.\n\n` +
            `_Exemplo: usuario@email.com_`,
          `✅ *Address registered.*\n\n` +
            `📧 *Step 5/9 (Email):*\n` +
            `Enter your email so we can send invoices, receipts and your historical backup.\n\n` +
            `_Example: user@email.com_`
        ),
      };
    }

    // STEP 5: EMAIL
    if (state === 'STEP5_EMAIL') {
      const opts = await getConditionOptions();
      const noneIdx = opts.length + 1;
      const listEs = opts.map((o, i) => `*[${i + 1}]* ${o.labelEs}`).join('\n') + `\n*[${noneIdx}]* Ninguna condición`;
      const listGn = opts.map((o, i) => `*[${i + 1}]* ${o.labelGn}`).join('\n') + `\n*[${noneIdx}]* Mba'eve`;

      await updateState(
        'STEP6_CONDITIONS',
        { email: cleanText, condLabels: opts.map((o) => o.labelEs), condNoneIdx: noneIdx },
        { email: cleanText }
      );

      return {
        replyText: tr(
          `✅ *Correo registrado:* ${cleanText}\n\n` +
            `🩺 *Paso 6/9 (Datos Médicos Críticos de Emergencia):*\n` +
            `Selecciona tus condiciones médicas preexistentes respondiendo con los números separados por coma:\n\n` +
            `${listEs}\n\n` +
            `_Luego escribe también tus alergias severas (ej: "1, 3 - Alergia a Penicilina e Ibuprofeno")_`,
          `✅ *Nde correo oñeguarda:* ${cleanText}\n\n` +
            `🩺 *Paso 6/9 (Nde mba'asy oĩva - Emergencia):*\n` +
            `Eiporavo mba'asy reguerekóva, embohovái umi papapy coma rupive:\n\n` +
            `${listGn}\n\n` +
            `_Upéi ehai avei mba'épa nde alergia hatãva (techapyrã: "1, 3 - Alergia Penicilina ha Ibuprofeno")_`,
          `✅ *E-mail registrado:* ${cleanText}\n\n` +
            `🩺 *Passo 6/9 (Dados Médicos Críticos de Emergência):*\n` +
            `Selecione suas condições médicas preexistentes respondendo com os números separados por vírgula:\n\n` +
            `${listEs}\n\n` +
            `_Depois escreva também suas alergias graves (ex: "1, 3 - Alergia a Penicilina e Ibuprofeno")_`,
          `✅ *Email registered:* ${cleanText}\n\n` +
            `🩺 *Step 6/9 (Critical Emergency Medical Data):*\n` +
            `Select your pre-existing medical conditions by replying with the numbers separated by commas:\n\n` +
            `${listEs}\n\n` +
            `_Then also type your severe allergies (e.g. "1, 3 - Allergy to Penicillin and Ibuprofen")_`
        ),
      };
    }

    // STEP 6: MEDICAL CONDITIONS & ALLERGIES
    if (state === 'STEP6_CONDITIONS') {
      const tmp6 = getTempData();
      const condLabels: string[] = Array.isArray(tmp6.condLabels) && tmp6.condLabels.length
        ? tmp6.condLabels
        : DEFAULT_CONDITIONS.map((o) => o.labelEs);
      const noneIdx: number = tmp6.condNoneIdx || condLabels.length + 1;

      const picked = (cleanText.match(/\d+/g) || []).map(Number);
      const selectedConditions: string[] = [];
      for (const n of picked) {
        if (n >= 1 && n <= condLabels.length && !selectedConditions.includes(condLabels[n - 1])) {
          selectedConditions.push(condLabels[n - 1]);
        }
      }
      // Si marcó "Ninguna", se ignoran las demás.
      if (picked.includes(noneIdx)) selectedConditions.length = 0;

      // Extract allergy text (lo que no son números / separadores de la selección)
      let allergies = cleanText.replace(/[0-9,;\-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!allergies) allergies = 'Ninguna declarada';

      await updateState('STEP6B_BLOOD', { selectedConditions, allergies }, {
        emergencyConditions: JSON.stringify(selectedConditions),
        severeAllergies: allergies,
        contraindicatedMeds: allergies.toLowerCase().includes('penicilina') ? 'Penicilina, Betalactámicos' : 'Ninguno declarado',
      });

      return {
        replyText: tr(
          `✅ *Condiciones médicas y alergias registradas.*\n\n` +
            `🩸 *Paso 7/9 (Grupo Sanguíneo / RH):*\n` +
            `Elegí tu grupo:\n*[1]* O+  *[2]* O−  *[3]* A+  *[4]* A−\n*[5]* B+  *[6]* B−  *[7]* AB+  *[8]* AB−\n*[9]* No lo sé`,
          `✅ *Nde mba'asy ha alergia oñeguarda.*\n\n` +
            `🩸 *Paso 7/9 (Nde ruguy grupo / RH):*\n` +
            `Eiporavo:\n*[1]* O+  *[2]* O−  *[3]* A+  *[4]* A−\n*[5]* B+  *[6]* B−  *[7]* AB+  *[8]* AB−\n*[9]* Ndaikuaái`,
          `✅ *Condições e alergias registradas.*\n\n` +
            `🩸 *Passo 7/9 (Tipo Sanguíneo / RH):*\n` +
            `Escolha:\n*[1]* O+  *[2]* O−  *[3]* A+  *[4]* A−\n*[5]* B+  *[6]* B−  *[7]* AB+  *[8]* AB−\n*[9]* Não sei`,
          `✅ *Conditions and allergies saved.*\n\n` +
            `🩸 *Step 7/9 (Blood Type / RH):*\n` +
            `Choose:\n*[1]* O+  *[2]* O−  *[3]* A+  *[4]* A−\n*[5]* B+  *[6]* B−  *[7]* AB+  *[8]* AB−\n*[9]* I don't know`
        ),
      };
    }

    // STEP 6B: BLOOD TYPE / RH
    if (state === 'STEP6B_BLOOD') {
      const RH = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
      const t = norm(cleanText).toUpperCase().replace(/\s+/g, '');
      let bloodType: string | null = null;
      const n = parseInt(cleanText.trim(), 10);
      if (n >= 1 && n <= 8) bloodType = RH[n - 1];
      else if (n === 9) bloodType = null;
      else {
        const m = t.match(/^(AB|A|B|O)\s*(\+|-|POS|NEG|POSITIVO|NEGATIVO)?$/);
        if (m) {
          const sign = /(-|NEG)/.test(m[2] || '') ? '-' : '+';
          bloodType = `${m[1]}${sign}`;
        }
      }
      if (!bloodType && n !== 9) {
        return {
          replyText: tr(
            `Elegí un número del *1 al 9* para tu grupo sanguíneo (9 = no lo sé).`,
            `Eiporavo peteĩ papapy *1 guive 9 peve* (9 = ndaikuaái).`,
            `Escolha um número de *1 a 9* para o tipo sanguíneo (9 = não sei).`,
            `Pick a number from *1 to 9* for your blood type (9 = I don't know).`
          ),
        };
      }

      await updateState('STEP7_PIN', { bloodType }, { bloodType: bloodType || undefined });
      return {
        replyText: tr(
          `✅ *Grupo sanguíneo:* ${bloodType || 'sin especificar'}\n\n` +
            `🔐 *Paso 8/9 (PIN de Seguridad Zero-Knowledge):*\n` +
            `Creá un *PIN secreto de 4 dígitos* (Ej: 8492).\n\n` +
            `🛡️ *Importante:* este PIN es tu llave privada. Nadie —ni los administradores— puede ver tus estudios sin él.`,
          `✅ *Nde ruguy grupo:* ${bloodType || "ndaikuaái"}\n\n` +
            `🔐 *Paso 8/9 (PIN Seguridad Zero-Knowledge):*\n` +
            `Emoheñói peteĩ *PIN ñemi 4 papapýgui* (Techapyrã: 8492).\n\n` +
            `🛡️ *Iñimportánteva:* ko PIN ha'e nde llave privada.`,
          `✅ *Tipo sanguíneo:* ${bloodType || 'não especificado'}\n\n` +
            `🔐 *Passo 8/9 (PIN de Segurança Zero-Knowledge):*\n` +
            `Crie um *PIN secreto de 4 dígitos* (Ex: 8492).\n\n` +
            `🛡️ *Importante:* este PIN é sua chave privada. Ninguém — nem os administradores — vê seus exames sem ele.`,
          `✅ *Blood type:* ${bloodType || 'not specified'}\n\n` +
            `🔐 *Step 8/9 (Zero-Knowledge Security PIN):*\n` +
            `Create a *secret 4-digit PIN* (e.g. 8492).\n\n` +
            `🛡️ *Important:* this PIN is your private key. Nobody — not even admins — can see your studies without it.`
        ),
      };
    }

    // STEP 7: SECURITY PIN (ZERO KNOWLEDGE DERIVATION)
    // RESET DE PIN (lo activa un admin desde el panel). Solo captura un PIN nuevo, reinicia
    // la bóveda cifrada y devuelve al usuario a su menú — sin volver a pedir pago ni cambiar estado.
    if (state === 'RESET_PIN') {
      const m = cleanText.match(/\b\d{4}\b/);
      if (!m) {
        return { replyText: `🔒 *Restablecé tu PIN de Bio-Pass.*\n\nIngresá un *PIN nuevo de 4 dígitos* (Ej: 1234):` };
      }
      const pin = m[0];
      const salt = ZeroKnowledgeSecurity.generateSalt(16);
      const pinHash = await ZeroKnowledgeSecurity.hashPin(pin);
      const blob = ZeroKnowledgeSecurity.encryptWithPin(
        { fullName: user.fullName, pinResetAt: new Date().toISOString(), consultationHistory: [] },
        pin,
        salt
      );
      await prisma.user.update({
        where: { id: user.id },
        data: {
          pinHash,
          encryptionSalt: salt,
          encryptedMedicalBlob: blob,
          webVaultInitialized: false,
          failedPinAttempts: 0,
          pinLockedUntil: null,
          onboardingState: user.status === 'ACTIVE' ? 'ACTIVE_MEMBER' : 'STEP8_PAYMENT',
        },
      });
      return {
        replyText:
          `✅ *PIN actualizado.*\n\n` +
          `Tu nuevo PIN de 4 dígitos ya quedó activo. Usalo para entrar a la web y para desbloquear tu ficha médica.\n\n` +
          `_Escribí *MENU* para ver tus opciones._`,
      };
    }

    if (state === 'STEP7_PIN') {
      const pinMatch = cleanText.match(/\b\d{4}\b/);
      if (!pinMatch) {
        return {
          replyText: tr(
            `⚠️ *El PIN debe tener exactamente 4 números.* Ingresá tu PIN de 4 dígitos (Ej: 1234):`,
            `⚠️ *PIN oguerekova'erã 4 papapy.* Ehai nde PIN 4 papapýgui (Techapyrã: 1234):`
          ),
        };
      }

      const pin = pinMatch[0];
      const salt = ZeroKnowledgeSecurity.generateSalt(16);
      const pinHash = await ZeroKnowledgeSecurity.hashPin(pin);

      // Create initial encrypted medical payload
      const initialEncryptedBlob = ZeroKnowledgeSecurity.encryptWithPin(
        {
          fullName: user.fullName,
          createdViaBot: true,
          initialRegistrationDate: new Date().toISOString(),
          consultationHistory: [],
        },
        pin,
        salt
      );

      // Recovery Key de 16 — se muestra UNA vez. Guardamos: hash (verificación) y el
      // "envelope" del PIN cifrado con la clave, partido en 2 filas RecoveryShard.
      const recoveryKey = ZeroKnowledgeSecurity.generateRecoveryKey();
      const recoveryKeyHash = await ZeroKnowledgeSecurity.hashPin(
        ZeroKnowledgeSecurity.normalizeRecoveryKey(recoveryKey)
      );
      const sealed = ZeroKnowledgeSecurity.sealWithRecoveryKey(pin, recoveryKey, salt);
      const mid = Math.ceil(sealed.length / 2);

      await updateState('STEP7B_RECOVERY', { pinSet: true }, {
        pinHash,
        encryptionSalt: salt,
        encryptedMedicalBlob: initialEncryptedBlob,
        recoveryKeyHash,
      });
      await prisma.recoveryShard.deleteMany({ where: { userId: user.id } });
      await prisma.recoveryShard.createMany({
        data: [
          { userId: user.id, shardIndex: 0, shardData: sealed.slice(0, mid) },
          { userId: user.id, shardIndex: 1, shardData: sealed.slice(mid) },
        ],
      });

      return {
        replyText: tr(
          `🔒 *¡PIN cifrado con éxito!*\n\n` +
            `🗝️ *Paso 8B — Clave de Recuperación (MUY IMPORTANTE)*\n` +
            `Si algún día olvidás tu PIN, esta es la ÚNICA forma de recuperarlo:\n\n` +
            `\`${recoveryKey}\`\n\n` +
            `Anotala en un lugar seguro (papel, gestor de contraseñas). *No la guardes solo en este chat.*\n` +
            `Nadie de Bio-Pass puede verla ni regenerarla.\n\n` +
            `Cuando la tengas guardada, respondé *YA GUARDÉ MI CLAVE*.`,
          `🔒 *Nde PIN oñecifra porã!*\n\n` +
            `🗝️ *Paso 8B — Clave de Recuperación (TUICHA IMPORTANTE)*\n` +
            `Nde resaráiramo nde PIN, kóva ha'e pe único forma rerecupera hag̃ua:\n\n` +
            `\`${recoveryKey}\`\n\n` +
            `Ehai peteĩ hendápe segúrova. *Ani reñongatu ko chat-pe año.*\n\n` +
            `Reñongatu rire, embohovái *YA GUARDÉ MI CLAVE*.`,
          `🔒 *PIN criptografado com sucesso!*\n\n` +
            `🗝️ *Passo 8B — Chave de Recuperação (MUITO IMPORTANTE)*\n` +
            `Se um dia esquecer seu PIN, esta é a ÚNICA forma de recuperá-lo:\n\n` +
            `\`${recoveryKey}\`\n\n` +
            `Anote em local seguro (papel, gerenciador de senhas). *Não guarde só neste chat.*\n` +
            `Ninguém do Bio-Pass pode vê-la ou gerá-la de novo.\n\n` +
            `Quando tiver guardado, responda *JÁ GUARDEI MINHA CHAVE*.`,
          `🔒 *PIN encrypted successfully!*\n\n` +
            `🗝️ *Step 8B — Recovery Key (VERY IMPORTANT)*\n` +
            `If you ever forget your PIN, this is the ONLY way to recover it:\n\n` +
            `\`${recoveryKey}\`\n\n` +
            `Write it somewhere safe (paper, password manager). *Don't keep it only in this chat.*\n` +
            `Nobody at Bio-Pass can see it or regenerate it.\n\n` +
            `Once saved, reply *I SAVED MY KEY*.`
        ),
      };
    }

    // STEP 7B: RECOVERY KEY CONFIRMATION
    if (state === 'STEP7B_RECOVERY') {
      const t = norm(cleanText);
      const saved = /\b(ya guarde|guarde mi clave|guardada|listo|ok|hecho|ja guardei|guardei|i saved|saved|done)\b/.test(t);
      if (!saved) {
        return {
          replyText: tr(
            `Respondé *YA GUARDÉ MI CLAVE* cuando hayas anotado tu Clave de Recuperación en un lugar seguro.`,
            `Embohovái *YA GUARDÉ MI CLAVE* rehai rire nde Clave de Recuperación peteĩ hendápe segúrova.`,
            `Responda *JÁ GUARDEI MINHA CHAVE* quando tiver anotado sua Chave de Recuperação em local seguro.`,
            `Reply *I SAVED MY KEY* once you've written your Recovery Key somewhere safe.`
          ),
        };
      }

      const pr = await PaymentService.getPlanPrices();
      const gs = (n: number) => `Gs. ${n.toLocaleString('es-PY')}`;
      const rs = (n: number) => `R$ ${n.toLocaleString('pt-BR')}`;
      const menu =
        `🇵🇾 *Paraguay:*\n*[1]* Plan Mensual (${gs(pr.PY.MONTHLY)} / mes)\n*[2]* Plan Anual (${gs(pr.PY.ANNUAL)} / año)\n\n` +
        `🇧🇷 *Brasil:*\n*[3]* Plano Mensal (${rs(pr.BR.MONTHLY)} / mês)\n*[4]* Plano Anual (${rs(pr.BR.ANNUAL)} / ano)\n\n`;

      await updateState('STEP8_PAYMENT', {});
      return {
        replyText: tr(
          `✅ *Clave de recuperación confirmada.*\n\n` +
            `💳 *Paso 9/9 (Activación y Pago):*\n` +
            `Elegí tu país y plan para activar tu Bio-Pass y generar tu QR de rescate:\n\n` +
            menu +
            `_Respondé 1, 2, 3 o 4 para recibir el link de pago y el código PIX / Alias._`,
          `✅ *Clave de recuperación oñeñemoneĩ.*\n\n` +
            `💳 *Paso 9/9 (Activación ha Pago):*\n` +
            `Eiporavo nde tetã ha plan:\n\n` +
            menu +
            `_Embohovái 1, 2, 3 térã 4._`,
          `✅ *Chave de recuperação confirmada.*\n\n` +
            `💳 *Passo 9/9 (Ativação e Pagamento):*\n` +
            `Escolha seu país e plano para ativar seu Bio-Pass e gerar seu QR:\n\n` +
            menu +
            `_Responda 1, 2, 3 ou 4 para receber o link de pagamento e o código PIX / Alias._`,
          `✅ *Recovery key confirmed.*\n\n` +
            `💳 *Step 9/9 (Activation & Payment):*\n` +
            `Choose your country and plan to activate your Bio-Pass and generate your rescue QR:\n\n` +
            menu +
            `_Reply 1, 2, 3 or 4 to get the payment link and PIX / Alias code._`
        ),
      };
    }

    // STEP 8: PAYMENT PLAN SELECTION & ORDER GENERATION
    if (state === 'STEP8_PAYMENT') {
      let country: 'PARAGUAY' | 'BRASIL' = 'PARAGUAY';
      let plan: 'MONTHLY' | 'ANNUAL' = 'ANNUAL';

      if (cleanText === '1') {
        country = 'PARAGUAY';
        plan = 'MONTHLY';
      } else if (cleanText === '2') {
        country = 'PARAGUAY';
        plan = 'ANNUAL';
      } else if (cleanText === '3') {
        country = 'BRASIL';
        plan = 'MONTHLY';
      } else if (cleanText === '4') {
        country = 'BRASIL';
        plan = 'ANNUAL';
      }

      const order = await PaymentService.createPaymentOrder({
        userId: user.id,
        plan,
        country,
      });

      await updateState('AWAITING_PAYMENT_CONFIRMATION', { orderId: order.orderId });

      if (country === 'PARAGUAY') {
        const hasQr = !!order.pixQrImage;
        return {
          replyText: `💳 *ORDEN DE PAGO GENERADA (PARAGUAY)*\n\n` +
            `💰 *Monto:* ${order.formattedAmount} (${plan === 'ANNUAL' ? 'Plan Anual' : 'Plan Mensual'})\n` +
            `🔢 *Referencia:* \`${order.referenceCode}\`\n\n` +
            (hasQr
              ? `📷 *Escaneá el QR de arriba* con la cámara o tu app del banco para abrir el pago de Bancard (tarjeta o QR).\n\n`
              : '') +
            `🌐 *Pagar con Tarjeta / Bancard / QR:*\n${order.paymentLink}\n\n` +
            `🏦 *Alternativa — Transferencia SIPAP / Tigo Money:*\n` +
            `${order.aliasInfo}\n\n` +
            `_Una vez realizado el pago, tu QR y Kit de Stickers (3x3 cm) se enviarán inmediatamente por este chat._`,
          mediaAttachment: qrAttachment(order.pixQrImage, `Bio-Pass — ${order.formattedAmount} (${order.referenceCode})`),
        };
      } else {
        return {
          replyText: `💳 *ORDEM DE PAGAMENTO PIX (BRASIL)*\n\n` +
            `💰 *Valor:* ${order.formattedAmount}\n` +
            `🔑 *Chave PIX:* \`${order.pixKey}\`\n\n` +
            `📷 *Escaneie o QR acima* ou copie o código:\n\`${order.pixPayload}\`\n\n` +
            `🌐 *Ou pague via Cartão / Link:*\n${order.paymentLink}\n\n` +
            `_Assim que o pagamento for confirmado, seu QR e Kit Físico serão liberados aqui._`,
          mediaAttachment: qrAttachment(order.pixQrImage, `Bio-Pass — ${order.formattedAmount}`),
        };
      }
    }

    // AWAITING PAYMENT CONFIRMATION STATE
    if (state === 'AWAITING_PAYMENT_CONFIRMATION') {
      if (cleanText.toUpperCase().includes('PAGAR') || cleanText.toUpperCase().includes('CONFIRMAR')) {
        const lastOrder = await prisma.paymentOrder.findFirst({
          where: { userId: user.id, status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
        });

        if (lastOrder) {
          // "PAGAR" ya NO activa a ciegas. Se consulta el pago REAL:
          //  - Bancard: get_confirmation sobre cada shop_process_id de la orden.
          //  - PIX / transferencia / alias: no hay verificación automática → queda
          //    pendiente hasta el webhook o la confirmación del admin.
          let approved = false;
          try {
            const ids: string[] = lastOrder.bancardProcessIds
              ? JSON.parse(lastOrder.bancardProcessIds)
              : [];
            for (const pid of ids) {
              const r = await BancardService.confirm({ shopProcessId: String(pid) }).catch(() => null);
              if (r?.approved) { approved = true; break; }
            }
          } catch {
            /* sin process ids / error de red → approved queda false */
          }

          if (approved) {
            await PaymentService.handlePaymentSuccess(lastOrder.referenceCode);
            return { replyText: `✅ *¡Pago confirmado!* Tu Bio-Pass está activo. Te envío tu QR y el kit de stickers.` };
          }

          return {
            replyText:
              `⏳ *Todavía no veo tu pago acreditado.*\n\n` +
              `Si pagaste con *tarjeta/Bancard*, puede tardar 1–2 minutos: se activa solo.\n` +
              `Si pagaste por *transferencia / PIX / alias*, lo confirmamos manualmente apenas impacta.\n\n` +
              `_Escribí *PAGAR* de nuevo en un rato para reintentar._`,
          };
        }
      }

      return {
        replyText: `⏳ *Tu orden de pago está pendiente de confirmación.*\n\n` +
          `Si ya realizaste la transferencia o pago PIX, el sistema la activará automáticamente en segundos.\n\n` +
          `_Para consultar tus opciones de pago nuevamente, escribe 'PAGAR'._`,
      };
    }

    // ==========================================
    // REGISTERED ACTIVE MEMBER MENU & NLP ENGINE
    // ==========================================
    if (user.status === 'ACTIVE' || state === 'ACTIVE_MEMBER' || state.startsWith('ACTIVE_')) {
      // ---- Carga categorizada de medicamentos / recetas / estudios ----
      // El estado del miembro activo tiene "sub-modos" que se guardan en
      // onboardingState: ACTIVE_UPLOAD_MED | ACTIVE_UPLOAD_RX | ACTIVE_UPLOAD_STUDY
      // | ACTIVE_RX_CONFIRM | ACTIVE_ASK_CATEGORY. Fuera de esos, es el menú.
      const subMode =
        state === 'ACTIVE_UPLOAD_MED' ||
        state === 'ACTIVE_UPLOAD_RX' ||
        state === 'ACTIVE_UPLOAD_STUDY' ||
        state === 'ACTIVE_RX_CONFIRM' ||
        state === 'ACTIVE_ASK_CATEGORY' ||
        state === 'ACTIVE_REMINDER'
          ? state
          : 'ACTIVE_MEMBER';

      const meds = parseMedications(user.currentMedications);
      const lc = cleanText.toLowerCase();

      const extFrom = (filename?: string, mime?: string): string => {
        const fromName = (filename || '').toLowerCase().split('.').pop() || '';
        if (/^(jpg|jpeg|png|webp|pdf|heic)$/.test(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
        const m = (mime || '').toLowerCase();
        if (m.includes('png')) return 'png';
        if (m.includes('pdf')) return 'pdf';
        if (m.includes('webp')) return 'webp';
        if (m.includes('heic') || m.includes('heif')) return 'heic';
        return 'jpg';
      };

      const activeMenu = (): string =>
        tr(
          `👋 *Hola, ${user!.fullName || 'Titular Bio-Pass'}*\n\n` +
            `¿Qué querés hacer hoy?\n\n` +
            `*[1]* 💊 Cargar *medicamento* (lo que estás tomando)\n` +
            `*[2]* 📄 Cargar *receta* médica\n` +
            `*[3]* 🧪 Cargar *estudio* / evaluación médica\n` +
            `*[4]* 📁 Ver mi *perfil médico*\n` +
            `*[5]* ⏰ *Recordatorios* de medicación y *turnos*\n` +
            `*[6]* 🏷️ Descargar Kit de Stickers (3x3 cm) y QR\n` +
            `*[7]* ✏️ Modificar datos de emergencia / alergias\n` +
            `*[8]* 💬 Hablar con soporte\n\n` +
            `_Respondé con el número, mandá una foto/PDF, o un audio._`,
          `👋 *Mba'éichapa, ${user!.fullName || 'Titular Bio-Pass'}*\n\n` +
            `Mba'épa rejaposéta ko'ág̃a?\n\n` +
            `*[1]* 💊 Emombe'u *pohã* reiporúva\n` +
            `*[2]* 📄 Emombe'u *receta* médica\n` +
            `*[3]* 🧪 Emombe'u *estudio* médico\n` +
            `*[4]* 📁 Ahecha che *perfil médico*\n` +
            `*[5]* ⏰ *Momandu'a* pohã reheve\n` +
            `*[6]* 🏷️ Kit Stickers (3x3 cm) ha QR\n` +
            `*[7]* ✏️ Emoambue datos de emergencia / alergia\n` +
            `*[8]* 💬 Soporte ndive\n\n` +
            `_Embohovái papapy reheve, emondo ta'anga/PDF, térã ñe'ẽ._`
        );

      const medUpdateMsg = (r: {
        added: string[];
        updated: string[];
        list: Medication[];
        conflicts: string[];
      }): string => {
        const lines: string[] = [];
        if (r.added.length) lines.push(tr(`✅ Agregado: *${r.added.join(', ')}*`, `✅ Ojeagrega: *${r.added.join(', ')}*`));
        if (r.updated.length) lines.push(tr(`♻️ Actualizado: *${r.updated.join(', ')}*`, `♻️ Oñemoambue: *${r.updated.join(', ')}*`));
        lines.push('');
        lines.push(tr(`💊 *Tu medicación actual (${r.list.length}):*`, `💊 *Ne pohã ko'ág̃agua (${r.list.length}):*`));
        lines.push(formatMedications(r.list));
        if (r.conflicts.length) {
          lines.push('');
          lines.push(tr('⚠️ *Atención — posible interacción con tu ficha:*', '⚠️ *Ejesareko:*'));
          for (const c of r.conflicts) lines.push(`• ${c}`);
          lines.push(tr('_Confirmá con tu médico._', '_Eñemongeta nde médico ndive._'));
        }
        return lines.join('\n');
      };

      const persistMeds = async (list: Medication[]) => {
        await prisma.user.update({ where: { id: user!.id }, data: { currentMedications: JSON.stringify(list) } });
      };

      const ingestMedFromInput = async (opts: {
        buffer?: Buffer;
        filename?: string;
        text?: string;
        source: 'manual' | 'photo' | 'receta';
      }) => {
        const extracted = await OcrAiService.extractMedications({
          buffer: opts.buffer,
          filename: opts.filename,
          text: opts.text,
        });
        if (!extracted.length) return null;
        const { list, added, updated } = mergeMedications(meds, extracted, opts.source);
        await persistMeds(list);
        const conflicts = medicationConflicts(list, user!.severeAllergies, user!.contraindicatedMeds);
        return { list, added, updated, conflicts };
      };

      const saveReceta = async (buffer: Buffer, filename: string) => {
        const saved = await StorageService.saveFile(
          'medical_studies',
          `rx_${user!.id}_${Date.now()}.${extFrom(filename, msg.mediaMimeType)}`,
          buffer
        );
        const rx = await OcrAiService.processPrescription(buffer, filename);
        await prisma.medicalStudy.create({
          data: {
            userId: user!.id,
            title: rx.diagnosis ? `Receta — ${rx.diagnosis}` : 'Receta médica',
            studyType: 'PRESCRIPTION',
            studyDate: rx.studyDate || new Date(),
            fileUrl: saved.fileUrl,
            ocrRawText: ZeroKnowledgeSecurity.kmsEncrypt(rx.rawText),
            aiSummary: ZeroKnowledgeSecurity.kmsEncrypt(rx.aiSummary),
            contentEncrypted: !!process.env.KMS_KEY,
          },
        });
        return rx;
      };

      const recetaReply = async (rx: Awaited<ReturnType<typeof saveReceta>>): Promise<BotResponse> => {
        if (rx.medications.length) {
          await updateState('ACTIVE_RX_CONFIRM', { pendingRxMeds: rx.medications });
          const listStr = rx.medications
            .map((m) => {
              const bits = [m.dose, m.frequency].filter(Boolean).join(' · ');
              return `• *${m.name}*${bits ? ` — ${bits}` : ''}`;
            })
            .join('\n');
          return {
            replyText: tr(
              `📄 *Receta guardada en tu perfil.*\n\n💊 Medicamentos detectados:\n${listStr}\n\n` +
                `¿Los agrego a tu *Medicación actual*?\n*[1]* Sí   *[2]* No, solo guardar la receta`,
              `📄 *Receta oñeguarda.*\n\n💊 Pohã ojejuhúva:\n${listStr}\n\n` +
                `¿Ambojoapy ne *pohã ko'ág̃aguápe*?\n*[1]* Heẽ   *[2]* Nahániri`
            ),
          };
        }
        return {
          replyText: tr(
            `📄 *Receta guardada en tu perfil.*\nNo pude leer la lista de medicamentos; si querés, cargalos con la opción *[1]* del menú.\n\n_Mandá otra receta o escribí *LISTO*._`,
            `📄 *Receta oñeguarda.*\n\n_Emondo ambue térã ehai *LISTO*._`
          ),
        };
      };

      const saveEstudio = async (buffer: Buffer, filename: string): Promise<BotResponse> => {
        const saved = await StorageService.saveFile(
          'medical_studies',
          `study_${user!.id}_${Date.now()}.${extFrom(filename, msg.mediaMimeType)}`,
          buffer
        );
        const studyOcr = await OcrAiService.processMedicalStudy(buffer, filename);
        // Un archivo que el usuario clasificó explícitamente como "estudio" nunca
        // se guarda como receta aunque la IA lo confunda.
        const st = studyOcr.studyType === 'PRESCRIPTION' ? 'OTHER' : studyOcr.studyType;
        await prisma.medicalStudy.create({
          data: {
            userId: user!.id,
            title: studyOcr.title,
            studyType: st,
            studyDate: studyOcr.studyDate || new Date(),
            fileUrl: saved.fileUrl,
            ocrRawText: ZeroKnowledgeSecurity.kmsEncrypt(studyOcr.rawText),
            aiSummary: ZeroKnowledgeSecurity.kmsEncrypt(studyOcr.aiSummary),
            contentEncrypted: !!process.env.KMS_KEY,
          },
        });
        const findingsBlock = studyOcr.keyFindings.length
          ? `\n📊 *${tr('Hallazgos', 'Ojejuhúva')}:*\n${studyOcr.keyFindings.slice(0, 6).map((f) => `• ${f}`).join('\n')}\n`
          : '';
        return {
          replyText:
            `🧪 *${tr('ESTUDIO GUARDADO EN TU PERFIL', 'ESTUDIO OÑEGUARDA')}*\n\n` +
            `📋 *${tr('Tipo', 'Tipo')}:* ${studyOcr.title}\n` +
            `📅 *${tr('Fecha', 'Ára')}:* ${(studyOcr.studyDate || new Date()).toLocaleDateString('es-PY', { timeZone: config.timezone })}\n` +
            `🤖 ${studyOcr.aiSummary}\n${findingsBlock}` +
            tr('\n_Mandá otro o escribí *LISTO*._', '\n_Emondo ambue térã ehai *LISTO*._'),
        };
      };

      const profileSummary = async (): Promise<string> => {
        const studies = await prisma.medicalStudy.findMany({
          where: { userId: user!.id },
          orderBy: [{ studyDate: 'desc' }, { createdAt: 'desc' }],
        });
        const rx = studies.filter((s) => s.studyType === 'PRESCRIPTION');
        const est = studies.filter((s) => s.studyType !== 'PRESCRIPTION');
        const rows = (arr: typeof studies): string =>
          arr
            .slice(0, 8)
            .map((s) => `• ${s.title} — ${(s.studyDate || s.createdAt).toLocaleDateString('es-PY', { timeZone: config.timezone })}`)
            .join('\n') || tr('_Nada cargado._', '_Ndaipóri._');
        const conflicts = medicationConflicts(meds, user!.severeAllergies, user!.contraindicatedMeds);
        return (
          `📁 *${tr('TU PERFIL MÉDICO', 'NE PERFIL MÉDICO')}*\n\n` +
          `💊 *${tr('Medicación actual', "Pohã ko'ág̃agua")} (${meds.length}):*\n` +
          `${meds.length ? formatMedications(meds, { max: 15 }) : tr('_Sin medicamentos cargados._', '_Ndaipóri pohã._')}\n\n` +
          `📄 *${tr('Recetas', 'Receta')} (${rx.length}):*\n${rows(rx)}\n\n` +
          `🧪 *${tr('Estudios', 'Estudio')} (${est.length}):*\n${rows(est)}\n` +
          (conflicts.length ? `\n⚠️ *${tr('Atención', 'Ejesareko')}:*\n${conflicts.map((c) => `• ${c}`).join('\n')}\n` : '') +
          `\n🔐 ${tr('Ver todo en detalle en la web (con tu PIN)', 'Ahecha opavave webpe (nde PIN reheve)')}: https://bio-pass.cnid.com.py/\n` +
          tr('_Escribí *MENU* para volver._', '_Ehai *MENU* rehóvo._')
        );
      };

      // Salir de un sub-modo de carga
      if (subMode !== 'ACTIVE_MEMBER' && /^(listo|menu|men[uú]|0|salir|volver|cancelar|terminar)$/i.test(cleanText)) {
        await updateState('ACTIVE_MEMBER', {});
        return { replyText: `✅ ${tr('Listo.', 'Oĩma.')}\n\n${activeMenu()}` };
      }

      // "MENU" / "opciones" / "hola" en el menú → mostrar el menú real (no la IA)
      if (subMode === 'ACTIVE_MEMBER' && /^(menu|men[uú]|opciones|inicio|hola|buenas|0)$/i.test(cleanText)) {
        return { replyText: activeMenu() };
      }

      // Sub-modo: cargar medicamento (foto de la caja/blíster o texto)
      if (subMode === 'ACTIVE_UPLOAD_MED') {
        if (msg.mediaBuffer) {
          const r = await ingestMedFromInput({
            buffer: msg.mediaBuffer,
            filename: msg.mediaFilename || 'medicamento.jpg',
            source: 'photo',
          });
          if (!r) {
            return {
              replyText: tr(
                '😕 No pude leer el medicamento en la foto. Probá con más luz / acercándote, o escribí *nombre + dosis + frecuencia* (ej: "Losartán 50 mg, 1 vez al día").',
                '😕 Ndaikatúi amoñe\'ẽ pe pohã. Emondo ta\'anga porãvéva, térã ehai *réra + dosis + mboýpa*.'
              ),
            };
          }
          return { replyText: medUpdateMsg(r) + tr('\n\n_Mandá otro o escribí *LISTO*._', '\n\n_Emondo ambue térã ehai *LISTO*._') };
        }
        if (cleanText) {
          const r = await ingestMedFromInput({ text: cleanText, source: 'manual' });
          if (!r) {
            return {
              replyText: tr(
                '😕 No entendí el medicamento. Escribilo así: *Nombre Dosis Frecuencia*\n_Ej: Metformina 850 mg, 2 veces al día_',
                '😕 Ndaikũmbýi. Ehai péicha: *Réra Dosis Mboýpa*'
              ),
            };
          }
          return { replyText: medUpdateMsg(r) + tr('\n\n_Agregá otro o escribí *LISTO*._', '\n\n_Embojoapy ambue térã ehai *LISTO*._') };
        }
        return {
          replyText: tr(
            '💊 Mandá una *foto del medicamento* (caja/blíster) o escribí *nombre + dosis + frecuencia*.\n_Escribí *LISTO* cuando termines._',
            '💊 Emondo pe *pohã ra\'anga* térã ehai *réra + dosis + mboýpa*.\n_Ehai *LISTO* rehóvo._'
          ),
        };
      }

      // Sub-modo: cargar receta
      if (subMode === 'ACTIVE_UPLOAD_RX') {
        if (!msg.mediaBuffer) {
          return {
            replyText: tr(
              '📄 Mandá la *foto o PDF de la receta*. Podés mandar varias.\n_Escribí *LISTO* cuando termines._',
              '📄 Emondo pe *receta ra\'anga térã PDF*.\n_Ehai *LISTO* rehóvo._'
            ),
          };
        }
        const rx = await saveReceta(msg.mediaBuffer, msg.mediaFilename || 'receta.jpg');
        return recetaReply(rx);
      }

      // Sub-modo: confirmar si sumar los medicamentos de la receta a "medicación actual"
      if (subMode === 'ACTIVE_RX_CONFIRM') {
        const pending = (getTempData().pendingRxMeds || []) as Array<{ name: string; dose?: string; frequency?: string }>;
        if (cleanText === '1' || /^s[ií]$/i.test(cleanText) || /\bsi\b/.test(lc)) {
          const { list, added, updated } = mergeMedications(meds, pending, 'receta');
          await persistMeds(list);
          const conflicts = medicationConflicts(list, user.severeAllergies, user.contraindicatedMeds);
          await updateState('ACTIVE_UPLOAD_RX', { pendingRxMeds: [] });
          return {
            replyText:
              medUpdateMsg({ added, updated, list, conflicts }) +
              tr('\n\n_Mandá otra receta o escribí *LISTO*._', '\n\n_Emondo ambue térã ehai *LISTO*._'),
          };
        }
        await updateState('ACTIVE_UPLOAD_RX', { pendingRxMeds: [] });
        return {
          replyText: tr(
            '👍 Ok, la receta quedó guardada y no toqué tu medicación.\n\n_Mandá otra receta o escribí *LISTO*._',
            '👍 Oĩma, receta oñeguarda.\n\n_Emondo ambue térã ehai *LISTO*._'
          ),
        };
      }

      // Sub-modo: cargar estudio / evaluación médica
      if (subMode === 'ACTIVE_UPLOAD_STUDY') {
        if (!msg.mediaBuffer) {
          return {
            replyText: tr(
              '🧪 Mandá la *foto o PDF del estudio* (laboratorio, radiografía, tomografía, ECG, informe). Podés mandar varios.\n_Escribí *LISTO* cuando termines._',
              '🧪 Emondo pe *estudio ra\'anga térã PDF*.\n_Ehai *LISTO* rehóvo._'
            ),
          };
        }
        return saveEstudio(msg.mediaBuffer, msg.mediaFilename || 'estudio.jpg');
      }

      // Sub-modo: llegó un archivo sin haber elegido categoría
      if (subMode === 'ACTIVE_ASK_CATEGORY') {
        const pend = getTempData().pendingUpload as { name: string } | undefined;
        if (!pend?.name) {
          await updateState('ACTIVE_MEMBER', {});
          return { replyText: activeMenu() };
        }
        if (!/^[123]$/.test(cleanText)) {
          return {
            replyText: tr(
              '¿Qué es lo que mandaste?\n*[1]* 💊 Un medicamento\n*[2]* 📄 Una receta\n*[3]* 🧪 Un estudio / análisis',
              'Mba\'épa emondo va\'ekue?\n*[1]* 💊 Pohã\n*[2]* 📄 Receta\n*[3]* 🧪 Estudio'
            ),
          };
        }
        const buf = await StorageService.getFile('medical_studies', pend.name);
        if (!buf) {
          await updateState('ACTIVE_MEMBER', {});
          return { replyText: tr('No encontré el archivo, reenvialo por favor.', 'Ndajuhúi pe archivo, emondo jey.') };
        }
        if (cleanText === '1') {
          const r = await ingestMedFromInput({ buffer: buf, filename: pend.name, source: 'photo' });
          await updateState('ACTIVE_UPLOAD_MED', { pendingUpload: null });
          return {
            replyText:
              (r
                ? medUpdateMsg(r)
                : tr('😕 No pude leer el medicamento en la foto. Escribí *nombre + dosis + frecuencia*.', '😕 Ndaikatúi. Ehai iréra + dosis + mboýpa.')) +
              tr('\n\n_Mandá otro o escribí *LISTO*._', '\n\n_Emondo ambue térã ehai *LISTO*._'),
          };
        }
        if (cleanText === '2') {
          await updateState('ACTIVE_UPLOAD_RX', { pendingUpload: null });
          const rx = await saveReceta(buf, pend.name);
          return recetaReply(rx);
        }
        await updateState('ACTIVE_UPLOAD_STUDY', { pendingUpload: null });
        return saveEstudio(buf, pend.name);
      }

      // Sub-modo: recordatorios de medicación
      if (subMode === 'ACTIVE_REMINDER') {
        const list = async () =>
          prisma.medicationReminder.findMany({
            where: { userId: user!.id },
            orderBy: { createdAt: 'asc' },
            select: { id: true, kind: true, medication: true, dose: true, times: true, whenAt: true, active: true },
          });

        let rows = await list();
        const showList = (current = rows) => {
          const body = current.length
            ? MedicationReminderService.format(current)
            : tr('_No tenés recordatorios configurados._', '_Ndaipóri momandu\'a._');
          return (
            `⏰ *${tr('Recordatorios y turnos', "Momandu'a ha turno")}*\n\n${body}\n\n` +
            tr(
              '💊 *Medicación* — escribí o mandá un audio: *nombre + horarios*\n' +
                '_Ej: "Losartán 50 mg 08:00 y 20:00"_\n' +
                '🩺 *Turno médico* — *"turno con cardiólogo el 15/10 a las 14:30"*\n\n' +
                '_Borrar: "borrar 2" · Pausar: "pausar 1" · Volver: *LISTO*_',
              '💊 Pohã: *réra + hora*. 🩺 Turno: *"turno 15/10 14:30"*\n_Ehai *LISTO* rehóvo._'
            )
          );
        };

        // borrar N / pausar N / activar N
        const cmd = cleanText.match(/^(borrar|eliminar|quitar|sacar|pausar|desactivar|activar|reactivar)\s+(\d{1,2})/i);
        if (cmd) {
          const idx = parseInt(cmd[2], 10) - 1;
          const target = rows[idx];
          if (!target) return { replyText: tr(`No hay un recordatorio *${idx + 1}*.`, `Ndaipóri momandu'a *${idx + 1}*.`) + '\n\n' + showList() };
          const verb = cmd[1].toLowerCase();
          if (/^(borrar|eliminar|quitar|sacar)/.test(verb)) {
            await prisma.medicationReminder.delete({ where: { id: target.id } });
            return { replyText: tr(`🗑️ Borré el recordatorio de *${target.medication}*.`, `🗑️ Aipe'a *${target.medication}* momandu'a.`) + '\n\n' + MedicationReminderService.format(await list()) };
          }
          const activate = /^(activar|reactivar)/.test(verb);
          await prisma.medicationReminder.update({ where: { id: target.id }, data: { active: activate } });
          return { replyText: tr(`${activate ? '▶️ Activé' : '⏸️ Pausé'} el recordatorio de *${target.medication}*.`, `*${target.medication}* ${activate ? 'oñemyendy' : 'oñembopyta'}.`) + '\n\n' + MedicationReminderService.format(await list()) };
        }

        // agregar (texto tecleado o transcripto de audio)
        if (cleanText && !/^\d{1,2}$/.test(cleanText)) {
          // ¿es un turno / consulta médica?
          const appt = MedicationReminderService.parseAppointment(cleanText);
          if (appt) {
            await prisma.medicationReminder.create({
              data: { userId: user.id, kind: 'APPOINTMENT', medication: appt.note, whenAt: appt.whenAt, times: '[]' },
            });
            rows = await list();
            const w = appt.whenAt.toLocaleString('es-PY', {
              timeZone: config.timezone,
              weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            });
            return {
              replyText:
                tr(
                  `✅ *Turno agendado:* 🩺 ${appt.note}\n📅 ${w}\nTe voy a recordar 24 h antes y el día del turno.`,
                  `✅ *Turno oñeguarda:* 🩺 ${appt.note}\n📅 ${w}`
                ) +
                '\n\n' +
                showList(rows),
            };
          }

          const parsed = MedicationReminderService.parse(cleanText);
          if (!parsed) {
            return {
              replyText: tr(
                '😕 Para *medicación*: *nombre + horarios* — _"Enalapril 10 mg 08:00 y 21:00"_\n' +
                  'Para un *turno*: *"turno con cardiólogo el 15/10 a las 14:30"_',
                '😕 Pohã: *réra + hora*.\nTurno: *"turno cardiólogo 15/10 14:30"*'
              ),
            };
          }
          const created = await prisma.medicationReminder.create({
            data: {
              userId: user.id,
              medication: parsed.medication,
              dose: parsed.dose || null,
              times: JSON.stringify(parsed.times),
            },
          });
          const conflicts = medicationConflicts(
            [{ name: parsed.medication, source: 'manual', addedAt: '' }],
            user.severeAllergies,
            user.contraindicatedMeds
          );
          rows = await list();
          return {
            replyText:
              tr(
                `✅ Recordatorio creado: 💊 *${created.medication}*${created.dose ? ` (${created.dose})` : ''} — ⏰ ${parsed.times.join(', ')}\n` +
                  `Te voy a avisar por acá a esos horarios, todos los días.`,
                `✅ Momandu'a: 💊 *${created.medication}* — ⏰ ${parsed.times.join(', ')}`
              ) +
              (conflicts.length ? `\n\n⚠️ ${conflicts.map((c) => `• ${c}`).join('\n')}` : '') +
              '\n\n' +
              showList(rows),
          };
        }

        return { replyText: showList() };
      }

      // ===== A partir de acá subMode === 'ACTIVE_MEMBER' (menú) =====

      // Archivo suelto sin haber elegido opción → preguntar categoría
      if (msg.mediaBuffer) {
        const name = `pending_${user.id}_${Date.now()}.${extFrom(msg.mediaFilename, msg.mediaMimeType)}`;
        await StorageService.saveFile('medical_studies', name, msg.mediaBuffer);
        await updateState('ACTIVE_ASK_CATEGORY', { pendingUpload: { name } });
        return {
          replyText: tr(
            '📎 Recibí tu archivo. ¿Qué es?\n\n*[1]* 💊 Un medicamento\n*[2]* 📄 Una receta\n*[3]* 🧪 Un estudio / análisis',
            '📎 Ahupytýma ne archivo. Mba\'épa?\n\n*[1]* 💊 Pohã\n*[2]* 📄 Receta\n*[3]* 🧪 Estudio'
          ),
        };
      }

      // "ya no tomo X" / "sacar X" → quitar de la medicación actual
      const stopMed = cleanText.match(/^\s*(?:ya no (?:tomo|uso)|dej[eé] de (?:tomar|usar)|sacar|quitar|eliminar|borrar)\s+(.{2,})/i);
      if (stopMed) {
        const { list, removed } = removeMedication(meds, stopMed[1].trim());
        if (removed.length) {
          await persistMeds(list);
          return { replyText: tr(`✅ Saqué de tu medicación: *${removed.join(', ')}*`, `✅ Aipe'a ne pohãgui: *${removed.join(', ')}*`) };
        }
        return {
          replyText: tr(
            `No encontré "*${stopMed[1].trim()}*" en tu lista de medicación. Escribí *4* para ver tu perfil.`,
            `Ndajuhúi "*${stopMed[1].trim()}*". Ehai *4* rehecha hag̃ua ne perfil.`
          ),
        };
      }

      // Menú numerado
      if (cleanText === '1' || lc.includes('cargar medicamento')) {
        await updateState('ACTIVE_UPLOAD_MED', {});
        return {
          replyText: tr(
            '💊 *Cargar medicamento*\n\nMandá una *foto* del medicamento (caja/blíster) o escribí *nombre + dosis + frecuencia*.\n_Ej: Losartán 50 mg, 1 vez al día_\n\n_Podés mandar varios. Escribí *LISTO* cuando termines._',
            '💊 *Emombe\'u pohã*\n\nEmondo peteĩ *ta\'anga* térã ehai *réra + dosis + mboýpa*.\n\n_Ehai *LISTO* rehóvo._'
          ),
        };
      }
      if (cleanText === '2' || lc.includes('cargar receta')) {
        await updateState('ACTIVE_UPLOAD_RX', {});
        return {
          replyText: tr(
            '📄 *Cargar receta*\n\nMandá la *foto o PDF* de la receta del médico.\nLeo los medicamentos y te ofrezco sumarlos a tu medicación actual.\n\n_Podés mandar varias. Escribí *LISTO* cuando termines._',
            '📄 *Emombe\'u receta*\n\nEmondo pe *ta\'anga térã PDF*.\n\n_Ehai *LISTO* rehóvo._'
          ),
        };
      }
      if (cleanText === '3' || lc.includes('cargar estudio') || lc.includes('subir estudio')) {
        await updateState('ACTIVE_UPLOAD_STUDY', {});
        return {
          replyText: tr(
            '🧪 *Cargar estudio / evaluación médica*\n\nMandá la *foto o PDF* del análisis de sangre, radiografía, tomografía, ECG o informe.\nLa IA extrae fecha, tipo y hallazgos.\n\n_Podés mandar varios. Escribí *LISTO* cuando termines._',
            '🧪 *Emombe\'u estudio*\n\nEmondo pe *ta\'anga térã PDF*.\n\n_Ehai *LISTO* rehóvo._'
          ),
        };
      }
      if (cleanText === '4' || lc.includes('perfil médico') || lc.includes('perfil medico') || lc.includes('ver lo que tengo')) {
        return { replyText: await profileSummary() };
      }
      if (cleanText === '5' || lc.includes('recordatorio') || lc.includes('recordar')) {
        await updateState('ACTIVE_REMINDER', {});
        const rms = await prisma.medicationReminder.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'asc' },
          select: { kind: true, medication: true, dose: true, times: true, whenAt: true, active: true },
        });
        return {
          replyText:
            `⏰ *${tr('Recordatorios y turnos', "Momandu'a ha turno")}*\n\n` +
            (rms.length ? MedicationReminderService.format(rms) + '\n\n' : '') +
            tr(
              'Escribí o mandá un *audio*:\n' +
                '💊 *Medicación:* "Metformina 850 mg 08:00 y 21:00"\n' +
                '🩺 *Turno médico:* "turno con traumatólogo el 20/10 a las 10:00"\n\n' +
                '_Borrar: "borrar 2" · Pausar: "pausar 1" · Volver: *LISTO*_',
              '💊 "Metformina 08:00 ha 21:00" · 🩺 "turno 20/10 10:00"\n_Ehai *LISTO* rehóvo._'
            ),
        };
      }
      if (cleanText === '6' || lc.includes('descargar qr') || lc.includes('sticker') || lc.includes('kit')) {
        const org = user.organizationId
          ? await prisma.organization.findUnique({ where: { id: user.organizationId } })
          : null;
        const sticker = await QrPdfService.generateStickerPdf({
          emergencyToken: user.emergencyToken,
          userName: user.fullName || 'Usuario Bio-Pass',
          bloodType: user.bloodType || 'O Positivo',
          organizationName: org?.name,
          organizationLogoUrl: org?.logoUrl || undefined,
        });

        return {
          replyText: `📱 *TU KIT DE EMERGENCIA BIO-PASS*\n\n` +
            `🌐 *Tu enlace público:* ${config.publicEmergencyBaseUrl}/${user.emergencyToken}\n\n` +
            `📄 *Descarga tu PDF de Stickers (3x3 cm):*\n${sticker.fileUrl}\n\n` +
            `💡 *Recomendación:* Imprime en papel Contact (vinilo adhesivo) resistente al agua y pégalo en tu celular, casco o billetera.`,
        };
      }
      if (cleanText === '7' || lc.includes('modificar')) {
        return {
          replyText: `✏️ *Actualización Inteligente de Perfil:*\n\n` +
            `Escribí en lenguaje natural lo que querés actualizar. Ejemplos:\n` +
            `• _"Cambiar alergia a Penicilina e Ibuprofeno"_\n` +
            `• _"Nuevo contacto Carlos Perez 0981999888"_\n` +
            `• _"Cambiar dirección a Avda España 500"_\n` +
            `• _"Ya no tomo Enalapril"_\n\n` +
            `_Escribí tu mensaje a continuación:_`,
        };
      }
      if (cleanText === '8' || lc.includes('soporte')) {
        return {
          replyText: `👨‍⚕️ *Soporte Técnico Doorway Cortex Bio-Pass:*\n\n` +
            `Para asistencia médica, corporativa o reclamos de facturación, escribí a soporte@bio-pass.com o llamá al +595 21 500 000.`,
        };
      }

      // Consulta de estudios/recetas en lenguaje natural (también por audio):
      // "pasame mi estudio de próstata", "mandame los análisis de sangre", "mostrame la receta del cardiólogo".
      const askDoc = cleanText.match(
        /\b(pasame|pas[aá]|mandame|mand[aá]|env[ií]ame|env[ií]a|mostrame|mostr[aá]|dame|quiero ver|necesito|busc[aá]r?|ver|descargar|tra[eé]me|buscame)\b[\s\S]*?\b(estudios?|an[aá]lisis|resultados?|informes?|recetas?|radiograf\w*|tomograf\w*|laboratorio|placas?|ecograf\w*|electro\w*|ex[aá]menes?)\b/i
      );
      if (askDoc) {
        const wantsRx = /receta/i.test(askDoc[2]);
        // término de búsqueda: lo que sigue a "de/sobre/del/de la/de mi"
        const after = cleanText.slice((askDoc.index || 0) + askDoc[0].length);
        const termMatch = after.match(/\b(?:de|sobre|del|de la|de mi|para)\s+(.{2,60})/i);
        const term = (termMatch ? termMatch[1] : '')
          .replace(/[?¿!¡.]+$/g, '')
          .replace(/\b(por favor|porfa|gracias|mio|m[ií]a|mis|mi)\b/gi, '')
          .trim();

        const where: any = { userId: user.id };
        if (wantsRx) where.studyType = 'PRESCRIPTION';
        // ocrRawText/aiSummary pueden estar cifrados at-rest → el filtro por texto
        // se hace en memoria tras descifrar (no con `contains` de la DB).
        const all = await prisma.medicalStudy.findMany({
          where,
          orderBy: [{ studyDate: 'desc' }, { createdAt: 'desc' }],
        });
        const decrypted = all.map((s) => ({
          ...s,
          aiSummary: ZeroKnowledgeSecurity.kmsDecrypt(s.aiSummary),
          ocrRawText: ZeroKnowledgeSecurity.kmsDecrypt(s.ocrRawText),
        }));
        const termLc = term.toLowerCase();
        const found = (term
          ? decrypted.filter(
              (s) =>
                s.title.toLowerCase().includes(termLc) ||
                (s.aiSummary || '').toLowerCase().includes(termLc) ||
                (s.ocrRawText || '').toLowerCase().includes(termLc)
            )
          : decrypted
        ).slice(0, 5);

        if (!found.length) {
          return {
            replyText: tr(
              `🔍 No encontré ${wantsRx ? 'recetas' : 'estudios'}${term ? ` sobre *${term}*` : ''} en tu perfil.\n` +
                `Podés cargarlos con la opción *[${wantsRx ? '2' : '3'}]* del menú.`,
              `🔍 Ndajuhúi mba'eve${term ? ` "*${term}*"` : ''}. Emombe'u opción *[${wantsRx ? '2' : '3'}]* rupive.`
            ),
          };
        }

        const lines = found
          .map(
            (s) =>
              `• *${s.title}* — ${(s.studyDate || s.createdAt).toLocaleDateString('es-PY', { timeZone: config.timezone })}\n  ${s.aiSummary ? `_${s.aiSummary.slice(0, 140)}_\n  ` : ''}${s.fileUrl}`
          )
          .join('\n\n');

        // Adjuntar el archivo del más reciente (vive en /uploads/medical_studies/<name>).
        const first = found[0];
        let mediaAttachment: BotResponse['mediaAttachment'];
        try {
          const name = first.fileUrl.split('/').pop() || '';
          const buf = name ? await StorageService.getFile('medical_studies', name) : null;
          if (buf && buf.length) {
            const isPdf = /\.pdf$/i.test(name);
            mediaAttachment = {
              buffer: buf,
              filename: `${first.title}`.replace(/[^\p{L}\p{N}\s.-]/gu, '').slice(0, 60) + (isPdf ? '.pdf' : '.jpg'),
              mimetype: isPdf ? 'application/pdf' : 'image/jpeg',
              kind: isPdf ? 'document' : 'image',
              caption: `${first.title} — ${(first.studyDate || first.createdAt).toLocaleDateString('es-PY', { timeZone: config.timezone })}`,
            };
          }
        } catch {
          /* si falla el adjunto, quedan los links */
        }

        return {
          replyText:
            tr(
              `📂 Encontré ${found.length} ${wantsRx ? (found.length === 1 ? 'receta' : 'recetas') : found.length === 1 ? 'estudio' : 'estudios'}${term ? ` sobre *${term}*` : ''}:\n\n${lines}`,
              `📂 Ajuhu ${found.length}${term ? ` "*${term}*"` : ''}:\n\n${lines}`
            ) + tr('\n\n_Te adjunto el más reciente._', '\n\n_Amondo pe ipyahuvéva._'),
          mediaAttachment,
        };
      }

      // Natural Language Processing of incoming text
      const parsedIntent = NlpHandler.parseIntent(cleanText);
      if (parsedIntent.intent === 'CHANGE_ALLERGY' && parsedIntent.value) {
        await prisma.user.update({
          where: { id: user.id },
          data: { severeAllergies: parsedIntent.value },
        });
        return {
          replyText: `✅ *Alergia actualizada en tiempo real:*\n"${parsedIntent.value}"\n\nTu perfil público de rescate ya refleja este cambio.`,
        };
      }

      if (parsedIntent.intent === 'CHANGE_CONTACT' && parsedIntent.contactName) {
        await prisma.emergencyContact.deleteMany({ where: { userId: user.id } });
        await prisma.emergencyContact.create({
          data: {
            userId: user.id,
            fullName: parsedIntent.contactName,
            phoneNumber: parsedIntent.contactPhone || '0981000000',
            isPrimary: true,
          },
        });
        return {
          replyText: `✅ *Contacto de emergencia actualizado:*\n👤 ${parsedIntent.contactName}\n📞 ${parsedIntent.contactPhone || 'Guardado'}`,
        };
      }

      if (parsedIntent.intent === 'CHANGE_ADDRESS' && parsedIntent.value) {
        await prisma.user.update({
          where: { id: user.id },
          data: { address: parsedIntent.value },
        });
        return {
          replyText: `✅ *Dirección actualizada:* ${parsedIntent.value}`,
        };
      }

      {
        const ai = await askNiro(cleanText, { name: user.fullName || undefined, scope: 'MIEMBRO_ACTIVO' });
        if (ai) return { replyText: ai + '\n\n_Escribí *MENU* para ver las opciones._' };
      }

      // Menú por defecto del miembro activo
      return { replyText: activeMenu() };
    }

    // Expired or cancelled member
    if (user.status === 'EXPIRED' || user.status === 'CANCELLED') {
      const isFine = user.status === 'CANCELLED';
      const order = await PaymentService.createPaymentOrder({
        userId: user.id,
        plan: 'ANNUAL',
        country: 'PARAGUAY',
        isFine,
      });

      return {
        replyText: `⚠️ *TU SERVICIO BIO-PASS SE ENCUENTRA ${user.status}*\n\n` +
          (isFine ? `Para reactivar tu cuenta y evitar el purgado permanente de tus estudios médicos (GDPR), abona la cuota con multa:\n` : `Renueva tu suscripción para reactivar tu QR:\n\n`) +
          `💰 *Monto a pagar:* ${order.formattedAmount}\n` +
          `🔗 *Enlace de Pago:* ${order.paymentLink}\n\n` +
          `_Escribe 'PAGAR' para confirmar tu reactivación._`,
      };
    }

    {
      const ai = await askNiro(cleanText, { scope: 'PRE_REGISTRO' });
      if (ai) return { replyText: `${ai}\n\n_Escribí *MENU* para comenzar tu registro._` };
    }
    return {
      replyText: `👋 Bienvenido a Bio-Pass. Escribe 'MENU' para comenzar.`,
    };
  }
}
