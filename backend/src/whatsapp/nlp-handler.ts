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
    // "Nuevo contacto Maria Perez 0981123456", "Cambiar contacto a Carlos 0982-111-222"
    const mentionsContact =
      clean.includes('contacto') ||
      clean.includes('familiar') ||
      clean.includes('avisar') ||
      /\b(madre|mam[aá]|padre|pap[aá]|espos[ao]|herman[ao]|hij[ao]|t[ií][ao]|prim[ao]|pareja|novi[ao]|amig[ao]|vecin[ao])\b/i.test(clean) ||
      /\b(cambiar|cambi[aá]|modificar|actualizar|editar|nuevo|nueva)\b.{0,35}\b(n[uú]mero|tel[eé]fono|nombre|persona|contacto|familiar|quien\s+llamar)\b.{0,35}\b(emergencia|urgencia|rescate|llamar)\b/i.test(
        clean
      ) ||
      (/\b(emergencia|llamar\s+emergencia|en\s+caso\s+de\s+emergencia)\b/i.test(clean) &&
        /\b(tel[eé]fono|n[uú]mero|nombre|persona|contacto|quien|llamar)\b/i.test(clean));

    if (mentionsContact) {
      const phoneMatch = raw.match(/(\+?\d[\d\s.-]{6,14}\d)/);
      const contactPhone = phoneMatch ? phoneMatch[1].replace(/[^\d+]/g, '') : undefined;
      let namePart = phoneMatch ? raw.slice(0, phoneMatch.index) : raw;

      const llamaMatch = namePart.match(/(?:se llama|llamado|llamada|nombre(?:\s+es)?)\s+([\p{L}\s]+)$/iu);
      if (llamaMatch) namePart = llamaMatch[1];

      // Extract relationship if mentioned: Madre, Padre, Hermano, Esposa, etc.
      let contactRelationship: string | undefined;
      const relMatch = raw.match(
        /\b(madre|mam[aá]|padre|pap[aá]|espos[ao]|herman[ao]|hij[ao]|t[ií][ao]|prim[ao]|pareja|novi[ao]|amig[ao]|vecin[ao]|familiar)\b/i
      );
      if (relMatch) {
        contactRelationship = relMatch[1].charAt(0).toUpperCase() + relMatch[1].slice(1).toLowerCase();
      }

      const contactName = namePart
        .replace(
          /\b(quiero|necesito|cambiar|cambi[aá]|cambio|modificar|actualizar|editar|nuevo|nueva|contacto|familiar|emergencia|avisar|es|mi|su|el|la|que|se|llama|llamado|llamada|y|a|para|numero|número|telefono|teléfono|celular|whatsapp|de|tema|llamar)\b/gi,
          ' '
        )
        .replace(/\s+/g, ' ')
        .trim();

      const hasValidPhone = !!contactPhone && contactPhone.replace(/\D/g, '').length >= 7;
      const hasValidName = contactName.length >= 3 && !/\b(emergencia|llamar|tema)\b/i.test(contactName);

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
      const value = raw
        .replace(/.*(dirección|direccion|domicilio|vivo en|donde vivo|es\s+|a\s+)/i, '')
        .replace(/^[.:,\s]+/, '')
        .trim();
      if (value.length >= 4) {
        return { intent: 'CHANGE_ADDRESS', value, isIntentOnly: false };
      }
      return { intent: 'CHANGE_ADDRESS', isIntentOnly: true };
    }

    // 5. Change allergy: "Cambiar alergia a Penicilina", "Mi alergia es al maní", "Nueva alergia sulfas"
    if (clean.includes('alergia') || clean.includes('alérgico') || clean.includes('alergico')) {
      const value = raw.replace(/.*(alergia|alérgic[oa]|alergic[oa]|a\s+|es\s+|a\s+la\s+|al\s+)/i, '').trim();
      if (value.length >= 2) {
        return { intent: 'CHANGE_ALLERGY', value, isIntentOnly: false };
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
        /(?:mi\s+nombre(?:\s+completo)?\s+(?:correcto\s+)?(?:es|:)|(?:en\s+realidad\s+)?me\s+llamo|(?:cambiar|corregir|actualizar)\s+(?:mi\s+)?nombre(?:\s+completo)?\s+a|el\s+nombre\s+correcto\s+es)\s*[:]?\s*(.+)/i
      );
      const value = (m ? m[1] : '').replace(/[.!]+$/, '').trim();
      if (value.length >= 3) return { intent: 'CHANGE_NAME', value, isIntentOnly: false };
      if (/\b(cambiar|corregir|actualizar|editar)\b/i.test(clean)) {
        return { intent: 'CHANGE_NAME', isIntentOnly: true };
      }
    }

    // 8. Change CI: "Mi cédula es 3500200", "cédula correcta 4892310"
    if (/\bc[eé]dula\b/i.test(clean) && !clean.includes('foto')) {
      const m = raw.match(/c[eé]dula(?:\s+es|\s+correcta\s+es)?\s*[:]?\s*(\d[\d.\-\s]{4,14}\d)/i);
      const value = m ? m[1].replace(/[^\d]/g, '') : '';
      if (value.length >= 5) return { intent: 'CHANGE_CI', value, isIntentOnly: false };
      if (/\b(cambiar|corregir|actualizar|editar)\b/i.test(clean)) {
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

