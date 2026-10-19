import { prisma } from '../database/prisma';
import { config } from '../config';
import { MedicationReminderService } from './medication-reminder.service';

/** Un bloque del horario de atención semanal del doctor (hora local PY). */
export interface ScheduleBlock {
  day: number; // 0=domingo … 6=sábado (JS getDay)
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export type DoctorRow = {
  id: string;
  fullName: string;
  specialties: string;
  consultationCost: number | null;
  currency: string;
  whatsappNumber: string;
  schedule: string;
  slotMinutes: number;
  doctorLeadMinutes: number;
  active: boolean;
  notes: string | null;
};

const TZ = () => config.timezone || 'America/Asuncion';
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** minúsculas, sin acentos — para comparar especialidades y pedidos del paciente. */
function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Lo que escribe el paciente ("necesito un cardiólogo", "quiero ver a un dentista")
 * → raíz normalizada de especialidad para buscar entre los doctores. null si no se
 * reconoce ninguna. Las claves son raíces que matchean por substring contra el nombre
 * de la especialidad cargada en el doctor (también normalizado).
 */
const SPECIALTY_HINTS: Array<[RegExp, string]> = [
  [/cardiolog|cardiaco|corazon|cardio\b/, 'cardiolog'],
  [/odontolog|dentista|muela|diente|dental/, 'odontolog'],
  [/pediatr|ni[ñn]o|bebe|lactante/, 'pediatr'],
  [/dermatolog|piel|dermato/, 'dermatolog'],
  [/ginecolog|obstetr|embarazo/, 'ginecolog'],
  [/traumatolog|hueso|fractura|traumato/, 'traumatolog'],
  [/oftalmolog|ojo|vista|ocular/, 'oftalmolog'],
  [/otorrino|oido|garganta|nariz/, 'otorrino'],
  [/neurolog|neuro\b/, 'neurolog'],
  [/psiquiatr/, 'psiquiatr'],
  [/psicolog|psico\b/, 'psicolog'],
  [/nutricion|nutri\b/, 'nutricion'],
  [/urolog/, 'urolog'],
  [/endocrin|tiroides|diabetes/, 'endocrin'],
  [/gastroenterolog|gastro\b|estomago/, 'gastro'],
  [/neumolog|pulmon|respirator/, 'neumolog'],
  [/reumatolog|articulacion/, 'reumatolog'],
  [/kinesiolog|fisioterap|kine\b/, 'kinesiolog'],
  [/clinic|medico general|medicina general|general\b|clinico/, 'clinic'],
];

export class DoctorService {
  static parseSpecialties(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const a = JSON.parse(raw);
      return Array.isArray(a) ? a.map((x) => String(x).trim()).filter(Boolean) : [];
    } catch {
      // Tolera un string suelto separado por comas (carga manual vieja).
      return String(raw)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }

  static parseSchedule(raw: string | null | undefined): ScheduleBlock[] {
    if (!raw) return [];
    try {
      const a = JSON.parse(raw);
      if (!Array.isArray(a)) return [];
      return a
        .map((b: any) => ({ day: Number(b.day), start: String(b.start || ''), end: String(b.end || '') }))
        .filter((b) => b.day >= 0 && b.day <= 6 && /^\d{2}:\d{2}$/.test(b.start) && /^\d{2}:\d{2}$/.test(b.end) && b.start < b.end);
    } catch {
      return [];
    }
  }

