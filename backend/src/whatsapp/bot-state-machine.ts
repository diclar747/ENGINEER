import { prisma } from '../database/prisma';
import { ZeroKnowledgeSecurity } from '../security/zero-knowledge';
import { OcrAiService } from '../services/ocr-ai.service';
import { PaymentService } from '../services/payment.service';
import { QrPdfService } from '../services/qr-pdf.service';
import { StorageService } from '../storage/storage.service';
import { NiroService } from '../services/niro.service';
import { WinsapService } from '../services/winsap.service';
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


const NIRO_SYSTEM_PROMPT =
  'Sos el asistente virtual de Bio-Pass, un pasaporte medico digital de emergencia (Paraguay). ' +
  'Responde en espanol, breve y claro (maximo 4 lineas), tono cordial. Ayuda con dudas sobre: que es Bio-Pass, ' +
  'como funciona la ficha de emergencia y el QR, planes y pagos, como subir estudios, seguridad de los datos. ' +
  'No inventes precios exactos ni datos medicos; para pasos concretos sugerir escribir MENU. ' +
  'Si preguntan algo fuera de tema, redirigir amablemente.';

/** Decodes a `data:<mime>;base64,<...>` string (as produced by QRCode.toDataURL)
 *  into a BotResponse mediaAttachment ready to send as an inline image. */
function qrAttachment(dataUrl: string | undefined | null, caption: string): BotResponse['mediaAttachment'] | undefined {
  if (!dataUrl) return undefined;
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) return undefined;
  return { buffer: Buffer.from(m[2], 'base64'), mimetype: m[1], filename: 'pago-qr.png', caption, kind: 'image' };
}

