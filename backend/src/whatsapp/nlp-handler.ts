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

    // Change contact: "Nuevo contacto Maria Perez 0981123456", "Cambiar contacto a Carlos 0982-111-222"
    if (clean.includes('contacto') || clean.includes('familiar') || clean.includes('avisar')) {
      const match = text.match(/([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)[,:\s]+([0-9+\-\s]{7,16})/i);
      if (match) {
        return {
          intent: 'CHANGE_CONTACT',
          contactName: match[1].replace(/.*(contacto|familiar|a|nuevo)\s+/i, '').trim(),
          contactPhone: match[2].trim(),
        };
      }
      return {
        intent: 'CHANGE_CONTACT',
        value: text,
      };
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
