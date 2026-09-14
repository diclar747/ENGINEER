import { NiroService } from '../services/niro.service';
import { config } from '../config';

/**
 * Intérprete de intención del titular ACTIVO (texto tecleado o audio transcripto).
 *
 * Por qué existe: el motor de bot-state-machine decide con regex según el paso en
 * el que quedó la persona, así que un pedido claro mandado "en el paso equivocado"
 * se leía como la respuesta a la pregunta pendiente (confirmado con el historial
 * real: "pasame si tengo alguna cita pendiente" estando en el submenú de
 * recordatorios → cartel de "¡Hola de nuevo!"; "haceme recordar que tendré una
 * cita a las 23 con el doctor Arial" → medicamento diario llamado "Aceme recardar
 * que"). Acá la IA mira el mensaje JUNTO con la pregunta pendiente y decide si es
 * la respuesta a ese paso o un pedido nuevo, y extrae los datos. El bot ejecuta
 * con código determinístico — la IA nunca escribe la respuesta final ni toca datos.
 *
 * Si Niro no responde (caído, lento, JSON roto) devuelve null y el bot sigue con el
 * motor de reglas de siempre: nunca queda peor que antes.
 */

export const BOT_INTENTS = [
  'ANSWER_CURRENT_STEP',
  'QUERY_APPOINTMENTS',
  'QUERY_REMINDERS',
  'QUERY_MEDS',
  'CREATE_APPOINTMENT',
  'CREATE_MED_REMINDER',
  'DELETE_REMINDER',
  'MARK_TAKEN',
  'CANCEL',
  'THANKS',
  'GREETING',
  'MENU',
  'VIEW_PROFILE',
  'UPLOAD_MED',
  'UPLOAD_RX',
  'UPLOAD_STUDY',
  'FIND_DOCUMENT',
  'STOP_MED',
  'EDIT_PROFILE',
  'STICKERS',
  'SUPPORT',
  'NOTIFICATIONS',
  'LINK_PHONE',
  'HEALTH_QUESTION',
  'OTHER',
] as const;
export type BotIntent = (typeof BOT_INTENTS)[number];

export interface Interpretation {
  intent: BotIntent;
  /** QUERY_APPOINTMENTS: 'today' | 'tomorrow' | 'YYYY-MM-DD' | null (todas las pendientes). */
  dateFilter: string | null;
  appointment: { description: string | null; date: string | null; time: string | null; leadMinutes: number | null };
  med: {
    name: string | null;
    dose: string | null;
    times: string[];
    intervalHours: number | null;
    lastTakenMinutesAgo: number | null;
    durationDays: number | null;
  };
  target: { index: number | null; name: string | null; scope: 'ALL' | 'MEDS' | 'APPOINTMENTS' | null };
  /** EDIT_PROFILE / UPLOAD_MED: el mensaje ya trae el dato nuevo (no solo la intención). */
  hasDetails: boolean;
}

export interface IntentContext {
  /** Qué está esperando el bot ahora mismo (pregunta pendiente / submenú). */
  step: string;
  /** Recordatorios y turnos del titular, numerados igual que la lista que ve en el chat. */
  reminders: string[];
}

const TZ = () => config.timezone || 'America/Asuncion';

/** "lunes 14/09/2026 17:25" + claves YYYY-MM-DD de hoy y mañana, en hora de Paraguay. */
export function nowInParaguay(from: Date = new Date()): { label: string; today: string; tomorrow: string; hhmm: string } {
  const tz = TZ();
  const label = from.toLocaleString('es-PY', {
    timeZone: tz,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const today = from.toLocaleDateString('en-CA', { timeZone: tz });
  const tomorrow = new Date(from.getTime() + 86_400_000).toLocaleDateString('en-CA', { timeZone: tz });
  const hhmm = from.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return { label, today, tomorrow, hhmm };
}

/**
 * ¿Vale la pena gastar una llamada a la IA? No para lo que el motor ya resuelve
 * perfecto y al instante: un número de opción, una hora suelta, o un comando exacto.
 */
export function worthInterpreting(text: string): boolean {
  const raw = (text || '').trim();
  if (raw.length < 2) return false;
  const t = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¡!¿?,;]+/g, '')
    .replace(/[.:]+$/, '')
    .trim();
  if (!t) return false;
  if (/^\d{1,2}$/.test(t)) return false; // opción de menú
  if (/^\d{1,2}([:.h]\d{2})?\s*(hs?|horas?|am|pm)?$/.test(t)) return false; // "22:20", "8hs"
  if (/^(menu|inicio|listo|ver|si|no|ok|acepto|omitir|reiniciar|borrar \d{1,2}|pausar \d{1,2}|editar \d{1,2}|activar \d{1,2})$/.test(t)) return false;
  return true;
}

