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

  /** Lista legible de recordatorios para WhatsApp. */
  static format(rows: Array<{ medication: string; dose: string | null; times: string; active: boolean }>): string {
    if (!rows.length) return '';
    return rows
      .map((r, i) => {
        let hs: string[] = [];
        try {
          hs = JSON.parse(r.times);
        } catch {
          /* noop */
        }
        const state = r.active ? '' : ' _(pausado)_';
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

    for (const r of reminders) {
      if (!r.user || (r.user.status !== 'ACTIVE' && r.user.status !== 'EXPIRED')) continue;
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
