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
  /** Presente SOLO en modo edición: id del MedicationReminder ya existente que se
   *  está modificando (en vez de crear uno nuevo). Ver "editar N" en bot-state-machine. */
  id?: string;
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
  startsAt?: string; // ISO — desde cuándo rige ("empiezo el lunes"); vacío = ya
  /** Ya se preguntó por la vigencia (desde/hasta) — no se vuelve a preguntar. */
  rangeAsked?: boolean;
  endsAt?: string; // ISO — fin del tratamiento ("por 3 días" / "hasta el 30/04")
}

/** Número escrito o en dígitos → entero ("tres" → 3, "10" → 10, "veintiuno" → 21). */
const WORD_NUM: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiuna: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, sesenta: 60, noventa: 90,
};
export function toNum(s: string): number {
  const w = (s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  if (/^\d+[.,]\d+$/.test(w)) return parseFloat(w.replace(',', '.')); // "1,5" / "1.5" horas
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
  /\b(?:av[ií]sa(?:me|r)?\s+)?(?:con\s+)?(?:\d{1,3}|un[ao]?|dos|tres|media)\s*(?:h|hs|hrs|horas?|min|minutos?|d[ií]as?)\s*(?:antes|de\s+anticipaci[oó]n|de\s+antelaci[oó]n)?\b|\b(?:el|un)\s+d[ií]a\s+(?:antes|anterior)\b/gi;

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
  10: '10 minutos',
  15: '15 minutos',
  20: '20 minutos',
  30: 'media hora',
  45: '45 minutos',
  60: '1 hora',
  90: '1 hora y media',
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
/** Anticipación efectiva para un TURNO: por defecto 1 hora (60 min) si no se especificó.
 *  Si el usuario indicó minutos específicos (ej: 20 min, 15 min, 30 min, 10 min), se respeta exactamente. */
function apptLead(mins?: number | null): number {
  return mins && mins >= 1 ? mins : 60;
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

/** Diferencia (ms) entre la hora de pared de `tz` y UTC en ese instante — sin offsets fijos a mano. */
function tzOffsetMs(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** "mañana (martes 15/09) a las 10:00" · "hoy a las 16:00" · "jueves 24/09 a las 09:30". */
function fmtApptDay(d: Date, from: Date = new Date()): string {
  const dayOf = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: TZ() });
  const hh = fmtHHMM(d);
  const dayName = d.toLocaleDateString('es-PY', { timeZone: TZ(), weekday: 'long', day: '2-digit', month: '2-digit' });
  if (dayOf(d) === dayOf(from)) return `hoy (${dayName}) a las ${hh}`;
  if (dayOf(d) === dayOf(new Date(from.getTime() + 86_400_000))) return `mañana (${dayName}) a las ${hh}`;
  return `${dayName} a las ${hh}`;
}

export class MedicationReminderService {
  /**
   * Respuesta a "¿qué medicamentos tengo que tomar?", "¿hay horarios registrados?":
   * TODOS los medicamentos con horario (fijo o cada N horas), lo que falta tomar hoy,
   * la próxima toma y cómo se avisa. `name` = pregunta por uno puntual ("¿a qué hora
   * tomo el losartán?"). Hora de Paraguay.
   */
  static async medicationOverviewText(userId: string, name: string | null = null, opts: { onlyNext?: boolean } = {}): Promise<string> {
    const now = new Date();
    const [u, rows] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { currentMedications: true } }),
      prisma.medicationReminder.findMany({ where: { userId, kind: 'MED' }, orderBy: { createdAt: 'asc' } }),
    ]);
    const dayOf = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: TZ() });
    const when = (d: Date) => {
      const hh = fmtHHMM(d);
      if (dayOf(d) === dayOf(now)) return `hoy ${hh}`;
      if (dayOf(d) === dayOf(new Date(now.getTime() + 86_400_000))) return `mañana ${hh}`;
      return `${d.toLocaleDateString('es-PY', { timeZone: TZ(), day: '2-digit', month: '2-digit' })} ${hh}`;
    };
    const joinTimes = (ts: string[]) => (ts.length <= 1 ? ts.join('') : `${ts.slice(0, -1).join(', ')} y ${ts[ts.length - 1]}`);
    /** Tomas de las próximas 24 h de un recordatorio activo. */
    const nextDoses = (r: (typeof rows)[number]): Date[] => {
      if (!r.active) return [];
      if (r.scheduleKind === 'INTERVAL') {
        if (!r.nextDoseAt || !r.intervalHours) return [];
        const out: Date[] = [];
        for (let t = new Date(r.nextDoseAt).getTime(); t < now.getTime() + 86_400_000; t += r.intervalHours * 3600_000) out.push(new Date(t));
        return out;
      }
      let ts: string[] = [];
      try {
        ts = JSON.parse(r.times || '[]');
      } catch {
        /* noop */
      }
      return ts
        .map((hm) => {
          const [hh, mm] = hm.split(':').map(Number);
          let at = todayAtLocal(hh, mm, now);
          if (at.getTime() < now.getTime() - 5 * 60_000) at = new Date(at.getTime() + 86_400_000);
          return at;
        })
        .sort((a, b) => a.getTime() - b.getTime());
    };
    const describe = (r: (typeof rows)[number]): string => {
      const title = `*${r.medication}*${r.dose ? ` (${r.dose})` : ''}`;
      if (!r.active) return `• ${title} — 🔕 aviso pausado`;
      const nx = nextDoses(r)[0];
      const until = r.endsAt ? ` · hasta el ${new Date(r.endsAt).toLocaleDateString('es-PY', { timeZone: TZ(), day: '2-digit', month: '2-digit' })}` : '';
      if (r.scheduleKind === 'INTERVAL') {
        return `• ${title}\n      🔁 ${intervalLabel(r.intervalHours || 8)}${until}${nx ? ` · próxima: ${when(nx)}` : ''}`;
      }
      let ts: string[] = [];
      try {
        ts = JSON.parse(r.times || '[]');
      } catch {
        /* noop */
      }
      return `• ${title}\n      ⏰ ${joinTimes(ts)}, todos los días${until}${nx ? ` · próxima: ${when(nx)}` : ''}`;
    };

    if (name) {
      const hit = rows.filter((r) => normName(r.medication).includes(normName(name)) || normName(name).includes(normName(r.medication)));
      if (hit.length) {
        const nx = hit.flatMap(nextDoses).sort((a, b) => a.getTime() - b.getTime())[0];
        return (
          hit.map(describe).join('\n') +
          (nx ? `\n\n⏭️ Te toca ${when(nx)} (en ${humanIn(nx.getTime() - now.getTime())}). Te aviso ${leadLabel(Math.max(1, hit[0].leadMinutes || 10))} antes y a la hora.` : '') +
          `\n\n_Para cambiarlo: "cambiá el horario de ${hit[0].medication.split(/\s+/)[0]} a las …" · Para borrarlo: "borrá ${hit[0].medication.split(/\s+/)[0]}"_`
        );
      }
    }

    const loaded = parseMedications(u?.currentMedications ?? null).filter(
      (m) => !rows.some((r) => normName(r.medication).includes(normName(m.name)) || normName(m.name).includes(normName(r.medication)))
    );
    const loadedBlock = loaded.length ? `\n\n📋 *Cargados en tu ficha, sin horario de aviso:* ${loaded.map((m) => m.name).join(', ')}` : '';
    if (!rows.length) {
      return (
        `💊 *No tenés medicamentos con horario registrados.*${loadedBlock}\n\n` +
        `_Para que te avise, decime por ejemplo: "Losartán 50 mg a las 8 y a las 20" o "ibuprofeno cada 8 horas"._`
      );
    }

    const upcoming = rows
      .flatMap((r) => nextDoses(r).map((at) => ({ at, label: `${r.medication}${r.dose ? ` (${r.dose})` : ''}` })))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const todayLeft = upcoming.filter((x) => dayOf(x.at) === dayOf(now));
    const active = rows.filter((r) => r.active);
    const leads = Array.from(new Set(active.map((r) => Math.max(1, r.leadMinutes || 10))));
    let nextBlock = '';
    if (todayLeft.length) {
      nextBlock =
        `\n\n⏭️ *Te falta tomar hoy:*\n` +
        todayLeft
          .slice(0, 8)
          .map((x, i) => `${i === 0 ? '👉' : '•'} ${fmtHHMM(x.at)} — ${x.label}${i === 0 ? ` _(en ${humanIn(x.at.getTime() - now.getTime())})_` : ''}`)
          .join('\n');
    } else if (upcoming.length) {
      nextBlock = `\n\n✅ Por hoy no te queda ninguna toma.\n⏭️ La próxima: *${upcoming[0].label}* — ${when(upcoming[0].at)}`;
    }
    const howBlock = active.length
      ? `\n\n🔔 Te aviso ${leads.length === 1 ? `${leadLabel(leads[0])} antes` : 'antes'} y a la hora de cada toma, por WhatsApp y notificación.`
      : '';
    if (opts.onlyNext) return (nextBlock + howBlock).trim();
    const ex = rows[0].medication.split(/\s+/)[0];
    const helpBlock =
      `\n\n✏️ *Para cambiar o borrar*, escribime o mandame un audio:\n` +
      `• _"cambiá el horario de ${ex} a las 9 y a las 21"_\n` +
      `• _"borrá el recordatorio de ${ex}"_\n` +
      `• _"pausá ${ex}"_ (deja de avisar sin borrarlo)`;
    return `💊 *Tus medicamentos con horario (${rows.length}):*\n\n${rows.map(describe).join('\n')}${nextBlock}${howBlock}${loadedBlock}${helpBlock}`;
  }

  /** Fecha local de Paraguay ("2026-09-15" + "10:00") → instante real. null si es inválida. */
  static localDateTime(dateKey: string, hhmm: string): Date | null {
    const dm = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const tm = hhmm.match(/^(\d{2}):(\d{2})$/);
    if (!dm || !tm) return null;
    const wall = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
    const out = new Date(wall - tzOffsetMs(new Date(wall), TZ()));
    return isNaN(out.getTime()) ? null : out;
  }

  /**
   * Respuesta a "¿tengo alguna cita pendiente?": TODOS los turnos que todavía no
   * pasaron (nunca uno vencido), del más cercano al más lejano, en hora de Paraguay.
   * `dateFilter`: 'today' | 'tomorrow' | 'YYYY-MM-DD' | null.
   */
  static async upcomingAppointmentsText(userId: string, dateFilter: string | null = null): Promise<string> {
    const now = new Date();
    const appts = await prisma.medicationReminder.findMany({
      where: { userId, kind: 'APPOINTMENT', whenAt: { gt: now } },
      orderBy: { whenAt: 'asc' },
      select: { medication: true, whenAt: true, leadMinutes: true, active: true },
    });
    const line = (r: (typeof appts)[number], i: number) => {
      const w = new Date(r.whenAt!);
      return (
        `*${i + 1}.* 🩺 *${r.medication}*\n` +
        `      📅 ${fmtApptDay(w, now)} · faltan ${humanIn(w.getTime() - now.getTime())}\n` +
        (r.active ? `      🔔 te aviso ${leadLabel(apptLead(r.leadMinutes))} antes` : `      🔕 aviso pausado`)
      );
    };
    if (!appts.length) {
      return (
        `✅ *No tenés citas pendientes.*\n\n` +
        `_Si querés agendar una, decime por ejemplo: "cita con el cardiólogo el jueves a las 10"._`
      );
    }
    const key =
      dateFilter === 'today'
        ? now.toLocaleDateString('en-CA', { timeZone: TZ() })
        : dateFilter === 'tomorrow'
          ? new Date(now.getTime() + 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ() })
          : dateFilter;
    if (key) {
      const sameDay = appts.filter((r) => new Date(r.whenAt!).toLocaleDateString('en-CA', { timeZone: TZ() }) === key);
      const todayKey = now.toLocaleDateString('en-CA', { timeZone: TZ() });
      const tomorrowKey = new Date(now.getTime() + 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ() });
      const dayWord = key === todayKey ? 'hoy' : key === tomorrowKey ? 'mañana' : `el ${key.split('-').reverse().slice(0, 2).join('/')}`;
      if (!sameDay.length) {
        return (
          `📅 *${dayWord.charAt(0).toUpperCase() + dayWord.slice(1)} no tenés citas.*\n\n` +
          `Tu próxima cita:\n${line(appts[0], 0)}`
        );
      }
      return `🩺 *Tus citas ${dayWord === 'hoy' || dayWord === 'mañana' ? `de ${dayWord}` : `del ${dayWord.slice(3)}`} (${sameDay.length}):*\n\n${sameDay.map(line).join('\n\n')}`;
    }
    return `🩺 *Tus citas pendientes (${appts.length}):*\n\n${appts.map(line).join('\n\n')}`;
  }

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

    // Distinguir "mañana" (día siguiente) de "de la mañana" / "por la mañana" (horario matutino).
    const tWithoutMorning = t.replace(/\b(?:de|por|en|a)\s+la\s+(?:mañana|manana)\b/g, ' ');

    if (dm) {
      d = parseInt(dm[1], 10);
      mo = parseInt(dm[2], 10);
      if (dm[3]) y = dm[3].length === 2 ? 2000 + parseInt(dm[3], 10) : parseInt(dm[3], 10);
    } else if (dName) {
      d = parseInt(dName[1], 10);
      const mi = months.findIndex((m) => dName[2].startsWith(m.slice(0, 4)));
      if (mi >= 0) mo = (mi === 10 ? 9 : mi > 10 ? mi - 1 : mi) + 1; // "setiembre" alias
    } else if (/\bhoy\b/.test(t)) {
      const p = new Date().toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
      [y, mo, d] = p;
    } else if (/\bpasado\s+(?:mañana|manana)\b/.test(tWithoutMorning)) {
      const dt = new Date();
      dt.setDate(dt.getDate() + 2);
      const p = dt.toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
      [y, mo, d] = p;
    } else if (/\b(?:mañana|manana)\b/.test(tWithoutMorning)) {
      const dt = new Date();
      dt.setDate(dt.getDate() + 1);
      const p = dt.toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
      [y, mo, d] = p;
    } else {
      const wi = weekdays.findIndex((w) => new RegExp(`\\b${w}\\b`).test(tWithoutMorning));
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
    const DATE_WORDS = /^(hoy|mañana|manana|pasado|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|el|la|a|a\s+las?)$/i;
    let note = '';

    // 1. Doctor con nombre/apellido: "con el Dr. Kodak", "con la Dra. Gomez"
    const mmDr = t.match(new RegExp(`\\b(?:con\\s+(?:el|la|mi|un[ao]?)?\\s*)?(doctor|doctora|dr|dra)\\.?\\s+([a-záéíóúñ][a-záéíóúñ .'-]{1,30}?)${STOP}`, 'i'));
    if (mmDr) {
      const who = mmDr[2].trim();
      if (!DATE_WORDS.test(who)) {
        note = `Consulta con el Dr. ${who.charAt(0).toLocaleUpperCase('es')}${who.slice(1)}`;
      }
    }

    // 2. Especialista con o sin apellido: "con el dentista", "con el cardiólogo Pérez"
    if (!note) {
      const mmSpec = t.match(new RegExp(`\\b(?:con\\s+(?:el|la|mi|un[ao]?)?\\s*)?(${SPEC})(?:\\s+([a-záéíóúñ]{2,30}))?${STOP}`, 'i'));
      if (mmSpec) {
        const spec = mmSpec[1].charAt(0).toLocaleUpperCase('es') + mmSpec[1].slice(1).toLowerCase();
        const docName = mmSpec[2] && !DATE_WORDS.test(mmSpec[2].trim()) ? mmSpec[2].trim() : '';
        note = docName ? `${spec} (${docName.charAt(0).toUpperCase() + docName.slice(1)})` : spec;
      }
    }

    // 3. Fallback genérico: "turno para control odontologico"
    if (!note) {
      const mm3 = t.match(new RegExp(`\\b(?:turno|cita|consulta|control|hora\\s+m[eé]dica)\\s+(?:m[eé]dic[ao]\\s+)?(?:con|de|para|del?)\\s+(?:el|la|mi|un[ao]?)?\\s*([a-záéíóúñ][a-záéíóúñ .'-]{2,40}?)${STOP}`, 'i'));
      if (mm3) {
        const w = mm3[1].trim();
        if (!DATE_WORDS.test(w)) note = w.charAt(0).toLocaleUpperCase('es') + w.slice(1);
      }
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
    const tWithoutMorning = t.replace(/\b(?:de|por|en|a)\s+la\s+(?:mañana|manana)\b/g, ' ');
    const enN = t.match(/\ben\s+(\d{1,3})\s*d[ií]as?\b/);
    const wIdx = weekdays.findIndex((w) => new RegExp(`\\b${w}\\b`).test(tWithoutMorning));
    const relWord = /\bhoy\b/.test(t) ? 0 : /\bpasado\s+manana\b/.test(tWithoutMorning) ? 2 : /\bmanana\b/.test(tWithoutMorning) ? 1 : null;
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
      shiftFrom(relWord);
      explicitDate = true;
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
        if (lm >= 1 && lm <= 10080) {
          draft.leadMinutes = lm;
        }
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
        // Antes solo reconocía "un/una" o dígitos — "dos minutos antes", "tres horas
        // antes" (números escritos, muy comunes al hablar) no matcheaban NADA y el
        // pedido de anticipación se perdía en silencio.
        const lm = lo.match(
          /\b(?:av[ií]sa\w*\s+(?:me\s+)?)?(?:con\s+)?(un[ao]?s?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\w+|veinte|veinti\w+|treinta|cuarenta|media|\d+(?:[.,]\d+)?)\s*(hora|horas|hs?|min|minutos?|d[ií]as?)\s*(?:antes|de\s+anticipaci[oó]n|de\s+antelaci[oó]n)?\b/i
        );
        if (lm) {
          const n = lm[1] === 'media' ? 0.5 : toNum(lm[1]);
          if (!isNaN(n)) {
            const mins = /^min/.test(lm[2]) ? Math.round(n) : /^d/.test(lm[2]) ? Math.round(n * 1440) : Math.round(n * 60);
            if (mins >= 1 && mins <= 10080) draft.leadMinutes = mins;
          }
        }
      }
    }

    // Nunca devuelve null: si no hay datos concretos, arranca un borrador vacío del
    // tipo detectado para que el diálogo guiado pregunte lo que falte.
    if (!draft.kind) draft.kind = draft.whenAt || /\b(cita|turno|consulta|hora\s+m[eé]dica)\b/i.test(raw) ? 'APPOINTMENT' : 'MED';
    if (draft.kind === 'APPOINTMENT' && (draft.leadMinutes === undefined || draft.leadMinutes === null)) {
      draft.leadMinutes = 60; // 1 hora antes por defecto
    }
    return draft;
  }

  /** ¿Qué falta preguntar para poder guardar el borrador? '' = listo para confirmar. */
  static draftNextStep(d: Partial<ReminderDraft>): '' | 'name' | 'sched' | 'last' | 'dose' | 'when' | 'lead' | 'range' {
    if (d.kind === 'APPOINTMENT') {
      if (!d.medication) return 'name';
      if (!d.whenAt) return 'when';
      if (d.leadMinutes === undefined || d.leadMinutes === null) d.leadMinutes = 60;
      // Desde/hasta cuándo avisar de esta cita. Igual que en medicación: llegada la
      // fecha final el aviso para solo.
      if (!d.rangeAsked && !d.endsAt) return 'range';
      return '';
    }
    if (!d.medication) return 'name';
    if (!d.scheduleKind || (d.scheduleKind === 'CLOCK' && !(d.times && d.times.length)) || (d.scheduleKind === 'INTERVAL' && !d.intervalHours))
      return 'sched';
    if (d.scheduleKind === 'INTERVAL' && !d.anchorAt) return 'last';
    if (d.dose === undefined) return 'dose';
    // Vigencia (desde / hasta). Si el texto ya traía la duración ("por 7 días") no
    // se vuelve a preguntar. Sin fecha de fin el aviso seguiría para siempre, que
    // es justo lo que la gente reclama de un tratamiento que ya terminó.
    if (!d.rangeAsked && !d.endsAt) return 'range';
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
      const dayA = (v: string) => new Date(v).toLocaleDateString('es-PY', { timeZone: TZ(), day: '2-digit', month: '2-digit', year: 'numeric' });
      const vig =
        d.startsAt && d.endsAt
          ? `\n📆 avisos del ${dayA(d.startsAt)} al ${dayA(d.endsAt)}`
          : d.endsAt
            ? `\n📆 avisos hasta el ${dayA(d.endsAt)} (después para solo)`
            : d.startsAt
              ? `\n📆 avisos desde el ${dayA(d.startsAt)}`
              : `\n📆 avisos hasta el día del turno (después para solo)`;
      return `🩺 *${this.cap(d.medication || 'Consulta médica')}*\n📅 ${when}${lead}${vig}`;
    }
    const dose = d.dose ? ` (${d.dose})` : '';
    const day = (v: string) => new Date(v).toLocaleDateString('es-PY', { timeZone: TZ(), day: '2-digit', month: '2-digit', year: 'numeric' });
    const until =
      d.startsAt && d.endsAt
        ? `\n📆 del ${day(d.startsAt)} al ${day(d.endsAt)} (después se desactiva solo)`
        : d.endsAt
          ? `\n📆 hasta el ${day(d.endsAt)} (después se desactiva solo)`
          : d.startsAt
            ? `\n📆 desde el ${day(d.startsAt)} (sin fecha de fin)`
            : `\n📆 sin fecha de fin (avisa hasta que lo pares o lo borres)`;
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
      const leadMinutes = d.leadMinutes ?? 60; // sin preferencia del usuario → 60 min (1 hora) por defecto
      const created = await prisma.medicationReminder.create({
        data: {
          userId,
          kind: 'APPOINTMENT',
          medication: this.cap((d.medication || 'Consulta médica').slice(0, 120)),
          whenAt: d.whenAt ? new Date(d.whenAt) : null,
          times: '[]',
          leadMinutes,
          // Segundo aviso automático 10 min antes, además del principal — salvo que
          // el principal YA sea de 10 min (no mandar el mismo aviso dos veces).
          secondLeadMinutes: leadMinutes > 10 ? 10 : null,
          startsAt: d.startsAt && !isNaN(new Date(d.startsAt).getTime()) ? new Date(d.startsAt) : null,
          endsAt: d.endsAt && !isNaN(new Date(d.endsAt).getTime()) ? new Date(d.endsAt) : null,
        },
      });
      if (created.whenAt) {
        const dtLocal = fmtDateTime(new Date(created.whenAt));
        PushService.notify(
          userId,
          '📅 Cita médica agendada',
          `Tu turno para "${created.medication}" quedó agendado para el ${dtLocal}. Te avisaremos con anticipación.`,
          { tag: `reminder-created-${created.id}`, url: '/dashboard' }
        );
      }
      return created;
    }
    const scheduleKind = d.scheduleKind === 'INTERVAL' ? 'INTERVAL' : 'CLOCK';
    const data: any = {
      userId,
      kind: 'MED',
      scheduleKind,
      medication: this.cap((d.medication || 'Medicación').slice(0, 80)),
      dose: d.dose ? String(d.dose).slice(0, 60) : null,
      leadMinutes: d.leadMinutes ?? 10,
      startsAt: d.startsAt && !isNaN(new Date(d.startsAt).getTime()) ? new Date(d.startsAt) : null,
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
    const created = await prisma.medicationReminder.create({ data });
    PushService.notify(
      userId,
      '⏰ Recordatorio activado',
      `Recordatorio para "${created.medication}" activado. Te avisaremos en cada toma programada.`,
      { tag: `reminder-created-${created.id}`, url: '/dashboard' }
    );
    return created;
  }

  /**
   * Aplica una edición de UN campo (o varios) sobre un recordatorio YA EXISTENTE
   * — mismo `data` que createFromDraft, pero con `update` en vez de `create`.
   * Resetea `lastSentSlot`/`lastSentAt` (si cambió el horario/fecha, el dedupe
   * viejo no debe bloquear el próximo aviso) y reactiva el recordatorio —
   * editar algo implica que se lo quiere volver a recibir.
   */
  static async updateFromDraft(id: string, d: Partial<ReminderDraft>) {
    if (d.kind === 'APPOINTMENT') {
      const leadMinutes = d.leadMinutes ?? 60; // 60 min (1 hora) por defecto
      return prisma.medicationReminder.update({
        where: { id },
        data: {
          medication: this.cap((d.medication || 'Consulta médica').slice(0, 120)),
          whenAt: d.whenAt ? new Date(d.whenAt) : null,
          leadMinutes,
          secondLeadMinutes: leadMinutes > 10 ? 10 : null,
          startsAt: d.startsAt && !isNaN(new Date(d.startsAt).getTime()) ? new Date(d.startsAt) : null,
          endsAt: d.endsAt && !isNaN(new Date(d.endsAt).getTime()) ? new Date(d.endsAt) : null,
          active: true,
          lastSentAt: null,
          lastSentSlot: null,
        },
      });
    }
    const scheduleKind = d.scheduleKind === 'INTERVAL' ? 'INTERVAL' : 'CLOCK';
    const data: any = {
      scheduleKind,
      medication: this.cap((d.medication || 'Medicación').slice(0, 80)),
      dose: d.dose ? String(d.dose).slice(0, 60) : null,
      leadMinutes: d.leadMinutes ?? 10,
      startsAt: d.startsAt && !isNaN(new Date(d.startsAt).getTime()) ? new Date(d.startsAt) : null,
      endsAt: d.endsAt && !isNaN(new Date(d.endsAt).getTime()) ? new Date(d.endsAt) : null,
      active: true,
      lastSentAt: null,
      lastSentSlot: null,
    };
    if (scheduleKind === 'INTERVAL') {
      const anchor = d.anchorAt ? new Date(d.anchorAt) : new Date();
      data.intervalHours = d.intervalHours || 8;
      data.anchorAt = anchor;
      data.nextDoseAt = this.computeNextDose(anchor, data.intervalHours);
      data.times = '[]';
    } else {
      data.times = JSON.stringify(d.times && d.times.length ? d.times : ['08:00']);
      data.intervalHours = null;
      data.anchorAt = null;
      data.nextDoseAt = null;
    }
    return prisma.medicationReminder.update({ where: { id }, data });
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
      startsAt?: Date | null;
      endsAt?: Date | null;
      active: boolean;
    }>
  ): string {
    if (!rows.length) return '';
    return rows
      .map((r, i) => {
        const state = r.active ? '' : ' _(pausado)_';
        const dayShort = (v: Date) => new Date(v).toLocaleDateString('es-PY', { timeZone: TZ(), day: '2-digit', month: '2-digit' });
        const pend = (r as any).startsAt && new Date((r as any).startsAt).getTime() > Date.now();
        const until =
          (pend ? ` · empieza ${dayShort((r as any).startsAt)}` : '') +
          (r.endsAt ? ` · hasta ${dayShort(r.endsAt)}` : '');
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
      // "Sí, quiero agendar una cita..." — el "sí" de arranque (muy natural en audio)
      // tapaba el verbo real que viene después: isRegistrationVerb exige que el
      // verbo de pedido sea la PRIMERA palabra, así que "sí, quiero..." no
      // calificaba como pedido de creación y terminaba leyéndose como consulta.
      .replace(/^\s*(si|s[ií]|bueno|dale|ok|okay|a ver|mira|mire|perfecto)[,.\s]+/, '')
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
      // Estrictamente en el futuro — un turno que ya pasó no es "tu próximo turno"
      // aunque haya sido hace 5 minutos (antes toleraba hasta 1 hora de margen,
      // lo que hacía decir "tu próximo turno" de algo que ya había pasado hacía rato).
      const dayFilter = /\bpasado\s+manana\b/.test(t) ? null : /\bhoy\b/.test(t) ? 'today' : /\bmanana\b/.test(t) && !/\bde\s+la\s+manana\b/.test(t) ? 'tomorrow' : null;
      return this.upcomingAppointmentsText(userId, dayFilter);
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
   * Tick del CRON (cada 1 min): dispara los recordatorios cuya hora cae en la ventana
   * y que no se enviaron ya en ese slot. Si el bot de WhatsApp está desconectado, no
   * hace nada (los recordatorios no avanzan → se reintentan en el próximo tick).
   */
  static async tick(): Promise<number> {
    // WhatsApp caído NO frena los avisos: la notificación push sale igual. Antes el
    // tick cortaba acá y no avisaba por NINGÚN canal mientras el bot estaba offline.
    const waUp = whatsappBot.getStatus().connected;
    const { minutes: nowMin, date } = nowLocal();
    const nowMs = Date.now();
    let sent = 0;

    /** Manda por WhatsApp y push en paralelo. true = le llegó por al menos un canal. */
    const deliver = async (
      userId: string,
      target: string,
      waText: string,
      push: { title: string; body: string; opts: Parameters<typeof PushService.notify>[3] }
    ): Promise<boolean> => {
      const [pushed, wa] = await Promise.all([
        Promise.resolve(PushService.notify(userId, push.title, push.body, push.opts)).then((n) => n || 0, () => 0),
        waUp ? whatsappBot.sendMessage(target, waText) : Promise.resolve(false),
      ]);
      if (!wa && pushed) console.warn(`⏰ [CRON] WhatsApp no disponible — aviso entregado solo por push (${push.title})`);
      return wa || pushed > 0;
    };

    const reminders = await prisma.medicationReminder.findMany({
      where: { active: true },
      include: { user: { select: { id: true, phoneNumber: true, whatsappJid: true, status: true, language: true } } },
    });

    for (const r of reminders) {
      if (!r.user || (r.user.status !== 'ACTIVE' && r.user.status !== 'EXPIRED')) continue;

      // Todavía no arrancó ("desde el 01/10"): no se avisa nada hasta esa fecha.
      // El recordatorio queda guardado y activo, simplemente duerme.
      if (r.startsAt && nowMs < new Date(r.startsAt).getTime()) continue;

      // Fin de la vigencia ("por 3 días" / "hasta el 30/04") → se desactiva solo,
      // con un aviso de cierre. Vale igual para medicación y para citas/turnos:
      // llegada la fecha final, el aviso PARA, que es justo lo que se pidió.
      if (r.endsAt && nowMs > new Date(r.endsAt).getTime()) {
        const gnEnd = r.user.language === 'GN';
        const esCita = r.kind === 'APPOINTMENT';
        if (r.lastSentSlot !== 'ENDED') {
          const msg = gnEnd
            ? `✅ *${r.medication}* — opa. Ndorohechavéima momandu'a.`
            : esCita
              ? `✅ Llegó la fecha final de los avisos de *${r.medication}*. No te aviso más por esta cita. _Si la seguís necesitando, escribí *6* y cargala de nuevo._`
              : `✅ Terminó el tratamiento de *${r.medication}*. No te aviso más por este. _Si seguís tomándolo, escribí *5* y cargalo de nuevo._`;
          if (await deliver(r.user.id, r.user.whatsappJid || r.user.phoneNumber, msg, { title: esCita ? '✅ Avisos terminados' : '✅ Tratamiento terminado', body: msg, opts: { tag: `reminder-${r.id}` } })) {
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
        // Avisos ya mandados de este turno, acumulados ("D-1,LEAD,LEAD2"). Antes se
        // guardaba UNO solo y cada aviso pisaba al otro: con aviso principal (1 h) +
        // segundo aviso (10 min), a partir de los 10 min antes el tick los mandaba
        // alternados CADA MINUTO hasta la hora del turno (visto en producción el
        // 14/09: 13 mensajes "Faltan 1 hora" / "Faltan 10 min" seguidos).
        const sentTags = new Set((r.lastSentSlot || '').split(',').filter(Boolean));
        const markSent = (...tags: string[]) => {
          tags.forEach((x) => sentTags.add(x));
          return prisma.medicationReminder.update({
            where: { id: r.id },
            data: { lastSentAt: new Date(), lastSentSlot: Array.from(sentTags).join(','), active: whenMs > nowMs },
          });
        };
        const untilAppt = whenMs - nowMs;
        const inGrace = untilAppt > -15 * 60_000;
        const lead2 = r.secondLeadMinutes && r.secondLeadMinutes < lead ? r.secondLeadMinutes : null;
        // "Faltan" = lo que falta DE VERDAD (si el turno se cargó tarde o el bot
        // estuvo desconectado, no decir "falta 1 hora" cuando faltan 5 minutos).
        const faltan = untilAppt > 60_000 ? humanIn(untilAppt) : 'ya es la hora';

        // Cortesía 24 h antes (salvo que el aviso pedido ya sea de ~1 día).
        if (lead < 1200 && !sentTags.has('D-1') && !sentTags.has('LEAD') && !sentTags.has('LEAD2') && untilAppt <= 24 * 3600_000 && untilAppt > 24 * 3600_000 - 6 * 60_000) {
          const msg = gn
            ? `📅 *Momandu'a: turno* ko'ẽrõ\n\n🩺 *${r.medication}*\n🕒 ${dtLocal}\n\n_Ehecha nde pasaporte médico bio-pass.cnid.com.py_`
            : `📅 *Recordatorio: Turno médico mañana*\n\n🩺 *${r.medication}*\n🕒 *Fecha y hora:* ${dtLocal}\n\n_Tené a mano tus estudios y recetas en Bio-Pass._`;
          if (
            await deliver(r.user.id, target, msg, {
              title: '📅 Turno médico mañana',
              body: `🩺 ${r.medication} · 🕒 ${dtLocal}. Abrí tu pasaporte Bio-Pass.`,
              opts: { tag: `reminder-${r.id}`, url: '/dashboard', requireInteraction: true },
            })
          ) {
            await markSent('D-1');
            sent++;
          }
          continue;
        }
        // Tolerancia de 30 s (el tick corre cada minuto): el aviso sale a la hora
        // pedida, no 2–3 minutos antes.
        const mainDue = untilAppt - lead * 60_000 <= 30_000 && inGrace;
        const secondDue = !!lead2 && untilAppt - lead2 * 60_000 <= 30_000 && inGrace;
        // Aviso principal: `leadMinutes` antes (con tolerancia hasta la hora del turno).
        // Si para cuando sale ya tocaba también el segundo aviso, va UN solo mensaje.
        if (!sentTags.has('LEAD') && !sentTags.has('LEAD2') && mainDue) {
          const msg = gn
            ? `📅 *Turno* — *${r.medication}*\n🕒 ${dtLocal}\n\n_${faltan}._`
            : `📅 *Recordatorio de tu turno médico*\n\n🩺 *${r.medication}*\n🕒 *Cuándo:* ${fmtApptDay(new Date(r.whenAt))}\n⏱️ *Faltan:* ${faltan}. No faltes.\n\n_Tu médico puede escanear tu QR para ver tus antecedentes._`;
          if (
            await deliver(r.user.id, target, msg, {
              title: `📅 Tu turno médico (faltan ${faltan})`,
              body: `🩺 ${r.medication} · 🕒 ${dtLocal}. Abrí tu ficha médica.`,
              opts: { tag: `reminder-${r.id}`, url: '/dashboard', requireInteraction: true },
            })
          ) {
            await (secondDue ? markSent('LEAD', 'LEAD2') : markSent('LEAD'));
            sent++;
          }
        }
        // Segundo aviso automático (ej. 10 min antes), además del principal — mismo
        // registro, otro offset (`secondLeadMinutes`, ver createFromDraft). Una sola vez.
        else if (lead2 && !sentTags.has('LEAD2') && secondDue) {
          const msg2 = gn
            ? `📅 *Momandu'a: turno*\n\n*${r.medication}*\n🕒 ${dtLocal}`
            : `📅 *Tu turno está por empezar*\n\n🩺 *${r.medication}*\n🕒 ${fmtApptDay(new Date(r.whenAt))}\n\n_Faltan ${faltan}. No faltes._`;
          if (await deliver(r.user.id, target, msg2, { title: '📅 Tu turno médico', body: msg2, opts: { tag: `reminder-${r.id}-2`, url: '/dashboard', requireInteraction: true } })) {
            await markSent('LEAD', 'LEAD2');
            sent++;
          }
        }
        // Se desactiva a los 20 min de pasado (poco más que la ventana de gracia de
        // 15 min del aviso principal, arriba) — antes eran 60 min, y quedaba mostrándose
        // "activo" en la lista mucho después de haber pasado de verdad.
        if (whenMs < nowMs - 20 * 60_000) {
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

        // Pre-aviso `leadMinutes` antes (a la hora pedida, no 2–3 min antes).
        if (r.lastSentSlot !== preTag && r.lastSentSlot !== dueTag) {
          const untilPre = nd - nowMs - lead * 60_000;
          if (untilPre <= 30_000 && untilPre > -180_000 && nd - nowMs > 60_000) {
            const msg = gn
              ? `⏰ *Momandu'a: ${leadLabel(lead)} rupi*\n\n*${r.medication}*${r.dose ? ` (${r.dose})` : ''} — ${fmtHHMM(new Date(nd))}.`
              : `⏰ *En ${leadLabel(lead)} toca tu medicación*\n\n*${r.medication}*${r.dose ? ` (${r.dose})` : ''} a las ${fmtHHMM(new Date(nd))}.`;
            if (await deliver(r.user.id, target, msg, { title: '⏰ Se acerca tu medicación', body: msg, opts: { tag: `reminder-${r.id}`, url: '/dashboard' } })) {
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
            if (await deliver(r.user.id, target, msg, { title: '⏰ Hora de tu medicación', body: msg, opts: { tag: `reminder-${r.id}`, url: '/dashboard', requireInteraction: true } })) {
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
      // Avisos YA mandados HOY de este recordatorio: "2026-09-14#PRE:08:00,08:00,PRE:20:00".
      // Antes se guardaba uno solo y el siguiente lo pisaba: con dos horarios cercanos
      // (ej. 20:00 y 20:15) el pre-aviso del segundo borraba la marca del primero y el
      // "es hora de tomar" de las 20:00 se volvía a mandar.
      const dayTags = (() => {
        const raw = r.lastSentSlot || '';
        const [d, list] = raw.split('#');
        if (d === date && list !== undefined) return new Set(list.split(',').filter(Boolean));
        const legacy = raw.match(/^(PRE10:)?(\d{2}:\d{2})\|(\d{4}-\d{2}-\d{2})$/); // formato viejo "08:00|2026-09-14"
        if (legacy && legacy[3] === date) return new Set([legacy[1] ? `PRE:${legacy[2]}` : legacy[2]]);
        return new Set<string>();
      })();
      const markDay = (tag: string) => {
        dayTags.add(tag);
        return prisma.medicationReminder.update({
          where: { id: r.id },
          data: { lastSentAt: new Date(), lastSentSlot: `${date}#${Array.from(dayTags).join(',')}` },
        });
      };

      for (const slot of slots) {
        const [sh, sm] = slot.split(':').map(Number);
        if (Number.isNaN(sh) || Number.isNaN(sm)) continue;
        const slotMin = sh * 60 + sm;

        // Pre-aviso `leadMinutes` antes — sale a la hora justa (tolera 3 min de atraso
        // del tick). Antes la ventana arrancaba 3 min ANTES: con el tick de cada minuto
        // "En 10 minutos toca tu medicación" llegaba 13 minutos antes.
        const toLead = slotMin - nowMin;
        const preTag = `PRE:${slot}`;
        const mainTag = slot;
        if (toLead > 0 && toLead <= lead && toLead >= lead - 3 && !dayTags.has(preTag) && !dayTags.has(mainTag)) {
          const preMsg = gn
            ? `⏰ *Momandu'a: ${leadLabel(lead)} rupi*\n\n*${r.medication}*${r.dose ? ` (${r.dose})` : ''} — ${slot}.`
            : `⏰ *En ${leadLabel(toLead)} toca tu medicación*\n\n*${r.medication}*${r.dose ? ` (${r.dose})` : ''} a las ${slot}.\n\n_Preparala con tiempo._`;
          if (await deliver(r.user.id, target, preMsg, { title: '⏰ Se acerca tu medicación', body: preMsg, opts: { tag: `reminder-${r.id}`, url: '/dashboard' } })) {
            await markDay(preTag);
            sent++;
          }
          continue;
        }

        // Aviso a la hora — ventana [0, 30] min (tolera que el bot haya estado caído).
        const diff = nowMin - slotMin;
        if (diff < 0 || diff > 30 || dayTags.has(mainTag)) continue;

        const msg = gn
          ? `⏰ *Momandu'a pohã*\n\nHi'ára reipuru hag̃ua *${r.medication}*${r.dose ? ` (${r.dose})` : ''}.\n\n_Ehai *MENU* rehecha hag̃ua opciones._`
          : `⏰ *Recordatorio de medicación*\n\nEs hora de tomar *${r.medication}*${r.dose ? ` (${r.dose})` : ''}${diff > 2 ? ` (era a las ${slot})` : ''}.\n\n_Cuidá tu salud. Escribí *MENU* para ver tus opciones._`;
        if (await deliver(r.user.id, target, msg, { title: '⏰ Hora de tu medicación', body: msg, opts: { tag: `reminder-${r.id}`, url: '/dashboard', requireInteraction: true } })) {
          await markDay(mainTag);
          sent++;
        }
      }
    }
    if (sent) console.log(`⏰ [CRON] ${sent} recordatorio(s) de medicación enviado(s).`);
    return sent;
  }
}