const SYSTEM_PROMPT = (ctx: IntentContext, now: ReturnType<typeof nowInParaguay>) => `Sos el intérprete de intención del asistente de WhatsApp de Bio-Pass (pasaporte médico, Paraguay). NO respondés al usuario: solo clasificás su mensaje y extraés datos en JSON.

AHORA (hora de Paraguay): ${now.label}. Hoy = ${now.today}. Mañana = ${now.tomorrow}.

LO QUE EL BOT ESTÁ ESPERANDO EN ESTE MOMENTO:
${ctx.step}

RECORDATORIOS Y TURNOS DEL USUARIO (numerados como los ve en el chat):
${ctx.reminders.length ? ctx.reminders.join('\n') : '(ninguno)'}

El mensaje puede venir de un audio transcripto, con errores de ortografía, sin tildes, o en jopara/guaraní. Interpretalo como lo haría una persona.

INTENCIONES (elegí UNA):
- ANSWER_CURRENT_STEP: el mensaje es la respuesta a lo que el bot está esperando (una opción, un sí/no, un horario, un nombre, una dosis, "nada" cuando pregunta la dosis, etc.).
- QUERY_APPOINTMENTS: quiere SABER qué citas/turnos/consultas médicas tiene ("¿tengo alguna cita?", "pasame mis turnos", "verificá si hay cita pendiente", "¿qué consulta tengo mañana?"). dateFilter: "today" si pregunta por hoy, "tomorrow" si por mañana, "YYYY-MM-DD" si por un día puntual, si no null.
- QUERY_REMINDERS: quiere ver la lista de sus recordatorios/alarmas en general.
- QUERY_MEDS: pregunta por su medicación ("¿qué remedios tomo hoy?", "¿cuál es mi próxima toma?", "¿a qué hora tomo el losartán?").
- CREATE_APPOINTMENT: quiere agendar / que le recuerden una cita, turno o consulta médica ("tengo turno con el cardiólogo el jueves a las 10", "recordame la cita de mañana a las 14", "haceme recordar que tengo cita a las 23 con el doctor Arial"). Afirmación con fecha/hora = CREATE; pregunta = QUERY.
- CREATE_MED_REMINDER: quiere un recordatorio para tomar un medicamento ("Losartán a las 8 y a las 20", "ibuprofeno cada 8 horas, tomé hace una hora").
- DELETE_REMINDER: quiere borrar/cancelar un recordatorio o turno ya guardado. target.index = número de la lista de arriba si identificás cuál es (aunque lo escriba distinto o con errores); target.name = nombre si lo menciona; target.scope = "ALL" (todo), "MEDS" (todos los de medicación) o "APPOINTMENTS" (todos los turnos) si pide borrar varios.
- MARK_TAKEN: avisa que ya tomó un medicamento ("ya tomé", "recién tomé el ibuprofeno").
- CANCEL: quiere salir / dejar lo que estaba haciendo / dice que fue un error ("salir", "salí", "cancelar", "olvidalo", "fue por error", "no quiero nada", "dejalo"). Si el bot espera un Sí/No y dice "no", es ANSWER_CURRENT_STEP.
- THANKS: solo agradece o confirma que leyó ("gracias", "ok gracias", "perfecto", "dale").
- GREETING: solo saluda ("hola", "buenas tardes").
- MENU: pide ver el menú u opciones.
- VIEW_PROFILE: quiere ver su perfil / ficha médica / datos.
- UPLOAD_MED / UPLOAD_RX / UPLOAD_STUDY: quiere cargar a su ficha un medicamento / una receta / un estudio o análisis, SIN pedir avisos ni horarios. hasDetails=true si ya escribió el nombre y dosis del medicamento. Si da horarios, una frecuencia ("cada 8 horas") o cuándo tomó la última dosis, es CREATE_MED_REMINDER.
- FIND_DOCUMENT: pide que le muestren o manden un estudio o receta ya guardado.
- STOP_MED: dejó de tomar un medicamento ("ya no tomo X").
- EDIT_PROFILE: quiere cambiar datos del perfil (contacto de emergencia, dirección, correo, alergias, condiciones, nombre, cédula, grupo sanguíneo). hasDetails=true si ya dice el dato nuevo.
- STICKERS: quiere el QR, los stickers o el kit.
- SUPPORT: quiere hablar con una persona / soporte.
- NOTIFICATIONS: quiere activar notificaciones o alertas push.
- LINK_PHONE: quiere vincular su número para entrar a la web.
- HEALTH_QUESTION: pregunta general de salud o sobre Bio-Pass que no es ninguna acción de arriba.
- OTHER: nada de lo anterior.

DATOS:
- appointment.description: motivo corto y prolijo, corrigiendo errores obvios de tipeo pero sin inventar ("Consulta con el Dr. Arial", "Cardiólogo", "Control odontológico"); null si no lo dice.
- appointment.date "YYYY-MM-DD" y appointment.time "HH:mm" (24 h). Resolvé "hoy", "mañana", "pasado mañana", días de la semana y "a las 4 de la tarde" usando AHORA. Si solo da la hora y esa hora de hoy ya pasó, usá mañana. Nunca devuelvas una fecha pasada. null si no lo dice.
- appointment.leadMinutes: anticipación del aviso ("10 minutos antes"=10, "una hora antes"=60, "el día antes"=1440); null si no la pide.
- med.name, med.dose ("50 mg", "1 comprimido"), med.times ["HH:mm"] para horarios fijos, med.intervalHours para "cada N horas" (cada 2 días = 48), med.lastTakenMinutesAgo ("tomé hace una hora"=60, "recién"=0), med.durationDays ("por 7 días"=7). null / [] si no aplica.

EJEMPLOS (intención):
"¿tengo alguna cita pendiente?" → QUERY_APPOINTMENTS · "me gustaría saber si tengo turno hoy" → QUERY_APPOINTMENTS (dateFilter "today") · "listame mis recordatorios" → QUERY_REMINDERS · "quiero agendar un turno con el cardiólogo" → CREATE_APPOINTMENT · "ibuprofeno cada 8 horas, tomé hace una hora" → CREATE_MED_REMINDER · "quiero cargar mi receta" → UPLOAD_RX · "borrá el turno del dentista" → DELETE_REMINDER · "nada, fue un error" → CANCEL.

Respondé ÚNICAMENTE este JSON, sin texto extra:
{"intent":"...","dateFilter":null,"appointment":{"description":null,"date":null,"time":null,"leadMinutes":null},"med":{"name":null,"dose":null,"times":[],"intervalHours":null,"lastTakenMinutesAgo":null,"durationDays":null},"target":{"index":null,"name":null,"scope":null},"hasDetails":false}`;

