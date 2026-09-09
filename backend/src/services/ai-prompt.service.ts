import { prisma } from '../database/prisma';
import { PaymentService } from './payment.service';

export type PromptScope = 'GENERAL' | 'PRE_REGISTRO' | 'MIEMBRO_ACTIVO';

/**
 * Prompt base por defecto. Se usa mientras no haya prompts cargados en /admin → IA,
 * y también se siembra en la DB la primera vez para que el admin lo edite.
 */
const DEFAULT_BASE = [
  'Sos el asistente virtual de Doorway Cortex Bio-Pass (Mobile Health Passport), un pasaporte médico digital de emergencia usado en Paraguay y Brasil.',
  'Respondé SIEMPRE en el idioma del usuario (español o portugués), en tono cordial y claro, máximo 5 líneas.',
  'Qué es Bio-Pass: una ficha médica de emergencia accesible por un QR (sticker 3x3 cm). Acceso público sin PIN (datos críticos: nombre, grupo sanguíneo, alergias, condiciones, medicación, contacto de emergencia) y acceso privado con PIN de 4 dígitos (historial e estudios, cifrado Zero-Knowledge: ni los administradores pueden ver los estudios sin el PIN).',
  'El registro es 100% self-service por WhatsApp, dura menos de 3 minutos: idioma → foto de cédula (OCR) → contacto de emergencia → domicilio → correo → datos médicos críticos → PIN → pago. El QR se genera recién cuando el pago se confirma.',
  'Se pueden cargar por WhatsApp: medicamentos, recetas y estudios (foto o PDF), y configurar recordatorios de toma de medicación con horario.',
  'Los precios que se te dan más abajo (si los hay) son exactos y actuales — compartilos con confianza, sin redondear ni inventar otros. No inventes datos médicos ni diagnósticos. Para pasos concretos, sugerí escribir *MENU*. Si preguntan algo fuera de tema, redirigí amablemente.',
].join(' ');

const DEFAULT_BY_SCOPE: Record<PromptScope, string> = {
  GENERAL: DEFAULT_BASE,
  PRE_REGISTRO:
    'El usuario todavía NO está registrado. Resolvé sus dudas sobre qué es Bio-Pass, para qué sirve, seguridad, planes y cómo registrarse. Cerrá invitando a escribir *MENU* para empezar el registro.',
  MIEMBRO_ACTIVO:
    'El usuario ya es miembro activo. El menú (que ve escribiendo *MENU*) tiene: ' +
    '[1] cargar medicamento, [2] cargar receta, [3] cargar estudio, [4] ver perfil médico, ' +
    '[5] recordatorios de medicación, [6] descargar Kit QR/stickers, [7] modificar datos de emergencia/alergias, [8] soporte. ' +
    'Puede mandar foto, PDF o audio. Para pasos concretos remitilo a esas opciones o a escribir *MENU*.',
};

const SEED = [
  { name: 'Base / conocimiento general', scope: 'GENERAL' as const, content: DEFAULT_BASE, sortOrder: 0 },
  { name: 'Antes de registrarse', scope: 'PRE_REGISTRO' as const, content: DEFAULT_BY_SCOPE.PRE_REGISTRO, sortOrder: 10 },
  { name: 'Miembro activo', scope: 'MIEMBRO_ACTIVO' as const, content: DEFAULT_BY_SCOPE.MIEMBRO_ACTIVO, sortOrder: 20 },
];

export class AiPromptService {
  private static cache: { at: number; rows: Array<{ scope: string; content: string; sortOrder: number }> } | null = null;
  private static readonly TTL = 60_000;

  /** Siembra los prompts por defecto si la tabla está vacía. Idempotente. */
  static async seed(): Promise<void> {
    try {
      const count = await prisma.aiPrompt.count();
      if (count > 0) return;
      await prisma.aiPrompt.createMany({ data: SEED });
      console.log('🧠 [AI PROMPT] Prompts por defecto sembrados (editables en /admin → IA).');
    } catch (e: any) {
      console.warn('[AI PROMPT] no se pudo sembrar:', e?.message);
    }
  }

  private static async rows() {
    if (this.cache && Date.now() - this.cache.at < this.TTL) return this.cache.rows;
    try {
      const rows = await prisma.aiPrompt.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
        select: { scope: true, content: true, sortOrder: true },
      });
      this.cache = { at: Date.now(), rows };
      return rows;
    } catch {
      return this.cache?.rows ?? [];
    }
  }

  /** Invalida la cache (lo llama el admin al guardar). */
  static bust(): void {
    this.cache = null;
  }

  /**
   * System prompt para una consulta: concatena los prompts activos de scope
   * GENERAL + los del scope pedido. Cae al default si no hay nada cargado.
   * Para PRE_REGISTRO se agregan los precios reales y actuales (tabla de
   * AppSetting/env, la misma que usa el checkout) — antes el prompt le decía
   * a la IA "no inventes precios exactos" y no le daba ninguno, así que
   * cualquier pregunta de costo quedaba sin responder de verdad.
   */
  static async getSystemPrompt(scope: PromptScope): Promise<string> {
    const rows = await this.rows();
    const picked = rows
      .filter((r) => r.scope === 'GENERAL' || r.scope === scope)
      .map((r) => r.content.trim())
      .filter(Boolean);
    const base = picked.length ? picked.join('\n\n') : `${DEFAULT_BASE}\n\n${DEFAULT_BY_SCOPE[scope]}`;
    if (scope !== 'PRE_REGISTRO') return base;
    try {
      const p = await PaymentService.getPlanPrices();
      const priceLine =
        `Precios actuales: Paraguay — Gs. ${p.PY.MONTHLY.toLocaleString('es-PY')}/mes ` +
        `o Gs. ${p.PY.ANNUAL.toLocaleString('es-PY')}/año. Brasil — R$ ${p.BR.MONTHLY.toFixed(2)}/mês ` +
        `ou R$ ${p.BR.ANNUAL.toFixed(2)}/ano.`;
      return `${base}\n\n${priceLine}`;
    } catch {
      return base;
    }
  }
}
