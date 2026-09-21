/**
 * Rangos de fechas escritos por una persona, en el chat.
 *
 * Se usa en el submenú de descargas ("de 05 de enero de 2021 a 30 de abril de
 * 2021") y en el alta de recordatorios ("desde hoy hasta el 30/10"). Devuelve
 * los extremos como números `yyyymmdd` a propósito: los documentos guardan la
 * fecha como medianoche UTC cuando se cargaron desde la web y como un instante
 * real cuando vinieron del bot, así que comparar por día calendario evita que
 * un estudio del 5 de enero caiga fuera de un rango "5 de enero a ..." por tres
 * horas de diferencia horaria.
 */
import { config } from '../config';

export interface DateRange {
  /** yyyymmdd inclusive, o null = sin límite hacia atrás */
  fromYmd: number | null;
  /** yyyymmdd inclusive, o null = sin límite hacia adelante */
  toYmd: number | null;
  /** Cómo mostrárselo a la persona ("del 05/01/2021 al 30/04/2021"). */
  label: string;
}

export const ALL_DATES: DateRange = { fromYmd: null, toYmd: null, label: 'todas las fechas' };

const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, janeiro: 1, jan: 1, january: 1,
  febrero: 2, feb: 2, fevereiro: 2, fev: 2, february: 2,
  marzo: 3, mar: 3, marco: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5, maio: 5, mai: 5,
  junio: 6, jun: 6, junho: 6, june: 6,
  julio: 7, jul: 7, julho: 7, july: 7,
  agosto: 8, ago: 8, aug: 8, august: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9, setembro: 9, september: 9,
  octubre: 10, oct: 10, outubro: 10, out: 10, october: 10,
  noviembre: 11, nov: 11, novembro: 11, november: 11,
  diciembre: 12, dic: 12, dezembro: 12, dez: 12, december: 12,
};

const clean = (s: string): string =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/.\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const TZ = () => config.timezone || 'America/Asuncion';

/** Y/M/D de una fecha en Paraguay; si el valor es medianoche UTC exacta se toma como "día suelto". */
export function ymdOf(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return null;
  const dateOnly = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: dateOnly ? 'UTC' : TZ(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return Number(parts.replace(/-/g, ''));
}

/** Hoy en Paraguay, como yyyymmdd. */
export function todayYmd(now = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replace(/-/g, ''));
}

