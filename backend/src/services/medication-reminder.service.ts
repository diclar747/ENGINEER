import { prisma } from '../database/prisma';
import { whatsappBot } from '../whatsapp/baileys.client';
import { config } from '../config';

export interface ParsedReminder {
  medication: string;
  dose?: string;
  times: string[]; // "HH:MM" 24h
}

const DOSE_RE = /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|g|ml|ui|u|%|comp|caps?|gotas?)\b/i;

/** Extrae horarios de un texto: "08:00", "8", "8hs", "8 am", "20:30", "a las 9". */
function extractTimes(text: string): string[] {
  const out = new Set<string>();
  const t = text.toLowerCase();

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
  // "8hs" / "20 h" / "a las 9" / "cada 8 horas" NO (esa es frecuencia, no hora puntual)
  for (const m of t.matchAll(/\b(?:a\s+las\s+)?(\d{1,2})\s*(?:h|hs|hrs|horas)\b/g)) {
    const h = parseInt(m[1], 10);
    const idx = m.index ?? 0;
    if (/cada\s*$/.test(t.slice(Math.max(0, idx - 6), idx))) continue;
    if (h >= 0 && h <= 23) out.add(`${String(h).padStart(2, '0')}:00`);
  }

  // Números sueltos 0-23 unidos por "y"/","/"a las" cuando YA hay al menos un
  // horario claro ("9 y 21hs", "a las 8, 14 y 22"). Se ignoran los que van
  // pegados a una unidad de dosis (mg, ml…).
  if (out.size > 0) {
    for (const m of t.matchAll(/(^|[\s,(]|(?:a\s+las\s+)|y\s+)(\d{1,2})(?=$|[\s,)]|y\b)/g)) {
      const idx = (m.index ?? 0) + m[1].length;
      const after = t.slice(idx + m[2].length, idx + m[2].length + 5);
      if (/^\s*(mg|mcg|µg|g|ml|ui|u\b|%|comp|caps?|gota)/i.test(after)) continue;
      const h = parseInt(m[2], 10);
      if (h >= 0 && h <= 23) out.add(`${String(h).padStart(2, '0')}:00`);
    }
  }
  return Array.from(out).sort();
}