function parseJsonLoose(out: string): any {
  const cleaned = out.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

const str = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, max) : null);
const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
};
const dateKey = (v: unknown): string | null => {
  const s = str(v, 10);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const clock = (v: unknown): string | null => {
  const s = str(v, 5);
  const m = s?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
};

/**
 * El modelo a veces inventa un nombre parecido ("REMIND_APPOINTMENT", "SCHEDULE_APPOINTMENT",
 * "LIST_APPOINTMENTS") en vez de uno de la lista. Se lo lleva al más cercano por palabras
 * clave; si no hay forma de saberlo, null (→ motor de reglas).
 */
function canonicalIntent(rawIntent: string, a: any, m: any): BotIntent | null {
  const up = rawIntent.toUpperCase().replace(/[^A-Z_]/g, '');
  if ((BOT_INTENTS as readonly string[]).includes(up)) return up as BotIntent;
  const has = (re: RegExp) => re.test(up);
  const appt = has(/APPOINT|CITA|TURNO|CONSULT|MEETING/);
  const med = has(/MED|DOSE|PILL|DRUG|REMEDIO/);
  if (appt && has(/QUERY|LIST|CHECK|GET|SHOW|VIEW|ASK|SEARCH|FIND|PENDING/)) return 'QUERY_APPOINTMENTS';
  if (appt && has(/CREATE|REMIND|SCHEDULE|ADD|BOOK|SET|NEW|REGISTER|SAVE/)) return 'CREATE_APPOINTMENT';
  if (has(/DELETE|REMOVE|CANCEL_REMINDER|CANCEL_APPOINT/)) return 'DELETE_REMINDER';
  if (med && has(/CREATE|REMIND|SCHEDULE|ADD|SET|NEW/)) return 'CREATE_MED_REMINDER';
  if (med && has(/QUERY|LIST|CHECK|GET|SHOW|VIEW|ASK/)) return 'QUERY_MEDS';
  if (has(/REMINDER/) && has(/QUERY|LIST|SHOW|VIEW|GET/)) return 'QUERY_REMINDERS';
  if (has(/STICKER|QR|KIT/)) return 'STICKERS';
  if (has(/PROFILE|PERFIL|FICHA/)) return has(/EDIT|CHANGE|UPDATE|MODIF/) ? 'EDIT_PROFILE' : 'VIEW_PROFILE';
  if (has(/SUPPORT|SOPORTE|HUMAN|AGENT/)) return 'SUPPORT';
  if (has(/NOTIF|PUSH/)) return 'NOTIFICATIONS';
  if (has(/THANK/)) return 'THANKS';
  if (has(/GREET|HELLO/)) return 'GREETING';
  if (has(/EXIT|CANCEL|ABORT|QUIT|STOP_FLOW/)) return 'CANCEL';
  // Sin nombre reconocible pero con datos concretos → el pedido de alta es inequívoco.
  if (a && typeof a === 'object' && (a.date || a.time)) return 'CREATE_APPOINTMENT';
  if (m && typeof m === 'object' && m.name && ((Array.isArray(m.times) && m.times.length) || m.intervalHours)) return 'CREATE_MED_REMINDER';
  return null;
}

/** Valida y normaliza la salida de la IA — nada que no pase el filtro llega al bot. */
export function normalizeInterpretation(raw: any): Interpretation | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw.appointment || {};
  const m = raw.med || {};
  const intent = canonicalIntent(String(raw.intent || ''), a, m);
  if (!intent) return null;
  const tg = raw.target || {};
  const df = str(raw.dateFilter, 10);
  const scope = String(tg.scope || '').toUpperCase();
  return {
    intent,
    dateFilter: df === 'today' || df === 'tomorrow' ? df : dateKey(df),
    appointment: {
      description: str(a.description),
      date: dateKey(a.date),
      time: clock(a.time),
      leadMinutes: num(a.leadMinutes, 1, 10080),
    },
    med: {
      name: str(m.name, 80),
      dose: str(m.dose, 60),
      times: Array.isArray(m.times) ? Array.from(new Set<string>(m.times.map(clock).filter((x: string | null): x is string => !!x))).sort() : [],
      intervalHours: num(m.intervalHours, 1, 24 * 60),
      lastTakenMinutesAgo: num(m.lastTakenMinutesAgo, 0, 7 * 24 * 60),
      durationDays: num(m.durationDays, 1, 3650),
    },
    target: {
      index: num(tg.index, 1, 500),
      name: str(tg.name, 80),
      scope: scope === 'ALL' || scope === 'MEDS' || scope === 'APPOINTMENTS' ? scope : null,
    },
    hasDetails: raw.hasDetails === true,
  };
}

