export interface ParsedProfileIntent {
  intent: 'CHANGE_ALLERGY' | 'CHANGE_CONTACT' | 'CHANGE_ADDRESS' | 'CHANGE_CONDITIONS' | 'UNKNOWN';
  value?: string;
  contactName?: string;
  contactPhone?: string;
}

export class NlpHandler {
  /**
   * Interprets natural language profile update commands sent by the user
   */
  public static parseIntent(text: string): ParsedProfileIntent {
    const clean = text.trim().toLowerCase();

    // Change allergy: "Cambiar alergia a Penicilina", "Mi alergia es al maní", "Nueva alergia sulfas"
    if (clean.includes('alergia') || clean.includes('alérgico') || clean.includes('alergico')) {
      const value = text.replace(/.*(alergia|alérgic[oa]|alergic[oa]|a\s+|es\s+|a\s+la\s+|al\s+)/i, '').trim();
      return {
        intent: 'CHANGE_ALLERGY',
        value: value || 'Penicilina',
      };
    }

    // Change contact: "Nuevo contacto Maria Perez 0981123456", "Cambiar contacto a Carlos 0982-111-222",
    // o una frase hablada/transcripta más larga: "mi nuevo contacto de emergencia se
    // llama Carlos Perez y su número de teléfono es 0981123456". La versión anterior
    // usaba un solo regex `.*(contacto|familiar|a|...)` MUY codicioso — como "a" es
    // una de las alternativas y aparece suelta en cualquier lado, en frases largas
    // recortaba el nombre en un punto random y dejaba basura tipo "ero y su número
    // de teléfono". Ahora: se saca el teléfono primero (donde sea que esté), y del
    // nombre se van sacando TODAS las palabras de relleno, no solo hasta la última.
    if (clean.includes('contacto') || clean.includes('familiar') || clean.includes('avisar')) {
      const phoneMatch = text.match(/(\+?\d[\d\s.-]{6,14}\d)/);
      const contactPhone = phoneMatch ? phoneMatch[1].replace(/[^\d+]/g, '') : undefined;
      let namePart = phoneMatch ? text.slice(0, phoneMatch.index) : text;
      // Preferir lo que sigue a "se llama"/"llamado"/"nombre" cuando está presente.
      const llamaMatch = namePart.match(/(?:se llama|llamado|llamada|nombre(?:\s+es)?)\s+([\p{L}\s]+)$/iu);
      if (llamaMatch) namePart = llamaMatch[1];
      const contactName = namePart
        .replace(
          /\b(nuevo|nueva|cambiar|cambio|contacto|familiar|emergencia|avisar|es|mi|su|el|la|que|se|llama|llamado|llamada|y|a|para|numero|número|telefono|teléfono|celular|whatsapp|de)\b/gi,
          ' '
        )
        .replace(/\s+/g, ' ')
        .trim();
      if (contactName.length >= 2) {
        return { intent: 'CHANGE_CONTACT', contactName, contactPhone };
      }
      return { intent: 'CHANGE_CONTACT', value: text };
    }

    // Change address: "Cambiar dirección a Avda España 1234", "Mi direccion es Calle 5 Asuncion"
    if (clean.includes('dirección') || clean.includes('direccion') || clean.includes('domicilio') || clean.includes('vivo en')) {
      const value = text.replace(/.*(dirección|direccion|domicilio|vivo en|es\s+)/i, '').trim();
      return {
        intent: 'CHANGE_ADDRESS',
        value,
      };
    }

    // Change conditions: "Agregar condición Diabetes", "Tengo Hipertensión"
    if (clean.includes('condición') || clean.includes('condicion') || clean.includes('enfermedad') || clean.includes('tengo')) {
      return {
        intent: 'CHANGE_CONDITIONS',
        value: text,
      };
    }

    return { intent: 'UNKNOWN' };
  }
}
