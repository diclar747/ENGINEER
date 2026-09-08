import { prisma } from '../database/prisma';
import { ZeroKnowledgeSecurity } from '../security/zero-knowledge';
import { OcrAiService } from '../services/ocr-ai.service';
import { PaymentService } from '../services/payment.service';
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
import { NlpHandler } from './nlp-handler';
import { config } from '../config';

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
        replyText: `👋 *¡Hola! Bienvenido a Doorway Cortex Bio-Pass (Mobile Health Passport).*\n\n` +
          `Tu pasaporte médico inteligente y seguro en tu bolsillo.\n` +
          `⏱️ *El registro dura menos de 3 minutos.*\n\n` +
          `Por favor, selecciona tu idioma de preferencia:\n` +
          `*[1]* Español 🇪🇸\n` +
          `*[2]* Guaraní 🇵🇾\n\n` +
          `_Responde con 1 o 2 para comenzar._`,
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

    // Bilingual helper — Guaraní/Jopará for GN users, Spanish otherwise.
    const lang: 'es' | 'gn' = user.language === 'GN' ? 'gn' : 'es';
    const tr = (es: string, gn: string) => (lang === 'gn' ? gn : es);

    // Reset command: If user types "REINICIAR" or "MENU"
    if (cleanText.toUpperCase() === 'REINICIAR') {
      await updateState('STEP1_WELCOME', {});
      return {
        replyText: `🔄 *Registro reiniciado.*\n\nPor favor selecciona tu idioma:\n*[1]* Español\n*[2]* Guaraní`,
      };
    }

    // ==========================================
    // ONBOARDING FLOW (100% SELF-SERVICE)
    // ==========================================

    // STEP 1: WELCOME & LANGUAGE
    if (state === 'STEP1_WELCOME' || state === 'UNREGISTERED') {
      const isGuarani = cleanText === '2' || cleanText.toLowerCase().includes('guarani');
      await updateState('STEP2_DOCUMENT', { language: isGuarani ? 'GN' : 'ES' }, { language: isGuarani ? 'GN' : 'ES' });

      if (isGuarani) {
        return {
          replyText: `✅ *Mba'éichapa! Jahecha nde Cédula de Identidad (CI).*\n\n` +
            `📷 Emondo peteĩ ta'anga potĩ ne Cédula rehegua (ambos lados) térã ehai ne número de Cédula ha nde réra tee.`,
        };
      }

      return {
        replyText: `✅ *Idioma configurado: Español.*\n\n` +
          `📸 *Paso 2/8 (Documento de Identidad):*\n` +
          `Envía una *foto NÍTIDA de tu Cédula de Identidad (CI)* por ambos lados.\n\n` +
          `_Nuestro sistema OCR extraerá tus datos automáticamente, o puedes escribir directamente tu Nombre Completo y Cédula (Ej: Juan Perez, 4.892.310)._`,
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
          const parts = cleanText.split(/[,:;-]/);
          if (parts.length >= 2) {
            extractedName = keepBest(extractedName, parts[0]);
            extractedCi = keepBest(extractedCi, parts[1].replace(/[^0-9]/g, ''));
          } else if (!extractedName) {
            extractedName = cleanText.trim();
          }
        }
      }

      // Todavía falta algo — guardá lo que haya y pedí solo lo que falta.
      if (!extractedName || !extractedCi) {
        await updateState('STEP2_DOCUMENT', { extractedName, extractedCi, ciPhotoUrl, extractedDob, extractedBirthPlace, extractedSex });
        const falta = !extractedName && !extractedCi ? 'tu nombre y tu número de cédula' : !extractedName ? 'tu nombre completo' : 'tu número de cédula';
        return {
          replyText:
            `😕 Me falta leer ${falta}.\n\n` +
            (extractedName ? `✅ Tengo: *${extractedName}*\n` : '') +
            (extractedCi ? `✅ Tengo cédula: *${extractedCi}*\n` : '') +
            `\nMandá otra foto más nítida de la cédula, o escribí (o mandá un audio con) tu *Nombre Completo y Número de Cédula*.\n` +
            `_Ejemplo: Carlos Benítez, 3500200_`,
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
          `\n¿Son correctos? No hace falta escribir nada más de tu cédula.\n` +
          `*[1]* Sí, continuar ✅\n` +
          `*[2]* No, corregir manualmente ✏️`,
      };
    }

    // STEP 2 CONFIRMATION
    if (state === 'STEP2_CONFIRM_CI') {
      const tempData = getTempData();
      if (cleanText === '1' || cleanText.toLowerCase().includes('si') || cleanText.toLowerCase().includes('correcto')) {
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
              `🚨 *Paso 3/8 (Contacto de Emergencia):*\n` +
              `Escribí el nombre y teléfono de la persona a quien debemos avisar si te pasa algo.\n\n` +
              `_Ejemplo: María Pérez, 0981-123-456 (Madre)_`,
            `✅ *Nde identidad oñeguarda.*\n\n` +
              `🚨 *Paso 3/8 (Contacto de Emergencia):*\n` +
              `Ehai téra ha teléfono pe persóna romomarandúva'erãva oĩ ramo mba'e ndéve.\n\n` +
              `_Techapyrã: María Pérez, 0981-123-456 (Sy)_`
          ),
        };
      } else {
        await updateState('STEP2_DOCUMENT');
        return {
          replyText: `✏️ Por favor, escribe tu *Nombre Completo y Número de Cédula* separados por coma:\n(Ej: Carlos Benitez, 3500200)`,
        };
      }
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
            `🏠 *Paso 4/8 (Domicilio):*\n` +
            `Escribe tu dirección exacta (calle, número de casa, barrio y ciudad).\n\n` +
            `_Ejemplo: Avda. Mariscal López 1234, Barrio Villa Morra, Asunción_`,
          `✅ *Nde contacto de emergencia oñeguarda:* ${contactName} (${contactPhone})\n\n` +
            `🏠 *Paso 4/8 (Nde róga renda):*\n` +
            `Ehai nde dirección exacta (calle, tapỹi papapy, barrio ha táva).\n\n` +
            `_Techapyrã: Avda. Mariscal López 1234, Barrio Villa Morra, Paraguay_`
        ),
      };
    }

    // STEP 4: ADDRESS
    if (state === 'STEP4_ADDRESS') {
      await updateState('STEP5_EMAIL', { address: cleanText }, { address: cleanText });

      return {
        replyText: tr(
          `✅ *Domicilio registrado.*\n\n` +
            `📧 *Paso 5/8 (Correo Electrónico):*\n` +
            `Ingresa tu correo electrónico para enviarte facturas, comprobantes y tu respaldo histórico.\n\n` +
            `_Ejemplo: usuario@correo.com_`,
          `✅ *Nde róga renda oñeguarda.*\n\n` +
            `📧 *Paso 5/8 (Correo Electrónico):*\n` +
            `Ehai nde correo electrónico romondo hagua ndéve factura, comprobante ha nde respaldo.\n\n` +
            `_Techapyrã: puruhára@correo.com_`
        ),
      };
    }

    // STEP 5: EMAIL
    if (state === 'STEP5_EMAIL') {
      await updateState('STEP6_CONDITIONS', { email: cleanText }, { email: cleanText });

      return {
        replyText: tr(
          `✅ *Correo registrado:* ${cleanText}\n\n` +
            `🩺 *Paso 6/8 (Datos Médicos Críticos de Emergencia):*\n` +
            `Selecciona tus condiciones médicas preexistentes respondiendo con los números separados por coma:\n\n` +
            `*[1]* Diabetes\n*[2]* Epilepsia\n*[3]* Hipertensión Arterial\n*[4]* Marcapasos / Cardiopatía\n*[5]* Ninguna condición\n\n` +
            `_Luego escribe también tus alergias severas (ej: "1, 3 - Alergia a Penicilina e Ibuprofeno")_`,
          `✅ *Nde correo oñeguarda:* ${cleanText}\n\n` +
            `🩺 *Paso 6/8 (Nde mba'asy oĩva - Emergencia):*\n` +
            `Eiporavo mba'asy reguerekóva, embohovái umi papapy coma rupive:\n\n` +
            `*[1]* Diabetes\n*[2]* Epilepsia\n*[3]* Hipertensión\n*[4]* Marcapasos / Ñe'ãrasy\n*[5]* Mba'eve\n\n` +
            `_Upéi ehai avei mba'épa nde alergia hatãva (techapyrã: "1, 3 - Alergia Penicilina ha Ibuprofeno")_`
        ),
      };
    }

    // STEP 6: MEDICAL CONDITIONS & ALLERGIES
    if (state === 'STEP6_CONDITIONS') {
      const conditionMap: Record<string, string> = {
        '1': 'Diabetes',
        '2': 'Epilepsia',
        '3': 'Hipertensión',
        '4': 'Marcapasos',
        '5': 'Ninguna',
      };

      const selectedConditions: string[] = [];
      for (const [key, label] of Object.entries(conditionMap)) {
        if (cleanText.includes(key) && label !== 'Ninguna') {
          selectedConditions.push(label);
        }
      }

      // Extract allergy text
      let allergies = cleanText.replace(/[1-5,\-]/g, '').trim();
      if (!allergies) allergies = 'Ninguna declarada';

      await updateState('STEP7_PIN', { selectedConditions, allergies }, {
        emergencyConditions: JSON.stringify(selectedConditions),
        severeAllergies: allergies,
        contraindicatedMeds: allergies.toLowerCase().includes('penicilina') ? 'Penicilina, Betalactámicos' : 'Ninguno declarado',
      });

      return {
        replyText: tr(
          `✅ *Condiciones médicas y alergias registradas.*\n\n` +
            `🔐 *Paso 7/8 (PIN de Seguridad Zero-Knowledge):*\n` +
            `Crea un *PIN secreto de 4 dígitos* (Ej: 8492).\n\n` +
            `🛡️ *Importante:* este PIN es tu llave privada. Ni nosotros ni los administradores podemos ver tus estudios sin él.`,
          `✅ *Nde mba'asy ha alergia oñeguarda.*\n\n` +
            `🔐 *Paso 7/8 (PIN Seguridad Zero-Knowledge):*\n` +
            `Emoheñói peteĩ *PIN ñemi 4 papapýgui* (Techapyrã: 8492).\n\n` +
            `🛡️ *Iñimportánteva:* ko PIN ha'e nde llave privada. Ni ore ni administrador ndaikatúi rohecha nde estudio ndaipóri ramo.`
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

      await updateState('STEP8_PAYMENT', { pinSet: true }, {
        pinHash,
        encryptionSalt: salt,
        encryptedMedicalBlob: initialEncryptedBlob,
      });

      // Precios en vivo (editables desde /admin → Contenido).
      const pr = await PaymentService.getPlanPrices();
      const gs = (n: number) => `Gs. ${n.toLocaleString('es-PY')}`;
      const rs = (n: number) => `R$ ${n.toLocaleString('pt-BR')}`;
      const menu =
        `🇵🇾 *Paraguay:*\n*[1]* Plan Mensual (${gs(pr.PY.MONTHLY)} / mes)\n*[2]* Plan Anual (${gs(pr.PY.ANNUAL)} / año)\n\n` +
        `🇧🇷 *Brasil:*\n*[3]* Plano Mensal (${rs(pr.BR.MONTHLY)} / mês)\n*[4]* Plano Anual (${rs(pr.BR.ANNUAL)} / ano)\n\n`;

      return {
        replyText: tr(
          `🔒 *¡PIN de seguridad cifrado con éxito!*\n\n` +
            `💳 *Paso 8/8 (Activación y Pago):*\n` +
            `Elegí tu país y plan para activar tu Bio-Pass y generar tu QR de rescate:\n\n` +
            menu +
            `_Respondé 1, 2, 3 o 4 para recibir el link de pago y el código PIX / Alias._`,
          `🔒 *Nde PIN oñecifra porã!*\n\n` +
            `💳 *Paso 8/8 (Activación ha Pago):*\n` +
            `Eiporavo nde tetã ha plan remoañete hagua nde Bio-Pass ha emoheñói nde QR:\n\n` +
            menu +
            `_Embohovái 1, 2, 3 térã 4 rehupyty hagua link de pago ha código PIX / Alias._`
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
          // Bancard / PIX / transferencia manual: la confirmación autoritativa llega por webhook.
          // Este "PAGAR" es el atajo manual del usuario.
          await PaymentService.handlePaymentSuccess(lastOrder.referenceCode);
          return { replyText: `✅ *Pago procesado con éxito.*` };
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
            `*[5]* ⏰ *Recordatorios* de medicación\n` +
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
            ocrRawText: rx.rawText,
            aiSummary: rx.aiSummary,
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
            ocrRawText: studyOcr.rawText,
            aiSummary: studyOcr.aiSummary,
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
            select: { id: true, medication: true, dose: true, times: true, active: true },
          });

        const rows = await list();
        const showList = () => {
          const body = rows.length
            ? MedicationReminderService.format(rows)
            : tr('_No tenés recordatorios configurados._', '_Ndaipóri momandu\'a._');
          return (
            `⏰ *${tr('Recordatorios de medicación', "Momandu'a pohã")}*\n\n${body}\n\n` +
            tr(
              'Para *agregar*: escribí o mandá un audio con *medicamento + horarios*.\n' +
                '_Ej: "Losartán 50 mg 08:00 y 20:00"_\n' +
                'Para *borrar*: escribí *borrar 2*. Para *pausar/activar*: *pausar 1* / *activar 1*.\n' +
                '_Escribí *LISTO* para volver._',
              'Embojoapy hag̃ua: ehai *pohã + hora*.\n_Techapyrã: "Losartán 08:00 ha 20:00"_\n' +
                'Embogue hag̃ua: *borrar 2*. _Ehai *LISTO* rehóvo._'
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
          const parsed = MedicationReminderService.parse(cleanText);
          if (!parsed) {
            return {
              replyText: tr(
                '😕 Necesito el *medicamento* y al menos un *horario*.\n_Ej: "Enalapril 10 mg 08:00 y 21:00"_',
                '😕 Aikotevẽ *pohã* ha *hora*.\n_Techapyrã: "Enalapril 08:00 ha 21:00"_'
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
          return {
            replyText:
              tr(
                `✅ Recordatorio creado: 💊 *${created.medication}*${created.dose ? ` (${created.dose})` : ''} — ⏰ ${parsed.times.join(', ')}\n` +
                  `Te voy a avisar por acá a esos horarios, todos los días.`,
                `✅ Momandu'a: 💊 *${created.medication}* — ⏰ ${parsed.times.join(', ')}`
              ) +
              (conflicts.length ? `\n\n⚠️ ${conflicts.map((c) => `• ${c}`).join('\n')}` : '') +
              '\n\n' +
              showList(),
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
          select: { medication: true, dose: true, times: true, active: true },
        });
        return {
          replyText:
            `⏰ *${tr('Recordatorios de medicación', "Momandu'a pohã")}*\n\n` +
            (rms.length ? MedicationReminderService.format(rms) + '\n\n' : '') +
            tr(
              'Escribí o mandá un *audio* con *medicamento + horarios* para agregar uno.\n' +
                '_Ej: "Metformina 850 mg 08:00 y 21:00"_\n' +
                '_Borrar: "borrar 2" · Pausar: "pausar 1" · Volver: *LISTO*_',
              'Ehai *pohã + hora* embojoapy hag̃ua.\n_Techapyrã: "Metformina 08:00 ha 21:00"_\n_Ehai *LISTO* rehóvo._'
            ),
        };
      }
      if (cleanText === '6' || lc.includes('descargar qr') || lc.includes('sticker') || lc.includes('kit')) {
        const sticker = await QrPdfService.generateStickerPdf({
          emergencyToken: user.emergencyToken,
          userName: user.fullName || 'Usuario Bio-Pass',
          bloodType: user.bloodType || 'O Positivo',
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