async function askNiro(userText: string, name?: string): Promise<string | null> {
  if (!NiroService.enabled || !userText || userText.trim().length < 4) return null;
  return NiroService.chat([
    { role: 'system', content: NIRO_SYSTEM_PROMPT + (name ? ` El usuario se llama ${name}.` : '') },
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
      let extractedName = '';
      let extractedCi = '';
      let ciPhotoUrl = '';
      let extractedDob = '';
      let extractedBirthPlace = '';
      let extractedSex = '';

      if (msg.mediaBuffer) {
        const saved = await StorageService.saveFile('ci_documents', `ci_${user.id}_${Date.now()}.jpg`, msg.mediaBuffer);
        ciPhotoUrl = saved.fileUrl;
        const ocrResult = await OcrAiService.processCiImage(msg.mediaBuffer, msg.mediaFilename || 'ci.jpg');
        extractedName = (ocrResult.fullName || '').trim();
        extractedCi = (ocrResult.ciNumber || '').trim();
        // Everything the AI could read off the document — captured now so the user
        // never has to type it later (date/place of birth, sex).
        extractedDob = (ocrResult.dateOfBirth || '').trim();
        extractedBirthPlace = (ocrResult.birthPlace || '').trim();
        extractedSex = (ocrResult.sex || '').trim();
      } else {
        // Manual input: "Nombre, CI"
        const parts = cleanText.split(/[,:-]/);
        if (parts.length >= 2) {
          extractedName = parts[0].trim();
          extractedCi = parts[1].replace(/[^0-9]/g, '');
        } else {
          extractedName = cleanText.trim();
        }
      }

      // Couldn't read anything usable — ask the user to type it
      if (!extractedName || !extractedCi) {
        await updateState('STEP2_DOCUMENT', {}, {});
        return {
          replyText:
            `😕 No pude leer con claridad ${!extractedName && !extractedCi ? 'tus datos' : !extractedName ? 'tu nombre' : 'tu número de cédula'}.\n\n` +
            `Escribí tu *Nombre Completo y Número de Cédula* separados por coma:\n` +
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

      return {
        replyText: tr(
          `🔒 *¡PIN de seguridad cifrado con éxito!*\n\n` +
            `💳 *Paso 8/8 (Activación y Pago):*\n` +
            `Elegí tu país y plan para activar tu Bio-Pass y generar tu QR de rescate:\n\n` +
            `🇵🇾 *Paraguay:*\n*[1]* Plan Mensual (Gs. 35.000 / mes)\n*[2]* Plan Anual (Gs. 300.000 / año · 30% off)\n\n` +
            `🇧🇷 *Brasil:*\n*[3]* Plano Mensal (R$ 25 / mês)\n*[4]* Plano Anual (R$ 220 / ano · 25% off)\n\n` +
            `_Respondé 1, 2, 3 o 4 para recibir el link de pago y el código PIX / Alias._`,
          `🔒 *Nde PIN oñecifra porã!*\n\n` +
            `💳 *Paso 8/8 (Activación ha Pago):*\n` +
            `Eiporavo nde tetã ha plan remoañete hagua nde Bio-Pass ha emoheñói nde QR:\n\n` +
            `🇵🇾 *Paraguay:*\n*[1]* Plan Mensual (Gs. 35.000 / mes)\n*[2]* Plan Anual (Gs. 300.000 / ary · 30% off)\n\n` +
            `🇧🇷 *Brasil:*\n*[3]* Plano Mensal (R$ 25)\n*[4]* Plano Anual (R$ 220)\n\n` +
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
              ? `📷 *Escaneá el QR de arriba* con tu app del banco (Bancard / QR interbancario) para pagar al instante.\n\n`
              : '') +
            `🏦 *Transferencia SIPAP Directa:*\n` +
            `${order.aliasInfo}\n\n` +
            `🌐 *O pagá con Tarjeta / Bancard / QR desde el navegador:*\n${order.paymentLink}\n\n` +
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
          if (lastOrder.gateway === 'WINSAP') {
            // Real check against Winsap's transaction list — no blind trust.
            const wStatus = await WinsapService.getStatusByReference(lastOrder.referenceCode);
            if (wStatus === 'paid') {
              await PaymentService.handlePaymentSuccess(lastOrder.referenceCode);
              return { replyText: `✅ *Pago confirmado por Winsap.* Activando tu cuenta…` };
            }
            return {
              replyText:
                wStatus === 'cancelled'
                  ? `⚠️ *Ese pago figura cancelado en Winsap.*\n\nEscribí *1*, *2*, *3* o *4* para generar una nueva orden.`
                  : `⏳ *Todavía no vemos el pago acreditado en Winsap.*\n\nSi ya pagaste, esperá unos segundos (a veces demora en confirmarse) y volvé a escribir *PAGAR*.`,
            };
          }

          // Non-Winsap gateways (Bancard / PIX / transferencia manual): kept as before.
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
    if (user.status === 'ACTIVE' || state === 'ACTIVE_MEMBER') {
      // Check if user sent media (Medical Study / Blood analysis / X-Ray)
      if (msg.mediaBuffer) {
        const saved = await StorageService.saveFile('medical_studies', `study_${user.id}_${Date.now()}.jpg`, msg.mediaBuffer);
        const studyOcr = await OcrAiService.processMedicalStudy(msg.mediaBuffer, msg.mediaFilename || 'estudio.jpg');

        await prisma.medicalStudy.create({
          data: {
            userId: user.id,
            title: studyOcr.title,
            studyType: studyOcr.studyType,
            studyDate: studyOcr.studyDate || new Date(),
            fileUrl: saved.fileUrl,
            ocrRawText: studyOcr.rawText,
            aiSummary: studyOcr.aiSummary,
          },
        });

        const engine =
          studyOcr.source === 'ai+ocr' ? 'OCR + Inteligencia Artificial'
          : studyOcr.source === 'ocr' ? 'OCR'
          : 'almacenamiento seguro';
        const findingsBlock = studyOcr.keyFindings.length
          ? `\n📊 *Hallazgos:*\n${studyOcr.keyFindings.slice(0, 6).map((f) => `• ${f}`).join('\n')}\n`
          : '';
        return {
          replyText: `🩺 *ESTUDIO MÉDICO PROCESADO (${engine})*\n\n` +
            `📋 *Tipo:* ${studyOcr.title}\n` +
            `📅 *Fecha:* ${(studyOcr.studyDate || new Date()).toLocaleDateString('es-PY', { timeZone: config.timezone })}\n` +
            `🤖 *Resumen:* ${studyOcr.aiSummary}\n${findingsBlock}\n` +
            `✅ Clasificado y subido a tu Bóveda Médica Cifrada.\n` +
            `Solo vos y tu médico pueden verlo ingresando tu PIN en la plataforma web.`,
        };
      }

      // Option 1: Upload study info
      if (cleanText === '1' || cleanText.toLowerCase().includes('subir estudio')) {
        return {
          replyText: `📸 *Subida de Estudios Médicos:*\n\n` +
            `Envía ahora la *foto o PDF* de tu análisis de sangre, radiografía, tomografía o receta médica.\n\n` +
            `_Nuestra IA aplicará OCR + Vision para extraer la fecha, tipo de estudio y hallazgos clave automáticamente._`,
        };
      }

      // Option 2: Edit data / NLP profile update
      if (cleanText === '2' || cleanText.toLowerCase().includes('modificar')) {
        return {
          replyText: `✏️ *Actualización Inteligente de Perfil:*\n\n` +
            `Puedes escribir en lenguaje natural lo que deseas actualizar. Ejemplos:\n` +
            `• _"Cambiar alergia a Penicilina e Ibuprofeno"_\n` +
            `• _"Nuevo contacto Carlos Perez 0981999888"_\n` +
            `• _"Cambiar dirección a Avda España 500"_\n\n` +
            `_Escribe tu mensaje a continuación:_`,
        };
      }

      // Option 3: Download QR & Sticker PDF
      if (cleanText === '3' || cleanText.toLowerCase().includes('descargar qr')) {
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

      // Option 4: Support
      if (cleanText === '4' || cleanText.toLowerCase().includes('soporte')) {
        return {
          replyText: `👨‍⚕️ *Soporte Técnico Doorway Cortex Bio-Pass:*\n\n` +
            `Para asistencia médica, corporativa o reclamos de facturación, comunícate con soporte@bio-pass.com o llama al +595 21 500 000.`,
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
        const ai = await askNiro(cleanText, user.fullName || undefined);
        if (ai) return { replyText: ai + '\n\n_Escribi *MENU* para ver las opciones._' };
      }

      // Default Active Menu
      return {
        replyText: `👋 *Hola, ${user.fullName || 'Titular Bio-Pass'}*\n\n` +
          `¿Qué deseas realizar hoy?\n\n` +
          `*[1]* 📤 Subir nuevo estudio médico (Foto/PDF)\n` +
          `*[2]* ✏️ Modificar datos de emergencia o alergias\n` +
          `*[3]* 🏷️ Descargar Kit de Stickers (3x3 cm) y QR\n` +
          `*[4]* 💬 Hablar con soporte\n\n` +
          `_Responde con el número de la opción o escribe tu consulta._`,
      };
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
      const ai = await askNiro(cleanText);
      if (ai) return { replyText: `${ai}\n\n_Escribí *MENU* para comenzar tu registro._` };
    }
    return {
      replyText: `👋 Bienvenido a Bio-Pass. Escribe 'MENU' para comenzar.`,
    };
  }
}
