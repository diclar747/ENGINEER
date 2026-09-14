import { NiroService } from '../services/niro.service';

export interface ParsedProfileIntent {
  intent:
    | 'CHANGE_ALLERGY'
    | 'CHANGE_CONTACT'
    | 'CHANGE_ADDRESS'
    | 'CHANGE_CONDITIONS'
    | 'CHANGE_NAME'
    | 'CHANGE_CI'
    | 'CHANGE_EMAIL'
    | 'CHANGE_BLOOD_TYPE'
    | 'UNKNOWN';
  value?: string;
  contactName?: string;
  contactPhone?: string;
  contactRelationship?: string;
  isIntentOnly?: boolean;
}

export class NlpHandler {
  /**
   * Fast synchronous heuristic parser for natural language profile update commands
   */
  public static parseIntent(text: string): ParsedProfileIntent {
    const raw = (text || '').trim();
    const clean = raw.toLowerCase();
    if (!clean) return { intent: 'UNKNOWN' };

    // 1. Change email: "cambiar mi correo a juan@gmail.com", "mi nuevo email es...", "quiero cambiar el correo"
    if (/\b(correo|email|mail|e-mail)\b/i.test(clean)) {
      const emailMatch = raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch) {
        return {
          intent: 'CHANGE_EMAIL',
          value: emailMatch[1].trim().toLowerCase(),
          isIntentOnly: false,
        };
      }
      if (/\b(cambiar|cambi[aá]|modificar|actualizar|nuevo|nueva|editar|corregir|poner)\b/i.test(clean)) {
        return {
          intent: 'CHANGE_EMAIL',
          isIntentOnly: true,
        };
      }
    }

    // 2. Change blood type: "mi grupo sanguineo es O+", "cambiar tipo de sangre a A positivo"
    if (/\b(sangre|grupo\s+sangu[ií]neo|tipo\s+de\s+sangre)\b/i.test(clean)) {
      const btMatch = clean.match(/\b(o|a|b|ab)\s*([+-]|positivo|negativo)\b/i);
      if (btMatch) {
        const sign = /pos/i.test(btMatch[2]) || btMatch[2] === '+' ? '+' : '-';
        const type = `${btMatch[1].toUpperCase()}${sign}`;
        return { intent: 'CHANGE_BLOOD_TYPE', value: type, isIntentOnly: false };
      }
      return { intent: 'CHANGE_BLOOD_TYPE', isIntentOnly: true };
    }

    // 3. Change emergency contact:
    // Audio / text: "Quiero cambiar el número de teléfono y el nombre para el tema de emergencia, para llamar emergencia"
    // "Nuevo contacto Maria Perez 0981123456", "Cambiar contacto a Carlos 0982-111-222", "modificar datos de emergencia"
    const mentionsContact =
      clean.includes('contacto') ||
      clean.includes('familiar') ||
      clean.includes('avisar') ||
      /\b(datos?\s+de\s+emergencias?|persona\s+de\s+emergencia|contacto\s+de\s+emergencia)\b/i.test(clean) ||
      /\b(a\s+quien\s+(?:se\s+)?llamar?|a\s+quien\s+avisar|quien\s+llamar)\b/i.test(clean) ||
      /\b(madre|mam[aá]|padre|pap[aá]|espos[ao]|herman[ao]|hij[ao]|t[ií][ao]|prim[ao]|pareja|novi[ao]|amig[ao]|vecin[ao])\b/i.test(clean) ||
      /\b(cambiar|cambi[aá]|modificar|actualizar|editar|nuevo|nueva)\b.{0,35}\b(n[uú]mero|tel[eé]fono|nombre|persona|contacto|familiar|quien\s+llamar|datos)\b.{0,35}\b(emergencia|emergencias|urgencia|rescate|llamar)\b/i.test(clean) ||
      (/\b(emergencia|emergencias|llamar\s+emergencia|en\s+caso\s+de\s+emergencia)\b/i.test(clean) &&
        /\b(tel[eé]fono|n[uú]mero|nombre|persona|contacto|quien|llamar|datos)\b/i.test(clean));