export class MedicationReminderService {
  /**
   * Parsea "Losartán 50 mg 08:00 y 20:00" → { medication, dose, times }.
   * Devuelve null si no logra un nombre + al menos un horario.
   */
  static parse(text: string): ParsedReminder | null {
    if (!text || !text.trim()) return null;
    const raw = text.trim();
    const times = extractTimes(raw);
    if (!times.length) return null;

    const dose = raw.match(DOSE_RE)?.[0]?.replace(/\s+/g, ' ').trim();

    let name = raw
      .replace(/\b([01]?\d|2[0-3])[:.][0-5]\d\b/g, ' ')
      .replace(/\b\d{1,2}(?::[0-5]\d)?\s*(a\.?m\.?|p\.?m\.?)\b/gi, ' ')
      .replace(/\b(?:a\s+las\s+)?\d{1,2}\s*(?:h|hs|hrs|horas)\b/gi, ' ');
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
    if (!/\b(turno|cita|consulta|hora m[eé]dica|control m[eé]dico|cita m[eé]dica|appointment)\b/.test(t)) return null;

    const times = extractTimes(text);
    if (!times.length) return null;
    const [hh, mm] = times[0].split(':').map(Number);

    const tz = config.timezone || 'America/Asuncion';
    const nowParts = new Date().toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
    let y = nowParts[0];
    let mo = nowParts[1];
    let d = nowParts[2];

    const dm = t.match(/\b([0-3]?\d)[\/.\-]([01]?\d)(?:[\/.\-](\d{2,4}))?\b/);
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
    const dName = t.match(/\b(\d{1,2})\s+de\s+([a-záéíóú]+)/);
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

    let note = text
      .replace(/\b(recorda(?:r|torio|me)?|recu[eé]rdame|el|la|los|las|a\s+las?|de|para|mi|un[a]?)\b/gi, ' ')
      .replace(/\b[0-3]?\d[\/.\-][01]?\d(?:[\/.\-]\d{2,4})?\b/g, ' ')
      .replace(/\b\d{1,2}(?::[0-5]\d)?\s*(a\.?m\.?|p\.?m\.?|h|hs|hrs|horas)?\b/gi, ' ')
      .replace(/\b(mañana|pasado|hoy|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (note.length < 3) note = 'Consulta médica';

    return { note: note.slice(0, 120), whenAt };
  }

  /** Lista legible de recordatorios para WhatsApp. */
  static format(
    rows: Array<{ kind?: string; medication: string; dose: string | null; times: string; whenAt?: Date | null; active: boolean }>
  ): string {
    if (!rows.length) return '';
    return rows
      .map((r, i) => {
        const state = r.active ? '' : ' _(pausado)_';
        if (r.kind === 'APPOINTMENT') {
          const w = r.whenAt
            ? new Date(r.whenAt).toLocaleString('es-PY', {
                timeZone: config.timezone || 'America/Asuncion',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '';
          return `*${i + 1}.* 🩺 *${r.medication}* — 📅 ${w}${state}`;
        }
        let hs: string[] = [];
        try {
          hs = JSON.parse(r.times);
        } catch {
          /* noop */
        }
        return `*${i + 1}.* 💊 *${r.medication}*${r.dose ? ` (${r.dose})` : ''} — ⏰ ${hs.join(', ')}${state}`;
      })
      .join('\n');
  }

  /** "HH:MM" hora local (config.timezone) y fecha "YYYY-MM-DD" ahora. */
  private static nowLocal(): { hhmm: string; minutes: number; date: string } {
    const tz = config.timezone || 'America/Asuncion';
    const d = new Date();
    const hhmm = d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [h, m] = hhmm.split(':').map(Number);
    const date = d.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
    return { hhmm, minutes: h * 60 + m, date };
  }

  /**
   * Tick del CRON (cada 5 min): dispara los recordatorios cuya hora cae dentro de
   * los últimos ~6 minutos y que no se enviaron ya en ese slot/día.
   */
  static async tick(): Promise<number> {
    const { minutes: nowMin, date } = this.nowLocal();
    let sent = 0;

    const reminders = await prisma.medicationReminder.findMany({
      where: { active: true },
      include: { user: { select: { phoneNumber: true, whatsappJid: true, status: true, language: true } } },
    });

    const nowMs = Date.now();

    for (const r of reminders) {
      if (!r.user || (r.user.status !== 'ACTIVE' && r.user.status !== 'EXPIRED')) continue;
      const gnU = r.user.language === 'GN';
      const target = r.user.whatsappJid || r.user.phoneNumber;

      // --- Turno / consulta médica (una sola vez) ---
      if (r.kind === 'APPOINTMENT') {
        if (!r.whenAt) continue;
        const whenMs = new Date(r.whenAt).getTime();
        const dtLocal = new Date(r.whenAt).toLocaleString('es-PY', {
          timeZone: config.timezone || 'America/Asuncion',
          weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        // Aviso 24 h antes
        if (r.lastSentSlot !== 'D-1' && whenMs - nowMs <= 24 * 3600_000 && whenMs - nowMs > 22 * 3600_000) {
          const msg = gnU
            ? `📅 *Momandu'a: turno* ko'ẽrõ\n\n*${r.medication}*\n🕒 ${dtLocal}`
            : `📅 *Recordatorio: turno mañana*\n\n*${r.medication}*\n🕒 ${dtLocal}`;
          await whatsappBot.sendMessage(target, msg).catch(() => {});
          await prisma.medicationReminder.update({ where: { id: r.id }, data: { lastSentAt: new Date(), lastSentSlot: 'D-1' } });
          sent++;
          continue;
        }
        // Aviso el día del turno (2 h antes hasta la hora)
        if (r.lastSentSlot !== 'DAY' && whenMs - nowMs <= 2 * 3600_000 && whenMs - nowMs > -15 * 60_000) {
          const msg = gnU
            ? `📅 *Turno ko'ág̃a*\n\n*${r.medication}*\n🕒 ${dtLocal}`
            : `📅 *Tu turno médico es hoy*\n\n*${r.medication}*\n🕒 ${dtLocal}\n\n_No faltes. Escribí *MENU* para tus opciones._`;
          await whatsappBot.sendMessage(target, msg).catch(() => {});
          await prisma.medicationReminder.update({
            where: { id: r.id },
            data: { lastSentAt: new Date(), lastSentSlot: 'DAY', active: whenMs > nowMs },
          });
          sent++;
        }
        // Desactivar turnos ya pasados
        if (whenMs < nowMs - 3600_000) {
          await prisma.medicationReminder.update({ where: { id: r.id }, data: { active: false } });
        }
        continue;
      }

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

        // Aviso previo, 10 minutos antes de la hora. El cron corre cada 5 min y
        // "10 minutos antes" no cae siempre en un múltiplo de 5 exacto, así que
        // se usa una ventana de 5 minutos [8,12] — como nowMin siempre avanza de
        // a 5, esa ventana garantiza exactamente un tick que la matchea.
        const lead = slotMin - nowMin;
        if (lead >= 8 && lead <= 12) {
          const preTag = `PRE10:${slot}|${date}`;
          if (r.lastSentSlot !== preTag) {
            const gnPre = r.user.language === 'GN';
            const preMsg = gnPre
              ? `⏰ *Momandu'a: 10 aja rupi*\n\n10 aja rupi reipuru va'erã *${r.medication}*${r.dose ? ` (${r.dose})` : ''} — ${slot}.`
              : `⏰ *En 10 minutos toca tu medicación*\n\n*${r.medication}*${r.dose ? ` (${r.dose})` : ''} a las ${slot}.\n\n_Preparala con tiempo._`;
            await whatsappBot.sendMessage(r.user.whatsappJid || r.user.phoneNumber, preMsg).catch((e) => {
              console.warn(`[REMINDER] no se pudo enviar preaviso a ${r.user?.phoneNumber}:`, e?.message);
            });
            await prisma.medicationReminder.update({
              where: { id: r.id },
              data: { lastSentAt: new Date(), lastSentSlot: preTag },
            });
            sent++;
            break;
          }
        }

        const diff = nowMin - slotMin;
        // ventana: [0, 6] minutos después de la hora
        if (diff < 0 || diff > 6) continue;
        const tag = `${slot}|${date}`;
        if (r.lastSentSlot === tag) continue;

        const gn = r.user.language === 'GN';
        const msg = gn
          ? `⏰ *Momandu'a pohã*\n\nHi'ára reipuru hag̃ua *${r.medication}*${r.dose ? ` (${r.dose})` : ''}.\n\n_Ehai *LISTO* rejapo rire, térã *MENU* rehecha hag̃ua opciones._`
          : `⏰ *Recordatorio de medicación*\n\nEs hora de tomar *${r.medication}*${r.dose ? ` (${r.dose})` : ''}.\n\n_Cuidá tu salud. Escribí *MENU* para ver tus opciones._`;

        await whatsappBot.sendMessage(r.user.whatsappJid || r.user.phoneNumber, msg).catch((e) => {
          console.warn(`[REMINDER] no se pudo enviar a ${r.user?.phoneNumber}:`, e?.message);
        });
        await prisma.medicationReminder.update({
          where: { id: r.id },
          data: { lastSentAt: new Date(), lastSentSlot: tag },
        });
        sent++;
        break; // un envío por reminder por tick
      }
    }
    if (sent) console.log(`⏰ [CRON] ${sent} recordatorio(s) de medicación enviado(s).`);
    return sent;
  }
}