const plain = (t: string) =>
  (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * Correcciones determinísticas sobre lo que devolvió el modelo, para los errores
 * que se vieron en pruebas reales (el modelo de Niro no es 100% consistente):
 * - "¿tengo alguna cita pendiente?" clasificado como lista general de recordatorios.
 * - "ibuprofeno cada 8 horas, tomé hace una hora" clasificado como "cargar medicamento".
 * - "quiero agendar un turno" clasificado como "cargar medicamento".
 */
export function refineInterpretation(it: Interpretation, text: string, opts: { inUploadMed?: boolean } = {}): Interpretation {
  const t = plain(text);
  const mentionsAppt = /\b(citas?|turnos?|consultas?|agenda|agendad\w*)\b/.test(t);
  const mentionsDocs = /\b(receta|estudio|analisis|laboratorio|foto|pdf|radiografia|ecografia|tomografia)\b/.test(t);
  const out: Interpretation = { ...it };
  if (out.intent === 'QUERY_REMINDERS' && mentionsAppt && !/\b(recordatorios?|alarmas?|remedios?|medicaci|pastillas?)\b/.test(t)) {
    out.intent = 'QUERY_APPOINTMENTS';
  }
  if (
    out.intent === 'QUERY_REMINDERS' &&
    /\b(tom[aoe]r?|toma|remedios?|pastillas?|medicaci\w*|medicamentos?|dosis)\b/.test(t) &&
    /\b(ahora|hoy|proxim\w*|toca|falta|que\s+tengo\s+que|a\s+que\s+hora)\b/.test(t)
  ) {
    out.intent = 'QUERY_MEDS';
  }
  if (out.intent === 'QUERY_APPOINTMENTS' && !out.dateFilter) {
    if (/\bhoy\b/.test(t)) out.dateFilter = 'today';
    else if (/\bmanana\b/.test(t) && !/\b(de|por)\s+la\s+manana\b/.test(t) && !/\bpasado\s+manana\b/.test(t)) out.dateFilter = 'tomorrow';
  }
  if (
    (out.intent === 'UPLOAD_MED' || out.intent === 'QUERY_MEDS') &&
    !opts.inUploadMed &&
    (out.med.intervalHours || out.med.times.length || out.med.lastTakenMinutesAgo !== null) &&
    !/[?¿]/.test(text)
  ) {
    out.intent = 'CREATE_MED_REMINDER';
  }
  if (['UPLOAD_MED', 'UPLOAD_RX', 'UPLOAD_STUDY', 'OTHER', 'HEALTH_QUESTION'].includes(out.intent) && mentionsAppt && !mentionsDocs) {
    const asks = /[?¿]/.test(text) || /\b(tengo|hay|saber|ver|verific\w*|pasame|mostrame|decime|cuales?|cuando)\b/.test(t);
    const wants = /\b(agend\w*|reserv\w*|anot\w*|record\w*|recuerd\w*|avis\w*|program\w*|registr\w*|sacar|tendre|voy\s+a\s+tener)\b/.test(t);
    if (wants) out.intent = 'CREATE_APPOINTMENT';
    else if (asks) out.intent = 'QUERY_APPOINTMENTS';
  }
  return out;
}

/** Distancia de edición (para "Arial" ≈ "Ariel", "Cerdan" ≈ "Cerdán"). */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const STOP_WORDS = new Set(['doctor', 'doctora', 'dr', 'dra', 'cita', 'turno', 'consulta', 'con', 'el', 'la', 'los', 'las', 'del', 'de', 'mi', 'medica', 'medico', 'recordatorio', 'para', 'una', 'un']);

/** ¿El nombre que dijo la persona corresponde a este recordatorio? Tolera tildes y 1–2 letras distintas. */
export function nameMatches(said: string, stored: string): boolean {
  const words = (x: string) => plain(x).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  const a = words(said);
  const b = words(stored);
  if (!a.length || !b.length) return false;
  return a.some((w) => b.some((v) => w === v || (w.length >= 4 && v.length >= 4 && editDistance(w, v) <= (w.length >= 7 ? 2 : 1)) || (w.length >= 5 && v.startsWith(w))));
}

export class IntentRouter {
  static get enabled(): boolean {
    return NiroService.enabled;
  }

  static async interpret(text: string, ctx: IntentContext): Promise<Interpretation | null> {
    if (!this.enabled || !worthInterpreting(text)) return null;
    const started = Date.now();
    const out = await NiroService.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT(ctx, nowInParaguay()) },
        { role: 'user', content: text.trim().slice(0, 1500) },
      ],
      { timeoutMs: 15000, temperature: 0 }
    );
    const parsed = out ? normalizeInterpretation(parseJsonLoose(out)) : null;
    if (out && !parsed) console.warn('[INTENT] salida inválida de la IA:', out.replace(/\s+/g, ' ').slice(0, 300));
    console.log(
      `[INTENT] ${Date.now() - started}ms ${JSON.stringify(text.slice(0, 120))} → ${parsed ? parsed.intent : 'sin respuesta (motor de reglas)'}`
    );
    return parsed;
  }
}