const toYmd = (y: number, m: number, d: number) => y * 10000 + m * 100 + d;
const ymdParts = (v: number) => ({ y: Math.floor(v / 10000), m: Math.floor(v / 100) % 100, d: v % 100 });
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Suma días a un yyyymmdd (acepta negativos). */
export function addDaysYmd(v: number, days: number): number {
  const { y, m, d } = ymdParts(v);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return toYmd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Suma meses a un yyyymmdd, recortando el día si el mes destino es más corto. */
function addMonthsYmd(v: number, months: number): number {
  const { y, m, d } = ymdParts(v);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toYmd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function isValidYmd(v: number): boolean {
  const { y, m, d } = ymdParts(v);
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** yyyymmdd → "05/01/2021" */
export function formatYmd(v: number): string {
  const { y, m, d } = ymdParts(v);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/**
 * Cuánto hay que sumarle a una hora local "escrita como si fuera UTC" para obtener
 * el instante real. En Paraguay (UTC-3) da +3 h.
 */
function tzOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ(),
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value || 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return at.getTime() - asUtc;
}

/**
 * yyyymmdd → instante real del principio (o del final) de ESE día en Paraguay.
 * Guardar la medianoche UTC a secas hacía que un recordatorio "desde el 01/10"
 * empezara a avisar a las 21:00 del 30/09, hora local.
 */
export function ymdToDate(v: number, endOfDay = false): Date {
  const { y, m, d } = ymdParts(v);
  const guess = Date.UTC(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return new Date(guess + tzOffsetMs(new Date(guess)));
}

function labelFor(from: number | null, to: number | null): string {
  if (from && to) return from === to ? `el ${formatYmd(from)}` : `del ${formatYmd(from)} al ${formatYmd(to)}`;
  if (from) return `desde el ${formatYmd(from)}`;
  if (to) return `hasta el ${formatYmd(to)}`;
  return ALL_DATES.label;
}

const make = (from: number | null, to: number | null): DateRange => {
  // "del 30/04 al 05/01" → se da vuelta sin preguntar; el orden no cambia la intención.
  if (from && to && from > to) [from, to] = [to, from];
  return { fromYmd: from, toYmd: to, label: labelFor(from, to) };
};

/**
 * Una fecha suelta dentro de un texto ya normalizado. Acepta 05/01/2021,
 * 5-1-21, 05.01.2021, "5 de enero de 2021", "enero 2021" (día 1 o último según
 * `edge`) y "05/01" (año en curso).
 */
function parseOneDate(raw: string, now: number, edge: 'start' | 'end'): number | null {
  const t = clean(raw);
  if (!t) return null;
  if (/^(hoy|today)$/.test(t)) return now;
  if (/^(ayer|ontem|yesterday)$/.test(t)) return addDaysYmd(now, -1);
  if (/^(manana|amanha|tomorrow)$/.test(t)) return addDaysYmd(now, 1);

  let m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    const v = toYmd(y, Number(m[2]), Number(m[1]));
    return isValidYmd(v) ? v : null;
  }
  m = t.match(/^(\d{1,2})[/.\-](\d{1,2})$/);
  if (m) {
    const v = toYmd(ymdParts(now).y, Number(m[2]), Number(m[1]));
    return isValidYmd(v) ? v : null;
  }
  // "5 de enero de 2021" · "5 enero 2021" · "5 de enero"
  m = t.match(/^(\d{1,2})\s*(?:de\s+)?([a-z]+)(?:\s*(?:de|del)?\s*(\d{4}))?$/);
  if (m && MONTHS[m[2]]) {
    const y = m[3] ? Number(m[3]) : ymdParts(now).y;
    const v = toYmd(y, MONTHS[m[2]], Number(m[1]));
    return isValidYmd(v) ? v : null;
  }
  // "enero de 2021" · "enero 2021" · "enero" → mes entero
  m = t.match(/^([a-z]+)(?:\s*(?:de|del)?\s*(\d{4}))?$/);
  if (m && MONTHS[m[1]]) {
    const mo = MONTHS[m[1]];
    const y = m[2] ? Number(m[2]) : ymdParts(now).y;
    return edge === 'start' ? toYmd(y, mo, 1) : toYmd(y, mo, daysInMonth(y, mo));
  }
  // "2021" → año entero
  m = t.match(/^(\d{4})$/);
  if (m) {
    const y = Number(m[1]);
    if (y >= 1900 && y <= 2200) return edge === 'start' ? toYmd(y, 1, 1) : toYmd(y, 12, 31);
  }
  return null;
}

/**
 * Interpreta lo que la persona escribió como rango. Devuelve null si no se
 * entiende (el bot vuelve a preguntar en vez de bajar cualquier cosa).
 */
export function parseDateRange(input: string, nowDate = new Date()): DateRange | null {
  const t = clean(input);
  if (!t) return null;
  const now = todayYmd(nowDate);

  if (/^(todo|todos|toda|todas|tudo|all|siempre|sempre|completo|completa|sin limite|sin fecha|sin fechas|cualquier fecha|todas las fechas|desde siempre|historico|todo el historial)\b/.test(t)) {
    return { ...ALL_DATES };
  }

  // "últimos 3 meses" · "último mes" · "últimas 2 semanas" · "últimos 30 días" · "último año"
  let m = t.match(/\bultim[oa]s?\s*(\d{1,3})?\s*(dias?|semanas?|meses|mes|anos?|ano)\b/);
  if (m) {
    const n = m[1] ? Number(m[1]) : 1;
    const unit = m[2];
    if (/^dia/.test(unit)) return make(addDaysYmd(now, -(n - 1)), now);
    if (/^semana/.test(unit)) return make(addDaysYmd(now, -(n * 7 - 1)), now);
    if (/^(mes|meses)$/.test(unit)) return make(addMonthsYmd(now, -n), now);
    return make(addMonthsYmd(now, -12 * n), now);
  }
  if (/\beste\s+mes\b|\bmes\s+actual\b/.test(t)) {
    const { y, m: mo } = ymdParts(now);
    return make(toYmd(y, mo, 1), toYmd(y, mo, daysInMonth(y, mo)));
  }
  if (/\bmes\s+pasado\b|\bmes\s+anterior\b/.test(t)) {
    const p = addMonthsYmd(toYmd(ymdParts(now).y, ymdParts(now).m, 1), -1);
    const { y, m: mo } = ymdParts(p);
    return make(toYmd(y, mo, 1), toYmd(y, mo, daysInMonth(y, mo)));
  }
  if (/\beste\s+(ano|year)\b|\bano\s+actual\b/.test(t)) {
    const { y } = ymdParts(now);
    return make(toYmd(y, 1, 1), toYmd(y, 12, 31));
  }
  if (/\bano\s+pasado\b|\bano\s+anterior\b/.test(t)) {
    const y = ymdParts(now).y - 1;
    return make(toYmd(y, 1, 1), toYmd(y, 12, 31));
  }
  if (/^(hoy|today)$/.test(t)) return make(now, now);
  if (/^(ayer|ontem|yesterday)$/.test(t)) return make(addDaysYmd(now, -1), addDaysYmd(now, -1));
  if (/\besta\s+semana\b/.test(t)) return make(addDaysYmd(now, -6), now);

  // "de X a Y" / "X al Y" / "X hasta Y" / "X - Y" / "entre X y Y".
  // Se prueban TODOS los cortes posibles y gana el primero que deje fechas válidas
  // de los dos lados: en "01-10-2026 hasta 31-10-2026" el primer guion es parte de
  // la fecha, no el separador, y cortar ahí devolvía "no entendí".
  const body = t
    .replace(/^(?:descargar|bajar|quiero|necesito|dame|mandame|entre)\s+/g, '')
    .replace(/^(?:desde|del|de|a partir del?|a partir de)\s+/, '');
  const sepRe = /\s(?:a|al|hasta|hata|ate|até|y|to)\s|\s*—\s*|\s+-\s+|-/g;
  for (let m2 = sepRe.exec(body); m2; m2 = sepRe.exec(body)) {
    const left = body.slice(0, m2.index).trim();
    const right = body.slice(m2.index + m2[0].length).trim();
    if (!left || !right) continue;
    const a = parseOneDate(left.replace(/^(?:desde|del|de)\s+/, ''), now, 'start');
    const b = parseOneDate(right.replace(/^(?:hasta|al|el|a)\s+/, ''), now, 'end');
    if (a && b) return make(a, b);
  }

  // "desde el 05/01/2021" (abierto hacia adelante) · "hasta el 30/04/2021"
  m = t.match(/^(?:desde|a partir del?|a partir de|del?)\s+(.+)$/);
  if (m) {
    const a = parseOneDate(m[1].replace(/^el\s+/, ''), now, 'start');
    if (a) return make(a, null);
  }
  m = t.match(/^(?:hasta|ate|até)\s+(?:el\s+)?(.+)$/);
  if (m) {
    const b = parseOneDate(m[1], now, 'end');
    if (b) return make(null, b);
  }

  // Una sola fecha: ese día (o ese mes / ese año si lo escribió así).
  const start = parseOneDate(t.replace(/^(?:el|en)\s+/, ''), now, 'start');
  const end = parseOneDate(t.replace(/^(?:el|en)\s+/, ''), now, 'end');
  if (start && end) return make(start, end);
  return null;
}

/** ¿La fecha del documento cae dentro del rango? Sin fecha = se incluye siempre. */
export function inRange(d: Date | string | null | undefined, range: DateRange): boolean {
  if (!range.fromYmd && !range.toYmd) return true;
  const v = ymdOf(d);
  if (v == null) return true;
  if (range.fromYmd && v < range.fromYmd) return false;
  if (range.toYmd && v > range.toYmd) return false;
  return true;
}