    if (mentionsContact) {
      const phoneMatch = raw.match(/(\+?\d[\d\s.-]{6,14}\d)/);
      const contactPhone = phoneMatch ? phoneMatch[1].replace(/[^\d+]/g, '') : undefined;

      let relMatch = raw.match(
        /\b(madre|mam[aá]|padre|pap[aá]|espos[ao]|herman[ao]|hij[ao]|t[ií][ao]|prim[ao]|pareja|novi[ao]|amig[ao]|vecin[ao]|familiar)\b/i
      );
      const contactRelationship = relMatch ? relMatch[1].charAt(0).toUpperCase() + relMatch[1].slice(1).toLowerCase() : undefined;

      // Distinguir si el usuario solo pide la acción sin dar todavía nombre ni teléfono
      const isPureIntent =
        !phoneMatch &&
        (/\b(cambiar|cambi[aá]|modificar|actualizar|editar|poner|corregir)\b/i.test(clean) ||
          /^(datos?\s+de\s+emergencias?|contacto(\s+de\s+emergencia)?|familiar)$/i.test(clean) ||
          /\b(forma\s+cuando\s+hay|quien\s+se\s+llama|a\s+quien\s+llamar|en\s+caso\s+de\s+emergencia)\b/i.test(clean)) &&
        !/\b(?:es|a|nombre)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,})/i.test(raw);

      if (isPureIntent) {
        return { intent: 'CHANGE_CONTACT', isIntentOnly: true };
      }

      let contactName: string | undefined;
      if (phoneMatch) {
        const pIdx = phoneMatch.index ?? 0;
        let namePart = raw.slice(0, pIdx);
        if (!namePart.trim() || namePart.trim().length < 3) {
          namePart = raw.slice(pIdx + phoneMatch[0].length);
        }
        const llamaMatch = namePart.match(/(?:se llama|llamado|llamada|nombre(?:\s+es)?)\s+([\p{L}\s]+)$/iu);
        if (llamaMatch) namePart = llamaMatch[1];

        const candidate = namePart
          .replace(
            /\b(quiero|necesito|cambiar|cambi[aá]|cambio|modificar|actualizar|editar|nuevo|nueva|contacto|familiar|emergencia|emergencias|avisar|es|mi|su|el|la|que|se|llama|llamado|llamada|y|a|para|numero|número|telefono|teléfono|celular|whatsapp|de|tema|llamar|madre|mam[aá]|padre|pap[aá]|espos[ao]|herman[ao]|hij[ao]|t[ií][ao]|prim[ao]|pareja|novi[ao]|amig[ao]|vecin[ao])\b/gi,
            ' '
          )
          .replace(/[^\p{L}\s]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const fillerWords = /^(forma|cuando|hay|quien|caso|algo|alguien|nada|datos|favor|por\s+favor)$/i;
        if (candidate.length >= 3 && !fillerWords.test(candidate)) {
          contactName = candidate;
        }
      } else {
        const nameMatch = raw.match(/(?:contacto|familiar|emergencia|llamar\s+a)\s+(?:a|es|nuevo|se\s+llama)?\s*([A-ZÁÉÍÓÚÑa-záéíóúñ]{2,}(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{2,})+)/i);
        if (nameMatch) {
          contactName = nameMatch[1].trim();
        }
      }

      const hasValidPhone = !!contactPhone && contactPhone.replace(/\D/g, '').length >= 7;
      const hasValidName = !!contactName && contactName.length >= 3;

      if (hasValidPhone && hasValidName) {
        return { intent: 'CHANGE_CONTACT', contactName, contactPhone, contactRelationship, isIntentOnly: false };
      }
      if (hasValidPhone && !hasValidName) {
        return { intent: 'CHANGE_CONTACT', contactPhone, contactRelationship, isIntentOnly: false };
      }
      if (hasValidName && !hasValidPhone) {
        return { intent: 'CHANGE_CONTACT', contactName, contactRelationship, isIntentOnly: false };
      }
      return { intent: 'CHANGE_CONTACT', isIntentOnly: true };
    }

    // 4. Change address: "Cambiar dirección a Avda España 1234", "Mi direccion es Calle 5 Asuncion"
    if (
      clean.includes('dirección') ||
      clean.includes('direccion') ||
      clean.includes('domicilio') ||
      clean.includes('vivo en') ||
      clean.includes('donde vivo')
    ) {
      const m = raw.match(/\b(?:direcci[oó]n|domicilio|donde\s+vivo|vivo\s+en)\b(?:\s+(?:es|a|de|nueva))?\s*[:]?\s*(.+)/i);
      const val = m ? m[1].replace(/^[.:,\s]+/, '').trim() : '';
      if (val.length >= 4) {
        return { intent: 'CHANGE_ADDRESS', value: val, isIntentOnly: false };
      }
      return { intent: 'CHANGE_ADDRESS', isIntentOnly: true };
    }

    // 5. Change allergy: "Cambiar alergia a Penicilina", "Mi alergia es al maní", "Nueva alergia sulfas"
    if (clean.includes('alergia') || clean.includes('alérgico') || clean.includes('alergico')) {
      const m = raw.match(/\b(?:alergia|al[eé]rgic[oa])\b(?:\s+(?:es|a|a\s+la|al|con|de|nueva))?\s*[:]?\s*(.+)/i);
      const val = m ? m[1].replace(/^[.:,\s]+/, '').trim() : '';
      const isVerbOnly = /^(cambiar|corregir|actualizar|editar|poner|modificar)\s*$/i.test(val);
      if (val.length >= 2 && !isVerbOnly) {
        return { intent: 'CHANGE_ALLERGY', value: val, isIntentOnly: false };
      }
      return { intent: 'CHANGE_ALLERGY', isIntentOnly: true };
    }

    // 6. Change conditions: "Agregar condición Diabetes", "Tengo Hipertensión"
    if (clean.includes('condición') || clean.includes('condicion') || clean.includes('enfermedad') || clean.includes('tengo')) {
      return { intent: 'CHANGE_CONDITIONS', value: raw, isIntentOnly: false };
    }

    // 7. Change name: "Mi nombre es Carlos Benitez", "cambiar mi nombre a..."
    if (/\bnombre\b|\bme\s+llamo\b/i.test(clean) && !clean.includes('contacto') && !clean.includes('familiar') && !clean.includes('emergencia')) {
      const m = raw.match(
        /(?:nombre(?:\s+completo)?|me\s+llamo)\b(?:\s+(?:correcto|es|a|de|en\s+realidad|por))*\s*[:]?\s*([\p{L}\s]{3,})/iu
      );
      const val = (m ? m[1] : '').replace(/[.!]+$/, '').trim();
      const isVerbOnly = /^(cambiar|corregir|actualizar|editar|poner|modificar)\s*$/i.test(val);
      if (val.length >= 3 && !isVerbOnly) return { intent: 'CHANGE_NAME', value: val, isIntentOnly: false };
      if (/\b(cambiar|corregir|actualizar|editar|modificar)\b/i.test(clean)) {
        return { intent: 'CHANGE_NAME', isIntentOnly: true };
      }
    }

    // 8. Change CI: "Mi cédula es 3500200", "cédula correcta 4892310", "cambiar cedula a 1234567"
    if (/\bc[eé]dula\b|\bci\b/i.test(clean) && !clean.includes('foto')) {
      const m = raw.match(/(?:c[eé]dula|ci|documento)\b.*?\b(\d[\d.\-\s]{4,14}\d)/i);
      const value = m ? m[1].replace(/[^\d]/g, '') : '';
      if (value.length >= 5) return { intent: 'CHANGE_CI', value, isIntentOnly: false };
      if (/\b(cambiar|corregir|actualizar|editar|modificar|nueva)\b/i.test(clean)) {
        return { intent: 'CHANGE_CI', isIntentOnly: true };
      }
    }

    return { intent: 'UNKNOWN' };
  }

  /**
   * Interprets natural language profile update commands with AI fallback (Niro Qwen/Whisper)
   */
  public static async parseIntentAsync(text: string): Promise<ParsedProfileIntent> {
    const sync = this.parseIntent(text);
    // If sync resolved an actionable intent with data, return immediately
    if (sync.intent !== 'UNKNOWN' && !sync.isIntentOnly) {
      return sync;
    }

    // If sync was UNKNOWN or isIntentOnly, and Niro is available, ask the AI model
    if (NiroService.enabled && text && text.trim().length >= 4) {
      try {
        const ai = await NiroService.extractFields(
          text,
          'Analizá este mensaje de un usuario que desea modificar sus datos en su pasaporte médico digital Bio-Pass. ' +
            'Devolvé un JSON con: ' +
            'intent ("CHANGE_CONTACT" | "CHANGE_EMAIL" | "CHANGE_ADDRESS" | "CHANGE_ALLERGY" | "CHANGE_CONDITIONS" | "CHANGE_NAME" | "CHANGE_CI" | "CHANGE_BLOOD_TYPE" | "UNKNOWN"); ' +
            'contactName (nombre del contacto de emergencia o null); ' +
            'contactPhone (número de teléfono o celular del contacto o null, sólo dígitos y código +); ' +
            'contactRelationship (parentesco si lo mencionó: Madre, Padre, Hermano, Esposa, etc. o null); ' +
            'email (nueva dirección de correo electrónico o null); ' +
            'address (nueva dirección física/domicilio o null); ' +
            'allergy (alergia a agregar o modificar o null); ' +
            'condition (enfermedad o condición médica a agregar o modificar o null); ' +
            'fullName (nombre completo de la persona si lo corrige o null); ' +
            'ciNumber (número de cédula si lo corrige o null); ' +
            'bloodType (grupo sanguíneo ej: O+, A-, AB+ o null); ' +
            'isIntentOnly (true si el usuario sólo pide cambiar algo pero NO proporcionó el nuevo valor todavía, false si ya dio el dato).'
        );

        if (ai && ai.intent && ai.intent !== 'UNKNOWN') {
          const intent = ai.intent as ParsedProfileIntent['intent'];
          const val =
            ai.email ||
            ai.address ||
            ai.allergy ||
            ai.condition ||
            ai.fullName ||
            ai.ciNumber ||
            ai.bloodType ||
            undefined;

          const hasData =
            !!(ai.contactName && ai.contactPhone) ||
            !!val;

          return {
            intent,
            value: val ? String(val).trim() : undefined,
            contactName: ai.contactName ? String(ai.contactName).trim() : undefined,
            contactPhone: ai.contactPhone ? String(ai.contactPhone).replace(/[^\d+]/g, '') : undefined,
            contactRelationship: ai.contactRelationship ? String(ai.contactRelationship).trim() : undefined,
            isIntentOnly: ai.isIntentOnly === true || !hasData,
          };
        }
      } catch (e: any) {
        console.warn('[NLP] parseIntentAsync Niro AI fallback error:', e?.message);
      }
    }

    return sync;
  }
}

