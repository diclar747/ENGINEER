import { prisma } from '../database/prisma';
import { whatsappBot } from '../whatsapp/baileys.client';
import { NiroService } from './niro.service';
import { PushService } from './push.service';
import { parseMedications, formatMedications, normName } from './medication.util';
import { config } from '../config';

export interface ParsedReminder {
  medication: string;
  dose?: string;
  times: string[]; // "HH:MM" 24h
}

/**
 * Borrador de recordatorio que va llenando el diálogo guiado del bot (se guarda
 * como JSON en `user.onboardingData.rdraft`, por eso las fechas son ISO string).
 */
export interface ReminderDraft {
  kind: 'MED' | 'APPOINTMENT';
  medication?: string;
  dose?: string | null; // undefined = todavía no se preguntó · null/'' = se preguntó y no aplica
  scheduleKind?: 'CLOCK' | 'INTERVAL';
  times?: string[];
  intervalHours?: number;
  anchorAt?: string; // ISO — última toma (INTERVAL)
  whenAt?: string; // ISO — turno (APPOINTMENT)
  whenPendingDate?: string; // YYYY-MM-DD — fecha del turno ya dada, esperando la hora
  leadMinutes?: number;
  endsAt?: string; // ISO — fin del tratamiento ("por 3 días")
}

/** Número escrito o en dígitos → entero ("tres" → 3, "10" → 10, "veintiuno" → 21). */
const WORD_NUM: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiuna: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, sesenta: 60, noventa: 90,
};
function toNum(s: string): number {
  const w = (s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  return WORD_NUM[w] ?? NaN;
}

/** Tope de duración de un tratamiento con recordatorio: 3 años. */
const MAX_TREATMENT_DAYS = 1095;

/**
 * "por 3 días" / "durante una semana" / "por diez dias" / "por 6 meses" / "por 2 años"
 * → Date de fin del tratamiento, o null. Acepta cualquier número (dígitos o escrito).
 */
export function parseTreatmentEnd(text: string, from: Date = new Date()): Date | null {
  const t = (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = t.match(
    /\b(?:por|durante|during|x)\s+(un[ao]?s?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\w+|veinte|veinti\w+|treinta|cuarenta|sesenta|noventa|\d{1,4})\s*(d[ií]as?|semanas?|mes(?:es)?|an[io]s?|años?)\b/
  );
  if (!m) return null;
  const n = toNum(m[1]);
  if (!(n >= 1 && n <= 999)) return null;
  const unit = m[2];
  const days = /semana/.test(unit) ? n * 7 : /a[nñ]/.test(unit) ? n * 365 : /mes/.test(unit) ? n * 30 : n;
  return new Date(from.getTime() + Math.min(days, MAX_TREATMENT_DAYS) * 86400_000);
}

// Vocabulario de dosis: mg/ml/gotas… + formas caseras (cucharada, sobre, ampolla, parche…).
const DOSE_RE =
  /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|g|ml|ui|u|%|comp(?:rimidos?)?|caps?(?:ulas?)?|gotas?|cucharad(?:it)?as?|cdta?s?|cditas?|sobres?|sachets?|ampollas?|aplicaci[oó]n(?:es)?|inhalaci[oó]n(?:es)?|pulverizaci[oó]n(?:es)?|nebulizaci[oó]n(?:es)?|unidad(?:es)?|pastillas?|tabletas?|parches?|puff)\b/i;

/** Frases de anticipación de aviso ("avisame 1 hora antes", "2 horas antes",
 *  "con 30 minutos de anticipación") — NO son la hora del turno. Se sacan antes de
 *  buscar horarios. */
const LEAD_PHRASE_RE =
  /\b(?:avisa(?:me|r)?\s+)?(?:con\s+)?\d{1,3}\s*(?:h|hs|hrs|horas?|min|minutos?|d[ií]as?)\s*(?:antes|de\s+anticipaci[oó]n|de\s+antelaci[oó]n)\b|\bel\s+d[ií]a\s+(?:antes|anterior)\b/gi;

/** Extrae horarios de un texto: "08:00", "8", "8hs", "8 am", "20:30", "a las 9". */
function extractTimes(text: string): string[] {
  const out = new Set<string>();
  const t = text.toLowerCase().replace(LEAD_PHRASE_RE, ' ');

  // HH:MM / HH.MM
  for (const m of t.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)) {
    out.add(`${m[1].padStart(2, '0')}:${m[2]}`);
  }
  // "8 am" / "8pm" / "8:30 pm"
  for (const m of t.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/g)) {
    let h = parseInt(m[1], 10);
    const min = m[2] || '00';
    const pm = m[3].startsWith('p');
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
    if (h >= 0 && h <= 23) out.add(`${String(h).padStart(2, '0')}:${min}`);
  }
  // "8hs" / "20 h" / "a las 9" — pero NO "cada 8 horas" ni "hace 2 horas" (frecuencia / relativo).
  for (const m of t.matchAll(/\b(?:a\s+las\s+)?(\d{1,2})\s*(?:h|hs|hrs|horas)\b/g)) {
    const h = parseInt(m[1], 10);
    const idx = m.index ?? 0;
    if (/\b(cada|hace|en|dentro de|por)\s*$/.test(t.slice(Math.max(0, idx - 12), idx))) continue;
    if (h >= 0 && h <= 23) out.add(`${String(h).padStart(2, '0')}:00`);
  }
  // "a las 10", "a las 9 de la noche", "a las 3 de la tarde" — hora sin ":" ni "hs".
  // También "3 de la tarde", "9 y media de la noche" SIN "a las".
  for (const m of t.matchAll(/\b(?:a\s+las?\s+(\d{1,2})|(\d{1,2}))(?:[:.]([0-5]\d)|\s+y\s+(media|cuarto))?\s*(?:de\s+la\s+(mañana|manana|tarde|noche|madrugada))?/g)) {
    const anchored = m[1] !== undefined; // vino con "a las"
    const period = m[5];
    if (!anchored && !period) continue; // "3" a secas no es una hora acá
    let h = parseInt(m[1] ?? m[2], 10);
    const min = m[3] || (m[4] === 'media' ? '30' : m[4] === 'cuarto' ? '15' : '00');
    if (period === 'tarde' && h < 12) h += 12;
    else if (period === 'noche' && h <= 11) h += 12;
    else if ((period === 'mañana' || period === 'manana' || period === 'madrugada') && h === 12) h = 0;
    if (h >= 0 && h <= 23) out.add(`${String(h).padStart(2, '0')}:${min}`);
  }

  // Números sueltos 0-23 unidos por "y"/","/"a las" cuando YA hay al menos un
  // horario claro ("9 y 21hs", "a las 8, 14 y 22"). Se ignoran los que van
  // pegados a una unidad de dosis (mg, ml…).
  if (out.size > 0) {
    for (const m of t.matchAll(/(^|[\s,(]|(?:a\s+las\s+)|y\s+)(\d{1,2})(?=$|[\s,)]|y\b)/g)) {
      const idx = (m.index ?? 0) + m[1].length;
      const after = t.slice(idx + m[2].length, idx + m[2].length + 12);
      // No es una hora si viene pegado a una unidad de dosis o a "vez/veces".
      if (
        /^\s*(mg|mcg|µg|g|ml|ui|u\b|%|comp|caps?|gota|cucharad|cda|cdta|cdita|sobre|sachet|ampolla|aplicaci|inhalaci|pulverizaci|nebulizaci|unidad|pastilla|tableta|parche|puff|vez|veces)/i.test(
          after
        )
      )
        continue;
      const h = parseInt(m[2], 10);
      if (h >= 0 && h <= 23) out.add(`${String(h).padStart(2, '0')}:00`);
    }
  }
  return Array.from(out).sort();
}

/**
 * "cada 8 horas" / "cada 6hs" / "cada doce horas" / "cada 2 días" → intervalo en HORAS.
 * Grupo 1 = número (dígitos o escrito), grupo 2 = unidad (horas | días).
 * No confunde con una hora puntual ("a las 8").
 */
const INTERVAL_RE =
  /\bcada\s+(un[ao]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\w+|veinte|veinti\w+|treinta|\d{1,3})\s*(h|hs|hrs|horas?|d[ií]as?)\b/i;

/** Tope de intervalo entre tomas: 30 días. */
const MAX_INTERVAL_HOURS = 30 * 24;

/** Intervalo del texto en HORAS (soporta "cada N horas" y "cada N días"), o null. */
function parseIntervalHours(text: string): number | null {
  const m = (text || '').match(INTERVAL_RE);
  if (!m) return null;
  let n = toNum(m[1]);
  if (!(n >= 1)) return null;
  if (/d[ií]a/i.test(m[2])) n *= 24; // "cada 2 días" → 48 h
  if (n < 1 || n > MAX_INTERVAL_HOURS) return null;
  return n;
}

/** Hora local (config.timezone) desglosada — el contenedor corre en UTC. */
function nowLocal(from: Date = new Date()): { hhmm: string; minutes: number; hour: number; date: string } {
  const tz = config.timezone || 'America/Asuncion';
  const hhmm = from.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const [h, m] = hhmm.split(':').map(Number);
  const date = from.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  return { hhmm, minutes: h * 60 + m, hour: h, date };
}