  /** "Lun, Mié y Vie 08:00–12:00 · Sáb 09:00–13:00" */
  static formatSchedule(raw: string | null | undefined): string {
    const blocks = this.parseSchedule(raw);
    if (!blocks.length) return 'Sin horario cargado';
    // Agrupa por rango horario para no repetir ("Lun, Mié y Vie 08:00–12:00").
    const byRange = new Map<string, number[]>();
    for (const b of blocks) {
      const key = `${b.start}–${b.end}`;
      (byRange.get(key) || byRange.set(key, []).get(key)!).push(b.day);
    }
    const parts: string[] = [];
    for (const [range, days] of byRange) {
      const uniq = Array.from(new Set(days)).sort((a, z) => a - z);
      const labels = uniq.map((d) => DAY_SHORT[d]);
      const daysLabel = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} y ${labels.slice(-1)}` : labels[0];
      parts.push(`${daysLabel} ${range}`);
    }
    return parts.join(' · ');
  }

  static formatMoney(cost: number | null | undefined, currency: string): string {
    if (!cost || cost <= 0) return 'Sin costo';
    if (currency === 'PYG') return `Gs. ${Math.round(cost).toLocaleString('es-PY')}`;
    if (currency === 'BRL') return `R$ ${cost.toFixed(2)}`;
    if (currency === 'USD') return `US$ ${cost.toFixed(2)}`;
    return `${currency} ${cost}`;
  }

  /** Raíz de especialidad a buscar a partir del pedido del paciente, o null. */
  static matchSpecialty(text: string): string | null {
    const t = norm(text);
    for (const [re, root] of SPECIALTY_HINTS) if (re.test(t)) return root;
    return null;
  }

  /** Doctores activos cuya especialidad matchea la raíz (o todos si root es null). */
  static async findBySpecialty(root: string | null): Promise<DoctorRow[]> {
    const docs = (await prisma.doctor.findMany({ where: { active: true }, orderBy: { fullName: 'asc' } })) as DoctorRow[];
    if (!root) return docs;
    return docs.filter((d) => this.parseSpecialties(d.specialties).some((s) => norm(s).includes(root) || root.includes(norm(s).slice(0, 6))));
  }

  /** Nombre del día (largo) de una fecha local PY "YYYY-MM-DD". */
  static dayName(dateKey: string): string {
    return DAY_NAMES[this.weekday(dateKey)] || '';
  }

  /** Día de la semana (0-6) de una fecha "YYYY-MM-DD" en hora local PY (offset fijo -03:00). */
  static weekday(dateKey: string): number {
    const d = new Date(`${dateKey}T12:00:00-03:00`);
    return isNaN(d.getTime()) ? -1 : d.getDay();
  }

  /**
   * Turnos LIBRES del doctor para una fecha "YYYY-MM-DD": arma los slots de
   * `slotMinutes` que caen dentro de su horario de ese día de semana, descarta los
   * que ya pasaron y los que ya tienen una reserva (BOOKED/PENDING_PAYMENT).
   * Devuelve una lista de "HH:MM" ordenada.
   */
  static async freeSlots(doctor: DoctorRow, dateKey: string, from: Date = new Date()): Promise<string[]> {
    const wd = this.weekday(dateKey);
    if (wd < 0) return [];
    const blocks = this.parseSchedule(doctor.schedule).filter((b) => b.day === wd);
    if (!blocks.length) return [];
    const step = Math.max(5, doctor.slotMinutes || 30);

    // Reservas vivas de ese día (inicio del día a fin del día, hora local).
    const dayStart = MedicationReminderService.localDateTime(dateKey, '00:00');
    const dayEnd = MedicationReminderService.localDateTime(dateKey, '23:59');
    const taken = new Set<string>();
    if (dayStart && dayEnd) {
      const booked = await prisma.appointment.findMany({
        where: { doctorId: doctor.id, status: { in: ['BOOKED', 'PENDING_PAYMENT'] }, whenAt: { gte: dayStart, lte: dayEnd } },
        select: { whenAt: true },
      });
      for (const b of booked) {
        taken.add(new Date(b.whenAt).toLocaleTimeString('en-GB', { timeZone: TZ(), hour: '2-digit', minute: '2-digit', hour12: false }));
      }
    }

    const out: string[] = [];
    for (const b of blocks) {
      const [sh, sm] = b.start.split(':').map(Number);
      const [eh, em] = b.end.split(':').map(Number);
      for (let min = sh * 60 + sm; min + step <= eh * 60 + em; min += step) {
        const hhmm = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
        if (taken.has(hhmm)) continue;
        const at = MedicationReminderService.localDateTime(dateKey, hhmm);
        if (!at || at.getTime() < from.getTime() + 60_000) continue; // ya pasó / demasiado justo
        out.push(hhmm);
      }
    }
    return out;
  }
}