/**
 * Convierte un intervalo ("cada 8 horas") en horarios concretos del día,
 * repartidos parejo desde una hora de inicio. Sin hora de inicio explícita,
 * arranca desde la hora local ACTUAL de Paraguay (no la del contenedor, que es UTC).
 */
function intervalToTimes(intervalHours: number, startHour?: number): string[] {
  const n = Math.max(1, Math.floor(24 / intervalHours));
  const start = ((startHour ?? nowLocal().hour) + 24) % 24;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${String((start + i * intervalHours) % 24).padStart(2, '0')}:00`);
  }
  return out.sort();
}

/** Fecha (ms epoch) para "HH:MM" de HOY en hora local PY (offset fijo -03:00, sin DST desde 2024). */
function todayAtLocal(hh: number, mm: number, ref: Date = new Date()): Date {
  const tz = config.timezone || 'America/Asuncion';
  const [y, mo, d] = ref.toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
  return new Date(
    `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-03:00`
  );
}

const LEAD_LABEL: Record<number, string> = {
  30: 'media hora',
  60: '1 hora',
  120: '2 horas',
  180: '3 horas',
  1440: '1 día',
};
function leadLabel(mins: number): string {
  return LEAD_LABEL[mins] || (mins % 60 === 0 ? `${mins / 60} h` : `${mins} min`);
}
/** "cada 8 h" · "cada 2 días" (cuando el intervalo es múltiplo de 24). */
function intervalLabel(hours: number): string {
  if (hours % 24 === 0) {
    const d = hours / 24;
    return d === 1 ? 'cada 24 h' : `cada ${d} días`;
  }
  return `cada ${hours} h`;
}
/** Anticipación efectiva para un TURNO: nunca menos de 30 min (el default 10 del
 *  schema es para el pre-aviso de medicación, no para una consulta médica). */
function apptLead(mins?: number | null): number {
  return mins && mins >= 30 ? mins : 120;
}

const TZ = () => config.timezone || 'America/Asuncion';
function fmtDateTime(d: Date): string {
  return d.toLocaleString('es-PY', {
    timeZone: TZ(),
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
}
/** "HH:MM" 24h siempre (en-GB evita el "24:37" de la medianoche en es-PY). */
function fmtHHMM(d: Date): string {
  return d.toLocaleTimeString('en-GB', { timeZone: TZ(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
function humanIn(ms: number): string {
  if (ms <= 60_000) return 'menos de 1 min';
  const totalMin = Math.round(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d) return `${d} día${d > 1 ? 's' : ''}${h ? ` ${h} h` : ''}`;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
/** Hora de la próxima toma: "~22:39" si es hoy, "mañana ~08:00", si no "12/09 ~08:00". */
function fmtNextDose(d: Date, from: Date = new Date()): string {
  const dayOf = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: TZ() });
  const hh = fmtHHMM(d);
  if (dayOf(d) === dayOf(from)) return `~${hh}`;
  const tomorrow = new Date(from.getTime() + 86_400_000);
  if (dayOf(d) === dayOf(tomorrow)) return `mañana ~${hh}`;
  return `${d.toLocaleDateString('es-PY', { timeZone: TZ(), day: '2-digit', month: '2-digit' })} ~${hh}`;
}

export class MedicationReminderService {
  /**
   * Parsea "Losartán 50 mg 08:00 y 20:00" → { medication, dose, times }.
   * También acepta frecuencia relativa: "Ibuprofeno cada 8 horas" (reparte
   * los horarios del día solo; opcionalmente "cada 8 horas desde las 9").
   * Devuelve null si no logra un nombre + al menos un horario.
   */
  static parse(text: string): ParsedReminder | null {
    if (!text || !text.trim()) return null;
    const raw = text.trim();
    let times = extractTimes(raw);
    const interval = parseIntervalHours(raw);
    if (!times.length && interval && interval >= 1 && interval <= 23) {
      const startMatch = raw.match(/\b(?:desde|a partir de|empezando)\s+las?\s+(\d{1,2})/i);
      times = intervalToTimes(interval, startMatch ? parseInt(startMatch[1], 10) : undefined);
    }
    if (!times.length) return null;

    const dose = raw.match(DOSE_RE)?.[0]?.replace(/\s+/g, ' ').trim();

    let name = raw
      .replace(/\b([01]?\d|2[0-3])[:.][0-5]\d\b/g, ' ')
      .replace(/\b\d{1,2}(?::[0-5]\d)?\s*(a\.?m\.?|p\.?m\.?)\b/gi, ' ')
      .replace(/\ba\s+las?\s+\d{1,2}(?:[:.]\d{2})?(?:\s*de\s+la\s+(?:mañana|manana|tarde|noche|madrugada))?/gi, ' ')
      .replace(/\b(?:a\s+las\s+)?\d{1,2}\s*(?:h|hs|hrs|horas)\b/gi, ' ')
      .replace(/\b(?:desde|a partir de|empezando)\s+las?\s+\d{1,2}\b/gi, ' ');
    if (dose) name = name.replace(dose, ' ');
    name = name
      .replace(/\b(recorda(?:r|torio)?|recu[eé]rdame|tomar|tom[oó]|de|el|la|los|las|a|y|cada|todos|dias?|d[ií]a|por|en|punto)\b/gi, ' ')
      .replace(/[^\p{L}\p{N}\s/+.-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = name.split(' ').filter((w) => w.length > 1 && !/^\d+$/.test(w));
    name = words.slice(0, 3).join(' ').trim();
    if (name.length < 3) return null;

    return { medication: name, dose: dose || undefined, times };
  }

  /**
   * Parsea un turno/consulta médica: "turno con el cardiólogo el 15/10 a las 14:30",
   * "cita mañana 9am", "consulta el lunes 10hs". Devuelve { note, whenAt } o null.
   * Requiere una palabra tipo turno/cita/consulta + una fecha + una hora.
   */
  static parseAppointment(text: string): { note: string; whenAt: Date } | null {
    if (!text) return null;
    const t = text.toLowerCase();
    if (!/\b(turno|cita|consulta|agenda|hora m[eé]dica|control m[eé]dico|cita m[eé]dica|appointment|doctor|m[eé]dico|dentista|especialista)\b/.test(t)) return null;

    // `extractClock` respeta "de la tarde/noche" (4 de la tarde → 16:00);
    // `extractTimes` es el respaldo por si viene "08:00 y 20:00" al estilo receta.
    const clock = this.extractClock(text, false) || extractTimes(text)[0];
    if (!clock) return null;
    const [hh, mm] = clock.split(':').map(Number);

    const tz = config.timezone || 'America/Asuncion';
    const nowParts = new Date().toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
    let y = nowParts[0];
    let mo = nowParts[1];
    let d = nowParts[2];

    const dm = t.match(/\b([0-3]?\d)[\/.\-]([01]?\d)(?:[\/.\-](\d{2,4}))?\b/);
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
    // "15 de octubre" sí; "4 de la tarde" NO (eso es una hora, no una fecha).
    const dNameM = t.match(/\b(\d{1,2})\s+de\s+([a-záéíóú]+)/);
    const dName = dNameM && months.some((m) => dNameM[2].startsWith(m.slice(0, 4))) ? dNameM : null;
    const weekdays = ['domingo', 'lunes', 'martes', 'mi[eé]rcoles', 'jueves', 'viernes', 's[aá]bado'];

    if (dm) {
      d = parseInt(dm[1], 10);
      mo = parseInt(dm[2], 10);
      if (dm[3]) y = dm[3].length === 2 ? 2000 + parseInt(dm[3], 10) : parseInt(dm[3], 10);
    } else if (dName) {
      d = parseInt(dName[1], 10);
      const mi = months.findIndex((m) => dName[2].startsWith(m.slice(0, 4)));
      if (mi >= 0) mo = (mi === 10 ? 9 : mi > 10 ? mi - 1 : mi) + 1; // "setiembre" alias
    } else if (/\bmañana\b/.test(t)) {
      const dt = new Date();
      dt.setDate(dt.getDate() + 1);
      const p = dt.toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
      [y, mo, d] = p;
    } else if (/\bpasado\s+mañana\b/.test(t)) {
      const dt = new Date();
      dt.setDate(dt.getDate() + 2);
      const p = dt.toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
      [y, mo, d] = p;
    } else if (!/\bhoy\b/.test(t)) {
      const wi = weekdays.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
      if (wi >= 0) {
        const today = new Date().toLocaleString('en-US', { timeZone: tz, weekday: 'long' });
        const map: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
        const cur = map[today] ?? 0;
        let add = (wi - cur + 7) % 7;
        if (add === 0) add = 7;
        const dt = new Date();
        dt.setDate(dt.getDate() + add);
        const p = dt.toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
        [y, mo, d] = p;
      } else {
        return null; // sin fecha reconocible
      }
    }

    // Construye la fecha en hora local PY (-03:00 fijo; PY no usa DST desde 2024).
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-03:00`;
    const whenAt = new Date(iso);
    if (isNaN(whenAt.getTime()) || whenAt.getTime() < Date.now() - 3600_000) return null;

    // Nota: se EXTRAE la entidad (a quién/qué), no se resta el ruido —
    // los audios traen mucho relleno y restar deja fragmentos.
    const SPEC = 'cardi[oó]log\\w*|traumat[oó]log\\w*|dermat[oó]log\\w*|pediatr\\w*|ginec[oó]log\\w*|neur[oó]log\\w*|ur[oó]log\\w*|oftalm[oó]log\\w*|odont[oó]log\\w*|kinesi[oó]log\\w*|nutricionist\\w*|psic[oó]log\\w*|psiquiatr\\w*|end[oó]crin[oó]log\\w*|otorrino\\w*|dentista|especialista';
    const STOP = '(?=\\s*(?:\\b(?:y|a|el|la|los|las|para|mañana|manana|hoy|pasado|el\\s+d[ií]a|a\\s+las?|el\\s+lunes|el\\s+martes|el\\s+mi[eé]rcoles|el\\s+jueves|el\\s+viernes|el\\s+s[aá]bado|el\\s+domingo)\\b|[,.;]|$))';
    let note = '';
    let mm2 =
      t.match(new RegExp(`\\bcon\\s+(?:el|la|mi|un[ao]?|dr\\.?|dra\\.?)?\\s*(doctor|doctora|dr|dra|m[eé]dico|${SPEC})\\.?\\s+([a-záéíóúñ][a-záéíóúñ .'-]{1,40}?)${STOP}`, 'i')) ||
      t.match(new RegExp(`\\b(doctor|doctora|dr|dra)\\.?\\s+([a-záéíóúñ][a-záéíóúñ .'-]{1,40}?)${STOP}`, 'i'));
    if (mm2) {
      const who = mm2[2].trim().replace(/\s+(y|a|para|el|la)$/i, '');
      note = `Consulta con el Dr. ${who.charAt(0).toLocaleUpperCase('es')}${who.slice(1)}`;
    }
    if (!note) {
      const mm3 = t.match(new RegExp(`\\b(?:turno|cita|consulta|control|hora\\s+m[eé]dica)\\s+(?:m[eé]dic[ao]\\s+)?(?:con|de|para|del?)\\s+(?:el|la|mi|un[ao]?)?\\s*([a-záéíóúñ][a-záéíóúñ .'-]{2,40}?)${STOP}`, 'i'));
      if (mm3) { const w = mm3[1].trim(); note = w.charAt(0).toLocaleUpperCase('es') + w.slice(1); }
    }
    if (!note) {
      const mm4 = t.match(new RegExp(`\\b(${SPEC})\\b`, 'i'));
      if (mm4) note = mm4[1].charAt(0).toLocaleUpperCase('es') + mm4[1].slice(1);
    }
    if (!note || note.replace(/[^\p{L}]/gu, '').length < 3) note = 'Consulta médica';

    return { note: note.slice(0, 120), whenAt };
  }

  /** "HH:MM" (24h) de un texto libre de turno: "a las 15", "3 de la tarde",
   *  "9 y media", "14:30", "15hs", o —si `bareOk`— un número suelto ("15"). */
  static extractClock(text: string, bareOk = true): string | null {
    const s = (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let m = s.match(/\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/); // 14:30 / 14.30 / 1430h→14:30
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
    m = s.match(/\b(\d{1,2})(?:\s+y\s+(media|cuarto))?\s*(?:de\s+la\s+)?(manana|tarde|noche|madrugada)\b/);
    if (m) {
      let h = +m[1];
      const mn = m[2] === 'media' ? 30 : m[2] === 'cuarto' ? 15 : 0;
      if ((m[3] === 'tarde' || m[3] === 'noche') && h < 12) h += 12;
      if ((m[3] === 'manana' || m[3] === 'madrugada') && h === 12) h = 0;
      if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
    }
    m = s.match(/\ba\s+las?\s+(\d{1,2})(?:[:.h]([0-5]\d))?/) || s.match(/\b(\d{1,2})(?:[:.h]([0-5]\d))?\s*(?:hs?|hrs?|horas?)\b/);
    if (m) {
      const h = +m[1];
      if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
    }
    if (bareOk) {
      m = s.match(/^\s*(\d{1,2})(?:[:.h]([0-5]\d))?\s*$/);
      if (m) {
        const h = +m[1];
        if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
      }
    }
    return null;
  }

  /**
   * Interpreta con tolerancia una respuesta de "¿qué día y hora?" del diálogo
   * guiado de turno: acepta solo hora ("a las 15", "3 de la tarde", "15hs", "15"),
   * solo fecha ("el 20/10", "mañana", "el viernes"), o ambas. Con hora y sin fecha
   * → hoy (o mañana si ya pasó). Devuelve `whenAt` si armó fecha+hora; si solo hubo
   * fecha, `dateKey` (YYYY-MM-DD) para volver a preguntar la hora.
   */
  static resolveWhen(text: string, from: Date = new Date()): { whenAt: Date | null; hadTime: boolean; hadDate: boolean; dateKey?: string } {
    const t = (text || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const tz = config.timezone || 'America/Asuncion';
    const keyOf = (dt: Date) => dt.toLocaleDateString('en-CA', { timeZone: tz });

    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
    const weekdays = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const dm = t.match(/\b([0-3]?\d)\s*[\/.\-]\s*([01]?\d)(?:\s*[\/.\-]\s*(\d{2,4}))?\b/);
    const dNameM = t.match(/\b([0-3]?\d)\s+de\s+([a-z]+)/);
    const dName = dNameM && months.some((mo) => dNameM[2].startsWith(mo.slice(0, 4))) ? dNameM : null;
    const enN = t.match(/\ben\s+(\d{1,3})\s*d[ií]as?\b/);
    const wIdx = weekdays.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
    const relWord = /\bpasado\s+manana\b/.test(t) ? 2 : /\bmanana\b/.test(t) ? 1 : /\bhoy\b/.test(t) ? 0 : null;
    const elD = t.match(/\bel\s+([0-3]?\d)\b(?!\s*[\/.\-:h])/);
    // Si hay CUALQUIER indicio de fecha, un número suelto NO es la hora.
    const hasDateHint = !!(dm || dName || enN || wIdx >= 0 || relWord !== null || elD);
    const clock = this.extractClock(t, !hasDateHint);
    const hadTime = !!clock;
    const [hh, mm] = hadTime ? clock!.split(':').map(Number) : [12, 0];

    const [ty, tmo, td] = keyOf(from).split('-').map(Number);
    let y = ty, mo = tmo, d = td;
    let hadDate = false;
    let explicitDate = false;
    let usedElD = false;
    const shiftFrom = (n: number) => {
      [y, mo, d] = keyOf(new Date(from.getTime() + n * 86_400_000)).split('-').map(Number);
      hadDate = true;
    };

    if (dm) {
      d = +dm[1]; mo = +dm[2];
      if (dm[3]) y = dm[3].length === 2 ? 2000 + +dm[3] : +dm[3];
      hadDate = explicitDate = true;
    } else if (dName) {
      const mi = months.findIndex((mo2) => dName[2].startsWith(mo2.slice(0, 4)));
      d = +dName[1];
      mo = (mi === 9 ? 8 : mi > 9 ? mi - 1 : mi) + 1; // "setiembre" alias
      hadDate = explicitDate = true;
    } else if (enN) {
      shiftFrom(+enN[1]); explicitDate = true;
    } else if (relWord !== null) {
      shiftFrom(relWord); if (relWord === 0) explicitDate = false;
    } else if (wIdx >= 0) {
      const enDay: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
      const cur = enDay[new Date(from).toLocaleString('en-US', { timeZone: tz, weekday: 'long' })] ?? 0;
      let add = (wIdx - cur + 7) % 7;
      if (add === 0) add = 7; // "el jueves" dicho un jueves → el jueves que viene
      shiftFrom(add); explicitDate = true;
    } else if (elD) {
      d = +elD[1]; hadDate = true; usedElD = true;
    }

    const mk = (yy: number, MM: number, dd: number) =>
      new Date(`${yy}-${String(MM).padStart(2, '0')}-${String(dd).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-03:00`);
    const dateKey = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    if (!hadTime) return { whenAt: null, hadTime: false, hadDate, dateKey: hadDate ? dateKey : undefined };

    let whenAt = mk(y, mo, d);
    if (!explicitDate && !usedElD && whenAt.getTime() < from.getTime() - 60_000) {
      const [ny, nM, nd] = keyOf(new Date(from.getTime() + 86_400_000)).split('-').map(Number);
      whenAt = mk(ny, nM, nd);
    }
    if (usedElD && whenAt.getTime() < from.getTime() - 3600_000) {
      whenAt = mo === 12 ? mk(y + 1, 1, d) : mk(y, mo + 1, d);
    }
    if (isNaN(whenAt.getTime())) return { whenAt: null, hadTime, hadDate, dateKey };
    return { whenAt, hadTime, hadDate: true, dateKey };
  }

  /** "hace 1 hora" / "recién" / "a las 14:00" / ISO → Date de la última toma. */
  static resolveLastTaken(str: string | undefined | null, from: Date = new Date()): Date {
    const raw = (str || '').trim();
    if (!raw) return from;

    if (/^\d{4}-\d{2}-\d{2}t/i.test(raw)) {
      const iso = new Date(raw);
      if (!isNaN(iso.getTime())) return iso;
    }
    const t = raw.toLowerCase();

    if (/\b(reci[eé]n|reciente|ahora|ac[aá]\s+nom[aá]s|hace\s+nada|now)\b/.test(t)) return from;
    if (/\bhace\s+un?\s+rat/.test(t)) return new Date(from.getTime() - 30 * 60_000);

    const rel = t.match(/hace\s+(un[ao]?|media|\d+(?:[.,]\d+)?)\s*(min|minuto|minutos|h|hs|hrs|hora|horas|d[ií]a|d[ií]as)/);
    if (rel) {
      let n = rel[1] === 'media' ? 0.5 : /^un/.test(rel[1]) ? 1 : parseFloat(rel[1].replace(',', '.'));
      if (isNaN(n)) n = 1;
      const unit = rel[2];
      const ms = /^min/.test(unit) ? n * 60_000 : /^d/.test(unit) ? n * 86_400_000 : n * 3_600_000;
      return new Date(from.getTime() - ms);
    }

    const hm = extractTimes(raw);
    if (hm.length) {
      const [hh, mm] = hm[0].split(':').map(Number);
      let dt = todayAtLocal(hh, mm, from);
      if (dt.getTime() > from.getTime()) dt = new Date(dt.getTime() - 86_400_000); // fue ayer
      return dt;
    }
    return from;
  }

  /** Etiqueta legible de una anticipación en minutos ("1 hora", "2 horas", "1 día"…). */
  static leadLabel(mins: number): string {
    return leadLabel(mins);
  }

  /** Etiqueta legible de un intervalo en horas ("cada 8 h", "cada 2 días"). */
  static intervalLabel(hours: number): string {
    return intervalLabel(hours);
  }

  /** "cada 8 horas" / "cada 2 días" → intervalo en HORAS (1 h a 30 días), o null. */
  static parseInterval(text: string): number | null {
    return parseIntervalHours(text);
  }

  /** Próxima toma: menor `anchor + k·intervalHours` (k≥1) estrictamente futura respecto de `from`. */
  static computeNextDose(anchor: Date, intervalHours: number, from: Date = new Date()): Date {
    const stepMs = Math.max(1, intervalHours) * 3_600_000;
    const elapsed = from.getTime() - anchor.getTime();
    let k = elapsed <= 0 ? 1 : Math.floor(elapsed / stepMs) + 1;
    let next = anchor.getTime() + k * stepMs;
    if (next <= from.getTime()) next += stepMs; // guarda contra redondeo
    return new Date(next);
  }

  /**
   * Interpreta el pedido completo del usuario (texto o audio transcripto) con la IA
   * de Niro; si Niro no está disponible o no devuelve nada, cae a los parsers regex.
   * Devuelve un borrador parcial — el bot completa lo que falte preguntando.
   */
  static async parseReminderRequest(text: string): Promise<Partial<ReminderDraft>> {
    const original = (text || '').trim();
    // Saca el "envoltorio" del pedido para que el parser regex vea solo el contenido:
    // "quiero que me recuerdes tomar losartán…" → "losartán…".
    const raw = original
      .replace(
        /^\s*(?:hola[,\s]+)?(?:por favor[,\s]+)?(?:quiero|necesito|me gustar[ií]a|quisiera|pod[eé]s|puedes)\s+(?:que\s+)?(?:me\s+)?(?:recuerd\w*|acuerdes|hacerme\s+recordar|program\w*|agend\w*|poner\w*|crear\w*|agregar|registr\w*|avis\w*)\s+(?:que\s+)?(?:tome?|tomar|de\s+tomar)?\s*/i,
        ''
      )
      .replace(/^\s*(?:recu[eé]rdame|record[aá]me|acord[aá]te|avisame)\s+(?:que\s+)?(?:tome?|tomar|de\s+tomar)?\s*/i, '')
      .trim();
    if (!original) return { kind: 'MED' };

    const draft: Partial<ReminderDraft> = {};

    if (NiroService.enabled) {
      const ai = await NiroService.extractFields(
        original,
        'De este pedido para programar un recordatorio de medicación o un turno médico, devolvé JSON con: ' +
          'kind ("MED" o "APPOINTMENT"); ' +
          'medication (nombre del medicamento, o para un turno la especialidad/descripción); ' +
          'dose (cantidad por toma tal cual la dijo: "1 comprimido", "10 ml", "1 cucharada"… o null); ' +
          'scheduleKind ("INTERVAL" si dijo "cada N horas", "CLOCK" si dio horarios puntuales, o null); ' +
          'intervalHours (número entero de horas si INTERVAL, si no null); ' +
          'times (array de horarios "HH:MM" en 24h si dio horarios puntuales, si no []); ' +
          'lastTaken (cuándo tomó la última vez tal cual lo dijo: "hace 1 hora", "recién", "a las 14:00"… o null); ' +
          'apptDate ("YYYY-MM-DD" del turno o null); apptTime ("HH:MM" del turno o null); ' +
          'leadMinutes (minutos de anticipación del aviso que pidió: "una hora antes"→60, "el día antes"→1440, o null); ' +
          'durationDays (número de días que dura el tratamiento si lo dijo: "por 3 días"→3, "una semana"→7, o null).'
      );
      if (ai) {
        const k = String(ai.kind || '').toUpperCase();
        draft.kind = k === 'APPOINTMENT' ? 'APPOINTMENT' : k === 'MED' ? 'MED' : undefined;
        if (ai.medication && String(ai.medication).trim()) draft.medication = String(ai.medication).trim().slice(0, 80);
        if (ai.dose && String(ai.dose).trim()) draft.dose = String(ai.dose).trim().slice(0, 60);
        const sk = String(ai.scheduleKind || '').toUpperCase();
        if (sk === 'INTERVAL' || sk === 'CLOCK') draft.scheduleKind = sk;
        const ih = parseInt(String(ai.intervalHours), 10);
        if (ih >= 1 && ih <= MAX_INTERVAL_HOURS) {
          draft.intervalHours = ih;
          draft.scheduleKind = draft.scheduleKind || 'INTERVAL';
        }
        if (Array.isArray(ai.times)) {
          const ts = ai.times.map((x: unknown) => String(x).trim()).filter((x: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x));
          if (ts.length) {
            draft.times = ts;
            draft.scheduleKind = draft.scheduleKind || 'CLOCK';
          }
        }
        if (ai.lastTaken && String(ai.lastTaken).trim()) {
          draft.anchorAt = this.resolveLastTaken(String(ai.lastTaken)).toISOString();
        }
        if (ai.apptDate && ai.apptTime && /^\d{4}-\d{2}-\d{2}$/.test(String(ai.apptDate)) && /^\d{1,2}:\d{2}$/.test(String(ai.apptTime))) {
          const [h, m] = String(ai.apptTime).split(':').map(Number);
          const dt = new Date(`${ai.apptDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`);
          if (!isNaN(dt.getTime()) && dt.getTime() > Date.now() - 3600_000) {
            draft.whenAt = dt.toISOString();
            draft.kind = draft.kind || 'APPOINTMENT';
          }
        }
        const lm = parseInt(String(ai.leadMinutes), 10);
        if (lm >= 5 && lm <= 10080) draft.leadMinutes = lm;
        if (ai.durationDays && Number(ai.durationDays) >= 1 && Number(ai.durationDays) <= 999) {
          draft.endsAt = new Date(Date.now() + Math.min(Number(ai.durationDays), MAX_TREATMENT_DAYS) * 86400_000).toISOString();
        } else if (ai.endsAt && /^\d{4}-\d{2}-\d{2}/.test(String(ai.endsAt))) {
          const e = new Date(String(ai.endsAt));
          if (!isNaN(e.getTime()) && e.getTime() > Date.now()) draft.endsAt = e.toISOString();
        }
      }
    }

    // Respaldo: "por 3 días" / "durante una semana".
    if (!draft.endsAt) {
      const end = parseTreatmentEnd(original);
      if (end) draft.endsAt = end.toISOString();
    }

    // Respaldo regex — completa lo que la IA no trajo. Y CORRIGE: si el texto tiene
    // una hora explícita ("a las 14:30"), esa manda sobre lo que dijo la IA (Niro
    // a veces confunde "avisame 1 hora antes" con la hora del turno).
    if (!draft.whenAt || draft.kind === 'APPOINTMENT') {
      const appt = this.parseAppointment(original);
      if (appt) {
        draft.kind = 'APPOINTMENT';
        const hasExplicitClock = /\b([01]?\d|2[0-3])[:.][0-5]\d\b/.test((original || '').toLowerCase().replace(LEAD_PHRASE_RE, ' '));
        if (!draft.whenAt || hasExplicitClock) draft.whenAt = appt.whenAt.toISOString();
        draft.medication = draft.medication || appt.note;
      } else if (draft.kind === 'APPOINTMENT' && !draft.whenAt) {
        // parseAppointment falló (p.ej. "4 de la tarde" lo tomaba como día 4) →
        // reintento con el parser tolerante de fecha/hora.
        const w = this.resolveWhen(original);
        if (w.whenAt) draft.whenAt = w.whenAt.toISOString();
      }
    }
    if ((!draft.medication || !draft.scheduleKind) && draft.kind !== 'APPOINTMENT') {
      // "cada N horas" / "cada N días" tiene prioridad: es INTERVAL, no horarios fijos.
      const ivh = parseIntervalHours(raw);
      if (ivh && !draft.intervalHours) {
        draft.intervalHours = ivh;
        draft.scheduleKind = 'INTERVAL';
        draft.kind = draft.kind || 'MED';
      }
      const p = this.parse(raw);
      if (p) {
        draft.kind = draft.kind || 'MED';
        draft.medication = draft.medication || p.medication;
        draft.dose = draft.dose ?? (p.dose || undefined);
        if (!draft.scheduleKind) {
          draft.scheduleKind = 'CLOCK';
          draft.times = draft.times && draft.times.length ? draft.times : p.times;
        }
      }
    }
    if (
      !draft.anchorAt &&
      draft.scheduleKind === 'INTERVAL' &&
      /\b(reci[eé]n|hace\s+(un|media|\d)|a\s+las\s+\d|tom[eé]\s|ya\s+tom)/i.test(raw)
    ) {
      draft.anchorAt = this.resolveLastTaken(raw).toISOString();
    }

    // Si el pedido vino "completo" (nombre + esquema + ancla si aplica) pero sin dosis,
    // NO trabar el flujo pidiéndola: se guarda sin dosis y el titular la agrega luego.
    const richMed =
      draft.kind === 'MED' &&
      !!draft.medication &&
      !!draft.scheduleKind &&
      (draft.scheduleKind === 'CLOCK' ? !!(draft.times && draft.times.length) : !!(draft.intervalHours && draft.anchorAt));
    if (richMed && draft.dose === undefined) draft.dose = null;

    // "avisame una hora antes" / "media hora antes" / "el día antes" → leadMinutes.
    if (draft.leadMinutes === undefined) {
      const lo = original.toLowerCase();
      if (/\b(el\s+d[ií]a|un\s+d[ií]a)\s+antes\b/.test(lo)) draft.leadMinutes = 1440;
      else {
        const lm = lo.match(/\b(?:avisa\w*\s+(?:me\s+)?)?(un[ao]?|media|\d+(?:[.,]\d+)?)\s*(hora|horas|hs?|min|minutos?|d[ií]as?)\s+antes\b/);
        if (lm) {
          const n = lm[1] === 'media' ? 0.5 : /^un/.test(lm[1]) ? 1 : parseFloat(lm[1].replace(',', '.'));
          if (!isNaN(n)) {
            const mins = /^min/.test(lm[2]) ? Math.round(n) : /^d/.test(lm[2]) ? Math.round(n * 1440) : Math.round(n * 60);
            if (mins >= 5 && mins <= 10080) draft.leadMinutes = mins;
          }
        }
      }
    }

    // Nunca devuelve null: si no hay datos concretos, arranca un borrador vacío del
    // tipo detectado para que el diálogo guiado pregunte lo que falte.
    if (!draft.kind) draft.kind = draft.whenAt || /\b(cita|turno|consulta|hora\s+m[eé]dica)\b/i.test(raw) ? 'APPOINTMENT' : 'MED';
    return draft;
  }

  /** ¿Qué falta preguntar para poder guardar el borrador? '' = listo para confirmar. */
  static draftNextStep(d: Partial<ReminderDraft>): '' | 'name' | 'sched' | 'last' | 'dose' | 'when' | 'lead' {
    if (d.kind === 'APPOINTMENT') {
      if (!d.medication) return 'name';
      if (!d.whenAt) return 'when';
      if (d.leadMinutes === undefined || d.leadMinutes === null) return 'lead';
      return '';
    }
    if (!d.medication) return 'name';
    if (!d.scheduleKind || (d.scheduleKind === 'CLOCK' && !(d.times && d.times.length)) || (d.scheduleKind === 'INTERVAL' && !d.intervalHours))
      return 'sched';
    if (d.scheduleKind === 'INTERVAL' && !d.anchorAt) return 'last';
    if (d.dose === undefined) return 'dose';
    return '';
  }

  /** Primera letra en mayúscula ("cardiólogo" → "Cardiólogo", "losartán" → "Losartán"). */
  private static cap(s: string): string {
    const t = (s || '').trim();
    return t ? t.charAt(0).toLocaleUpperCase('es') + t.slice(1) : t;
  }

  /** Resumen legible del borrador para el paso de confirmación. */
  static describeDraft(d: Partial<ReminderDraft>): string {
    if (d.kind === 'APPOINTMENT') {
      const when = d.whenAt ? fmtDateTime(new Date(d.whenAt)) : '—';
      const lead = d.leadMinutes ? ` · aviso ${leadLabel(d.leadMinutes)} antes` : '';
      return `🩺 *${this.cap(d.medication || 'Consulta médica')}*\n📅 ${when}${lead}`;
    }
    const dose = d.dose ? ` (${d.dose})` : '';
    const until = d.endsAt
      ? `\n📆 hasta el ${new Date(d.endsAt).toLocaleDateString('es-PY', { timeZone: TZ(), day: '2-digit', month: '2-digit' })} (después se desactiva solo)`
      : '';
    if (d.scheduleKind === 'INTERVAL') {
      const anchor = d.anchorAt ? new Date(d.anchorAt) : new Date();
      const next = this.computeNextDose(anchor, d.intervalHours || 8);
      const lead = d.leadMinutes && d.leadMinutes !== 10 ? ` · aviso ${leadLabel(d.leadMinutes)} antes` : '';
      return `💊 *${this.cap(d.medication || '')}*${dose}\n🔁 ${intervalLabel(d.intervalHours || 8)} · próxima ${fmtNextDose(next)}${lead}${until}`;
    }
    return `💊 *${this.cap(d.medication || '')}*${dose}\n⏰ ${(d.times || []).join(', ')} todos los días${until}`;
  }

  /** Persiste un borrador ya confirmado. Calcula `nextDoseAt` para INTERVAL. */
  static async createFromDraft(userId: string, d: Partial<ReminderDraft>) {
    if (d.kind === 'APPOINTMENT') {
      return prisma.medicationReminder.create({
        data: {
          userId,
          kind: 'APPOINTMENT',
          medication: this.cap((d.medication || 'Consulta médica').slice(0, 120)),
          whenAt: d.whenAt ? new Date(d.whenAt) : null,
          times: '[]',
          leadMinutes: d.leadMinutes ?? 120,
        },
      });
    }
    const scheduleKind = d.scheduleKind === 'INTERVAL' ? 'INTERVAL' : 'CLOCK';
    const data: any = {
      userId,
      kind: 'MED',
      scheduleKind,
      medication: this.cap((d.medication || 'Medicación').slice(0, 80)),
      dose: d.dose ? String(d.dose).slice(0, 60) : null,
      leadMinutes: d.leadMinutes ?? 10,
      endsAt: d.endsAt && !isNaN(new Date(d.endsAt).getTime()) ? new Date(d.endsAt) : null,
    };
    if (scheduleKind === 'INTERVAL') {
      const anchor = d.anchorAt ? new Date(d.anchorAt) : new Date();
      data.intervalHours = d.intervalHours || 8;
      data.anchorAt = anchor;
      data.nextDoseAt = this.computeNextDose(anchor, data.intervalHours);
      data.times = '[]';
    } else {
      data.times = JSON.stringify(d.times && d.times.length ? d.times : ['08:00']);
    }
    return prisma.medicationReminder.create({ data });
  }

  /** Lista legible de recordatorios para WhatsApp. */
  static format(
    rows: Array<{
      kind?: string;
      scheduleKind?: string | null;
      medication: string;
      dose: string | null;
      times: string;
      intervalHours?: number | null;
      nextDoseAt?: Date | null;
      whenAt?: Date | null;
      endsAt?: Date | null;
      active: boolean;
    }>
  ): string {
    if (!rows.length) return '';
    return rows
      .map((r, i) => {
        const state = r.active ? '' : ' _(pausado)_';
        const until = r.endsAt
          ? ` · hasta ${new Date(r.endsAt).toLocaleDateString('es-PY', { timeZone: TZ(), day: '2-digit', month: '2-digit' })}`
          : '';
        if (r.kind === 'APPOINTMENT') {
          const w = r.whenAt
            ? new Date(r.whenAt).toLocaleString('es-PY', {
                timeZone: TZ(),
                day: '2-digit',
                month: '2-digit',
                hourCycle: 'h23',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '';
          return `*${i + 1}.* 🩺 *${r.medication}* — 📅 ${w}${state}`;
        }
        if (r.scheduleKind === 'INTERVAL') {
          const nx = r.nextDoseAt ? ` · próxima ${fmtNextDose(new Date(r.nextDoseAt))}` : '';
          return `*${i + 1}.* 💊 *${r.medication}*${r.dose ? ` (${r.dose})` : ''} — 🔁 ${intervalLabel(r.intervalHours || 8)}${nx}${until}${state}`;
        }
        let hs: string[] = [];
        try {
          hs = JSON.parse(r.times);
        } catch {
          /* noop */
        }
        return `*${i + 1}.* 💊 *${r.medication}*${r.dose ? ` (${r.dose})` : ''} — ⏰ ${hs.join(', ')}${until}${state}`;
      })
      .join('\n');
  }

  /**
   * Consulta en lenguaje natural sobre la medicación / turnos del titular.
   * Devuelve el texto de respuesta, o `null` si el mensaje no es una consulta de este tipo
   * (para que el bot siga con su flujo normal). Determinístico (regex); sin costo de IA.
   */
  static async answerQuery(userId: string, text: string, _lang: string = 'es'): Promise<string | null> {
    const t = (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // sin tildes — el audio transcripto a veces no las trae
      .trim();
    if (!t) return null;
    // Puerta barata: solo seguimos si el mensaje huele a consulta de medicación/turnos.
    // (Sin `\b` de cierre: son raíces — "proxima", "medicacion", "tomando"…)
    if (
      !/\b(tom[aoe]|tome|tomar|pastill|remedi|medicaci|medicament|dosis|turno|cita|consulta|proxim|cuanto\s+falta|horario|a\s+que\s+hora|agendad|reservad|programad|doctor|medic|especialista|dentista)/.test(
        t
      )
    )
      return null;
    // Si es un pedido de CARGAR / registrar algo ("alzá mi remedio", "quiero subir la receta"),
    // NO es una consulta → que lo maneje el router de intención del bot.
    if (/\b(cargar|carg[aá]|subir|sub[ií]|subime|alzar|alz[aá]|alzame|guardar|guard[aá]|agregar|agreg[aá]|anotar|anot[aá]|registrar|registr[aá]|adjuntar|dar\s+de\s+alta)\b/.test(t))
      return null;
    // Si es un pedido de CREAR / PROGRAMAR un recordatorio o alarma ("quiero programar
    // un recordatorio", "ponéme una alarma para tomar…", "hacéme recordar"), tampoco es
    // una consulta → lo arranca el diálogo guiado del router.
    if (
      /\b(programar?|program[aá]|configurar?|configur[aá]|crear?|cre[aá]|armar?|arm[aá]|pon(?:er|é|eme|ele)|poné|hacer?me?\s+recordar|hac[eé]me\s+recordar|hagas?\s+recordar)\b/.test(t) &&
      /\b(recordatorio|recordatorios|alarma|alarmas|aviso|avisos|recordar|recuerde|recuerd[ae]s?)\b/.test(t)
    )
      return null;
    // "quiero que me recuerdes / recordame que tome…" → creación, no consulta.
    if (/\b(recu[eé]rd[ae]me|record[aá]me|acord[aá]te|que\s+me\s+recuerdes|hacerme\s+recordar)\b/.test(t)) return null;

    // ¿Es claramente una PREGUNTA / pedido de información? (empieza con interrogativo,
    // trae "?", o verbos de consulta). Sirve para no dejarla caer en "cargar medicamento".
    const isQuestion =
      /[?¿]/.test(text || '') ||
      /^(que|qué|cual|cuál|cuando|cuándo|como|cómo|donde|dónde|tengo|hay|tenes|tenés|me\s+pod|pod(e|é)s|podr|quiero\s+saber|me\s+dec|decime|mostra|mostrame|ver\s+si|a\s+ver)/.test(t) ||
      /\b(tengo\s+(alg|un|algun)|hay\s+alg|me\s+gustaria\s+(ver|saber)|quiero\s+ver|puedo\s+ver)\b/.test(t);

    const [meds, reminders] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { currentMedications: true } }),
      prisma.medicationReminder.findMany({ where: { userId, active: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const medList = parseMedications(meds?.currentMedications ?? null);
    const medReminders = reminders.filter((r) => r.kind === 'MED');
    const appts = reminders
      .filter((r) => r.kind === 'APPOINTMENT' && r.whenAt)
      .sort((a, b) => new Date(a.whenAt!).getTime() - new Date(b.whenAt!).getTime());
    const now = new Date();

    // --- "ya tomé [X]" → re-anclar los INTERVAL ---
    // Solo si es un acuse corto — NO si el mensaje además pide crear/registrar un
    // recordatorio ("necesito registrar… ya tomé uno hace una hora" = el "ya tomé" es
    // el ancla de un recordatorio NUEVO, lo maneja el router de creación).
    const isJustTook =
      (/\b(ya\s+tom[eé]|reci[eé]n\s+tom[eé]|tom[eé]\s+(mi|el|la|un[ao]|ya))\b/.test(t) || /^tom[eé]\b/.test(t)) &&
      !/(necesito|quiero|voy\s+a|debo|tengo\s+que\s+tomar|registrar|program|configurar|hac(er|es|é|éme|eme)\s+.{0,15}recordar|hagas?\s+recordar|record(a|á)r?me|avis(a|á)r?me|cargar\s+un\s+horario|cada\s+\d{1,2}\s*(h|hora)|por\s+\d+\s+(d[ií]a|semana))/.test(
        t
      );
    if (isJustTook) {
      const nameHint = t.replace(/.*\btom[eé]\b/, '').replace(/\b(mi|el|la|un[ao]|ya|pastilla|remedio|medicaci[oó]n|reci[eé]n)\b/g, '').trim();
      const targets = medReminders.filter(
        (r) => r.scheduleKind === 'INTERVAL' && (!nameHint || normName(r.medication).includes(normName(nameHint)) || normName(nameHint).includes(normName(r.medication)))
      );
      if (!targets.length) {
        return medReminders.some((r) => r.scheduleKind === 'INTERVAL')
          ? 'No encontré ese medicamento entre tus recordatorios "cada X horas". Escribí *5* para verlos.'
          : 'No tenés recordatorios "cada X horas" cargados. Los de horario fijo se avisan solos a la hora — no hace falta que confirmes.';
      }
      const lines: string[] = [];
      for (const r of targets) {
        const next = this.computeNextDose(now, r.intervalHours || 8, now);
        await prisma.medicationReminder.update({
          where: { id: r.id },
          data: { anchorAt: now, nextDoseAt: next, lastSentSlot: null },
        });
        lines.push(`💊 *${r.medication}* — próxima toma ~${fmtHHMM(next)}`);
      }
      return `✅ Anotado que tomaste ahora.\n${lines.join('\n')}`;
    }

    // --- "¿qué cita tengo registrada?" / "¿tengo turno?" / "¿cuándo es mi próximo turno?" ---
    // Va primero (es menos ambiguo). NO cuando el mensaje trae fecha+hora (eso es agendar),
    // ni cuando es una orden de crear/borrar/mover.
    const mentionsAppt =
      /\b(turnos?|citas?|consultas?|hora\s+medica)\b/.test(t) ||
      /\b(ir|voy|ver|visitar|tengo\s+que\s+ir)\b.{0,18}\b(al\s+|a\s+la\s+|con\s+el\s+|con\s+la\s+)?(doctor|dr\b|dra\b|medic|especialista|dentista|odontolog|oftalmolog|cardiolog|traumatolog|dermatolog|pediatr|ginecolog|neurolog|urolog|kinesiolog|nutricionist|psicolog|hospital|sanatorio|clinic)/.test(t);
    // "quiero/necesito SABER/VER si tengo cita" es una PREGUNTA, no un pedido de agendar.
    const isRegistrationVerb =
      /^(quiero|necesito|quisiera|quer[ií]a|agend|program|reserv|anot[aá]|pon[eé]r?me|cre[aá]r?|sac[aá]r?me\s+un)/.test(t) &&
      !/^(quiero|necesito|quisiera|quer[ií]a|me\s+gustaria|me\s+gustar[ií]a)\s+(saber|ver|consultar|conocer|revisar|chequear|checar|confirmar|averiguar|preguntar|fijar)/.test(t);
    const isEditVerb = /\b(borr|elimin|quit[aá]|cancel|cambi|modific|mov[eé]r?|reprogram)/.test(t);
    const asksAppt =
      isQuestion ||
      /(cuando|cual|proxim|que\s+dia|que\s+hora)/.test(t) ||
      /\bque\s+(cita|turno|consulta)s?\b/.test(t) ||
      /\b(tengo|tenes|ten(e|é)s|hay)\b.{0,30}\b(turno|cita|consulta)/.test(t) ||
      /\b(turno|cita|consulta)s?\b.{0,30}\b(tengo|tenes|registrad|regitrad|anotad|agendad|reservad|guardad|programad|pendiente|para\s+(hoy|mañana|el|cuando))/.test(t) ||
      /\bmi(s)?\s+(proxim\w*\s+)?(turno|cita|consulta)/.test(t) ||
      /\b(alguna|algun|una|algo\s+de)\s+(cita|turno|consulta)/.test(t);
    if (mentionsAppt && asksAppt && !isRegistrationVerb && !isEditVerb && !this.parseAppointment(text)) {
      const nextAppt = appts.find((r) => new Date(r.whenAt!).getTime() > now.getTime() - 3600_000);
      if (!nextAppt) return '🩺 No tenés turnos agendados. Para agendar uno decime, por ejemplo: _"turno con cardiólogo el 20/10 a las 10:00"_.';
      return `🩺 *Tu próximo turno:*\n*${nextAppt.medication}*\n📅 ${fmtDateTime(new Date(nextAppt.whenAt!))}\nTe voy a avisar ${leadLabel(apptLead(nextAppt.leadMinutes))} antes.`;
    }

    // --- "¿qué estoy tomando?" / "¿cómo se llama lo que tomo?" / "¿qué remedios tengo?" ---
    if (
      /(que\s+(medicament|remedio|pastilla|medicaci)|como\s+se\s+llama|mi\s+medicaci|que\s+estoy\s+tomando|que\s+tomo\b(?!\s+hoy)|que\s+remedios?\s+(tengo|uso|hay)|remedios?\s+que\s+(tomo|uso)|mis?\s+(remedios?|medicament|pastillas?)|lista\s+de\s+(remedios?|medic))/.test(t) &&
      !/\bhoy\b/.test(t) &&
      !/a\s+que\s+hora/.test(t) &&
      !/(proxim|cuanto\s+falta|ahora\b|tengo\s+que\s+tomar)/.test(t) &&
      // NO si es un pedido de CARGAR / registrar un medicamento ("alzá mi remedio").
      !/\b(cargar|carg|subir|sub[íi]|subime|alzar|alz|guardar|guard|agregar|agreg|anotar|anot|registrar|registr|adjuntar|dar\s+de\s+alta)\b/.test(t)
    ) {
      const parts: string[] = [];
      if (medList.length) parts.push(`💊 *Tu medicación cargada (${medList.length}):*\n${formatMedications(medList, { max: 20 })}`);
      if (medReminders.length) {
        parts.push(
          `⏰ *Con recordatorio:*\n` +
            medReminders
              .map((r) =>
                r.scheduleKind === 'INTERVAL'
                  ? `• *${r.medication}*${r.dose ? ` (${r.dose})` : ''} — ${intervalLabel(r.intervalHours || 8)}`
                  : `• *${r.medication}*${r.dose ? ` (${r.dose})` : ''} — ${(JSON.parse(r.times || '[]') as string[]).join(', ')}`
              )
              .join('\n')
        );
      }
      if (!parts.length) return 'Todavía no tenés medicación cargada. Escribí *1* para cargar un medicamento o *5* para programar un horario.';
      return parts.join('\n\n');
    }

    // Próximas tomas (una función común para "a qué hora" y "próxima toma").
    const upcoming = this.upcomingDoses(medReminders, now);

    // --- "¿a qué hora tomo el losartán?" (medicamento nombrado) ---
    const hourAsk = t.match(/a\s+qu[eé]\s+hora\s+(?:tengo\s+que\s+|debo\s+|me\s+toca\s+)?tom(?:ar|o)\s+(?:el|la|los|las|mi)?\s*(.+)/) ||
      t.match(/\bcu[aá]ndo\s+(?:tengo\s+que\s+|debo\s+|me\s+toca\s+)?tom(?:ar|o)\s+(?:el|la|los|las|mi)?\s*(.+)/);
    if (hourAsk) {
      const q = normName(hourAsk[1].replace(/[?¿!¡.]+$/g, ''));
      const hit = medReminders.find((r) => q && (normName(r.medication).includes(q) || q.includes(normName(r.medication))));
      if (hit) {
        if (hit.scheduleKind === 'INTERVAL') {
          const nx = hit.nextDoseAt ? fmtNextDose(new Date(hit.nextDoseAt)) : '—';
          return `💊 *${hit.medication}*${hit.dose ? ` (${hit.dose})` : ''}: ${intervalLabel(hit.intervalHours || 8)} · próxima ${nx}.`;
        }
        return `💊 *${hit.medication}*${hit.dose ? ` (${hit.dose})` : ''}: ${(JSON.parse(hit.times || '[]') as string[]).join(', ')} todos los días.`;
      }
      // no lo encontró por nombre → cae a "próxima toma"
    }

    // --- "¿qué tengo que tomar ahora?" / "¿cuál es mi próxima toma?" / "¿cuánto falta?" ---
    // También cae acá cualquier PREGUNTA sobre remedios/medicación que no matcheó arriba
    // (así nunca se interpreta como "cargar medicamento").
    // Ojo: NO usar un "ahora" suelto — "ahora quiero un recordatorio…" no es una consulta.
    const asksDose =
      /(proxim|cuanto\s+falta|que\s+(tengo\s+que\s+|debo\s+)?tom|a\s+que\s+hora|tom(ar|o)\s+ahora|ahora\s+(tengo\s+que|me\s+toca|debo)|mis?\s+(remedios?|pastillas?)\s+(de\s+hoy|pendient|ahora|para\s+hoy)|que\s+remedio\s+(tengo|debo|toca|tomar)|remedio\s+.*(tomar|toca)|tengo\s+.*(remedio|pastilla|medic).*(que\s+tomar|programad|hoy|pendient)|toca\s+tom)/.test(
        t
      );
    if (asksDose || (isQuestion && /\b(remedi|pastill|medicaci|medicament|tom[ae]|tomar|dosis)\b/.test(t))) {
      if (!upcoming.length) {
        return medList.length
          ? `💊 *Tu medicación cargada:*\n${formatMedications(medList, { max: 20 })}\n\n_No tenés horarios de aviso programados — escribí *5* para agregarlos._`
          : 'No tenés medicación con horario cargada. Escribí *5* para programar una (ej: _"Losartán cada 8 horas"_).';
      }
      const next = upcoming[0];
      const rest = upcoming.slice(1, 4).map((u) => `• ${u.label} — ${fmtHHMM(u.at)}`);
      return (
        `⏭️ *Tu próxima toma:* ${next.label}\n🕒 ${fmtHHMM(next.at)} (en ${humanIn(next.at.getTime() - now.getTime())})` +
        (rest.length ? `\n\n*Después:*\n${rest.join('\n')}` : '')
      );
    }

    return null;
  }

  /** Próximas tomas (24 h) de una lista de recordatorios MED, ordenadas. */
  private static upcomingDoses(
    medReminders: Array<{ medication: string; dose: string | null; times: string; scheduleKind: string | null; intervalHours: number | null; nextDoseAt: Date | null }>,
    now: Date
  ): Array<{ at: Date; label: string }> {
    const out: Array<{ at: Date; label: string }> = [];
    for (const r of medReminders) {
      const label = `${r.medication}${r.dose ? ` (${r.dose})` : ''}`;
      if (r.scheduleKind === 'INTERVAL') {
        if (r.nextDoseAt) out.push({ at: new Date(r.nextDoseAt), label });
        continue;
      }
      let times: string[] = [];
      try {
        times = JSON.parse(r.times || '[]');
      } catch {
        /* noop */
      }
      for (const hm of times) {
        const [hh, mm] = hm.split(':').map(Number);
        if (Number.isNaN(hh)) continue;
        let at = todayAtLocal(hh, mm, now);
        if (at.getTime() < now.getTime() - 5 * 60_000) at = new Date(at.getTime() + 86_400_000); // ya pasó → mañana
        out.push({ at, label });
      }
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  /**
   * Tick del CRON (cada 5 min): dispara los recordatorios cuya hora cae en la ventana
   * y que no se enviaron ya en ese slot. Si el bot de WhatsApp está desconectado, no
   * hace nada (los recordatorios no avanzan → se reintentan en el próximo tick).
   */
  static async tick(): Promise<number> {
    if (!whatsappBot.getStatus().connected) {
      return 0;
    }
    const { minutes: nowMin, date } = nowLocal();
    const nowMs = Date.now();
    let sent = 0;

    const reminders = await prisma.medicationReminder.findMany({
      where: { active: true },
      include: { user: { select: { id: true, phoneNumber: true, whatsappJid: true, status: true, language: true } } },
    });

    for (const r of reminders) {
      if (!r.user || (r.user.status !== 'ACTIVE' && r.user.status !== 'EXPIRED')) continue;

      // Fin del tratamiento ("por 3 días") → se desactiva solo, con un aviso de cierre.
      if (r.kind === 'MED' && r.endsAt && nowMs > new Date(r.endsAt).getTime()) {
        const gnEnd = r.user.language === 'GN';
        if (r.lastSentSlot !== 'ENDED') {
          const msg = gnEnd
            ? `✅ *${r.medication}* — opa pe tratamiento. Ndorohechavéima momandu'a.`
            : `✅ Terminó el tratamiento de *${r.medication}*. No te aviso más por este. _Si seguís tomándolo, escribí *5* y cargalo de nuevo._`;
          PushService.notify(r.user.id, '✅ Tratamiento terminado', msg, { tag: `reminder-${r.id}` });
          if (await whatsappBot.sendMessage(r.user.whatsappJid || r.user.phoneNumber, msg)) {
            await prisma.medicationReminder.update({ where: { id: r.id }, data: { active: false, lastSentSlot: 'ENDED' } });
            sent++;
          }
        } else {
          await prisma.medicationReminder.update({ where: { id: r.id }, data: { active: false } });
        }
        continue;
      }

      const gn = r.user.language === 'GN';
      const target = r.user.whatsappJid || r.user.phoneNumber;
      const lead = r.kind === 'APPOINTMENT' ? apptLead(r.leadMinutes) : Math.max(1, r.leadMinutes || 10);

      // --- Turno / consulta médica (una sola vez) ---
      if (r.kind === 'APPOINTMENT') {
        if (!r.whenAt) continue;
        const whenMs = new Date(r.whenAt).getTime();
        const dtLocal = fmtDateTime(new Date(r.whenAt));

        // Cortesía 24 h antes (salvo que el aviso pedido ya sea de ~1 día).
        if (lead < 1200 && r.lastSentSlot !== 'D-1' && r.lastSentSlot !== 'LEAD' && whenMs - nowMs <= 24 * 3600_000 && whenMs - nowMs > 24 * 3600_000 - 6 * 60_000) {
          const msg = gn
            ? `📅 *Momandu'a: turno* ko'ẽrõ\n\n*${r.medication}*\n🕒 ${dtLocal}`
            : `📅 *Recordatorio: turno mañana*\n\n*${r.medication}*\n🕒 ${dtLocal}`;
          PushService.notify(r.user.id, '📅 Turno mañana', msg, { tag: `reminder-${r.id}`, url: '/dashboard' });
          if (await whatsappBot.sendMessage(target, msg)) {
            await prisma.medicationReminder.update({ where: { id: r.id }, data: { lastSentAt: new Date(), lastSentSlot: 'D-1' } });
            sent++;
          }
          continue;
        }
        // Aviso principal: `leadMinutes` antes (con tolerancia hasta la hora del turno).
        const untilLead = whenMs - nowMs - lead * 60_000;
        if (r.lastSentSlot !== 'LEAD' && untilLead <= 150_000 && whenMs - nowMs > -15 * 60_000) {
          const msg = gn
            ? `📅 *Turno* — *${r.medication}*\n🕒 ${dtLocal}`
            : `📅 *Tu turno médico*\n\n*${r.medication}*\n🕒 ${dtLocal}\n\n_Faltan ${leadLabel(lead)}. No faltes._`;
          PushService.notify(r.user.id, '📅 Tu turno médico', msg, { tag: `reminder-${r.id}`, url: '/dashboard', requireInteraction: true });
          if (await whatsappBot.sendMessage(target, msg)) {
            await prisma.medicationReminder.update({
              where: { id: r.id },
              data: { lastSentAt: new Date(), lastSentSlot: 'LEAD', active: whenMs > nowMs },
            });
            sent++;
          }
        }
        if (whenMs < nowMs - 3600_000) {
          await prisma.medicationReminder.update({ where: { id: r.id }, data: { active: false } });
        }
        continue;
      }

      // --- Medicación por INTERVALO (cada N horas desde la última toma) ---
      if (r.scheduleKind === 'INTERVAL') {
        if (!r.nextDoseAt || !r.intervalHours) continue;
        const nd = new Date(r.nextDoseAt).getTime();
        const dueTag = new Date(nd).toISOString();
        const preTag = `PRE:${dueTag}`;

        // Pre-aviso `leadMinutes` antes.
        if (r.lastSentSlot !== preTag && r.lastSentSlot !== dueTag) {
          const untilPre = nd - nowMs - lead * 60_000;
          if (untilPre <= 150_000 && untilPre > -150_000) {
            const msg = gn
              ? `⏰ *Momandu'a: ${leadLabel(lead)} rupi*\n\n*${r.medication}*${r.dose ? ` (${r.dose})` : ''} — ${fmtHHMM(new Date(nd))}.`
              : `⏰ *En ${leadLabel(lead)} toca tu medicación*\n\n*${r.medication}*${r.dose ? ` (${r.dose})` : ''} a las ${fmtHHMM(new Date(nd))}.`;
            PushService.notify(r.user.id, '⏰ Se acerca tu medicación', msg, { tag: `reminder-${r.id}`, url: '/dashboard' });
            if (await whatsappBot.sendMessage(target, msg)) {
              await prisma.medicationReminder.update({ where: { id: r.id }, data: { lastSentAt: new Date(), lastSentSlot: preTag } });
              sent++;
            }
            continue;
          }
        }

        // Aviso a la hora.
        if (r.lastSentSlot !== dueTag && nowMs >= nd) {
          if (nowMs - nd <= 30 * 60_000) {
            const msg = gn
              ? `⏰ *Momandu'a pohã*\n\nHi'ára reipuru hag̃ua *${r.medication}*${r.dose ? ` (${r.dose})` : ''}.\n\n_Ehai *YA TOMÉ* rejapo rire._`
              : `⏰ *Recordatorio de medicación*\n\nEs hora de tomar *${r.medication}*${r.dose ? ` (${r.dose})` : ''}.\n\n_Cuando la tomes escribí *YA TOMÉ* y recalculo la próxima._`;
            PushService.notify(r.user.id, '⏰ Hora de tu medicación', msg, { tag: `reminder-${r.id}`, url: '/dashboard', requireInteraction: true });
            if (await whatsappBot.sendMessage(target, msg)) {
              const next = this.computeNextDose(new Date(nd), r.intervalHours, new Date());
              await prisma.medicationReminder.update({
                where: { id: r.id },
                data: { lastSentAt: new Date(), lastSentSlot: dueTag, nextDoseAt: next },
              });
              sent++;
            }
          } else {
            // Atraso grande (bot caído un buen rato) → avanzar en silencio, sin spamear.
            const next = this.computeNextDose(new Date(nd), r.intervalHours, new Date());
            await prisma.medicationReminder.update({ where: { id: r.id }, data: { nextDoseAt: next, lastSentSlot: dueTag } });
          }
        }
        continue;
      }

      // --- Medicación por HORARIOS FIJOS del día (CLOCK) ---
      let slots: string[] = [];
      try {
        slots = JSON.parse(r.times);
      } catch {
        continue;
      }

      for (const slot of slots) {
        const [sh, sm] = slot.split(':').map(Number);
        if (Number.isNaN(sh) || Number.isNaN(sm)) continue;
        const slotMin = sh * 60 + sm;

        // Pre-aviso `leadMinutes` antes (ventana de 5 min alrededor).
        const toLead = slotMin - nowMin;
        if (toLead >= lead - 2 && toLead <= lead + 3) {
          const preTag = `PRE10:${slot}|${date}`;
          if (r.lastSentSlot !== preTag) {
            const preMsg = gn
              ? `⏰ *Momandu'a: ${leadLabel(lead)} rupi*\n\n*${r.medication}*${r.dose ? ` (${r.dose})` : ''} — ${slot}.`
              : `⏰ *En ${leadLabel(lead)} toca tu medicación*\n\n*${r.medication}*${r.dose ? ` (${r.dose})` : ''} a las ${slot}.\n\n_Preparala con tiempo._`;
            PushService.notify(r.user.id, '⏰ Se acerca tu medicación', preMsg, { tag: `reminder-${r.id}`, url: '/dashboard' });
            if (await whatsappBot.sendMessage(target, preMsg)) {
              await prisma.medicationReminder.update({ where: { id: r.id }, data: { lastSentAt: new Date(), lastSentSlot: preTag } });
              sent++;
            }
            break;
          }
        }

        // Aviso a la hora — ventana [0, 30] min (tolera que el bot haya estado caído).
        const diff = nowMin - slotMin;
        if (diff < 0 || diff > 30) continue;
        const tag = `${slot}|${date}`;
        if (r.lastSentSlot === tag) continue;

        const msg = gn
          ? `⏰ *Momandu'a pohã*\n\nHi'ára reipuru hag̃ua *${r.medication}*${r.dose ? ` (${r.dose})` : ''}.\n\n_Ehai *MENU* rehecha hag̃ua opciones._`
          : `⏰ *Recordatorio de medicación*\n\nEs hora de tomar *${r.medication}*${r.dose ? ` (${r.dose})` : ''}.\n\n_Cuidá tu salud. Escribí *MENU* para ver tus opciones._`;
        PushService.notify(r.user.id, '⏰ Hora de tu medicación', msg, { tag: `reminder-${r.id}`, url: '/dashboard', requireInteraction: true });
        if (await whatsappBot.sendMessage(target, msg)) {
          await prisma.medicationReminder.update({ where: { id: r.id }, data: { lastSentAt: new Date(), lastSentSlot: tag } });
          sent++;
        }
        break; // un envío por reminder por tick
      }
    }
    if (sent) console.log(`⏰ [CRON] ${sent} recordatorio(s) de medicación enviado(s).`);
    return sent;
  }
}
