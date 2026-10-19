import { prisma } from '../database/prisma';
import { config } from '../config';
import { whatsappBot } from '../whatsapp/baileys.client';
import { MedicationReminderService } from './medication-reminder.service';
import { DoctorService, DoctorRow } from './doctor.service';
import { PaymentService } from './payment.service';
import { PushService } from './push.service';

const TZ = () => config.timezone || 'America/Asuncion';

/** "lunes 20/10 14:30" en hora local PY. */
function fmtWhen(d: Date): string {
  return new Date(d).toLocaleString('es-PY', {
    timeZone: TZ(),
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Cuánto falta, en texto corto. */
function humanIn(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? '1 hora' : `${h} horas`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 día' : `${d} días`;
}

type ApptWithRel = {
  id: string;
  doctorId: string;
  userId: string | null;
  patientName: string;
  patientPhone: string;
  whenAt: Date;
  durationMinutes: number;
  status: string;
  cost: number | null;
  currency: string;
  patientReminderId: string | null;
  doctor?: DoctorRow;
};

export class AppointmentService {
  /**
   * Crea una reserva con un doctor del catálogo. Si el doctor cobra, la reserva queda
   * en PENDING_PAYMENT y se devuelve el texto de pago (payBlock) para mandarle al
   * paciente; recién al confirmarse el pago (handlePaymentSuccess) se activa y se avisa
   * al doctor. Si no cobra, queda BOOKED y se avisa al doctor al instante.
   */
  static async book(opts: {
    doctorId: string;
    userId?: string | null;
    patientName: string;
    patientPhone: string;
    whenAt: Date;
    source?: string;
  }): Promise<{ appointment: ApptWithRel; needsPayment: boolean; payText?: string } | { error: string }> {
    const doctor = (await prisma.doctor.findUnique({ where: { id: opts.doctorId } })) as DoctorRow | null;
    if (!doctor || !doctor.active) return { error: 'Ese doctor no está disponible.' };

    // Revalida que el horario siga libre (otro paciente pudo tomarlo).
    const dateKey = new Date(opts.whenAt).toLocaleDateString('en-CA', { timeZone: TZ() });
    const hhmm = new Date(opts.whenAt).toLocaleTimeString('en-GB', { timeZone: TZ(), hour: '2-digit', minute: '2-digit', hour12: false });
    const free = await DoctorService.freeSlots(doctor, dateKey);
    if (!free.includes(hhmm)) return { error: 'Ese horario ya no está disponible. Elegí otro, por favor.' };

    const needsPayment = !!doctor.consultationCost && doctor.consultationCost > 0;
    const appt = (await prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        userId: opts.userId || null,
        patientName: opts.patientName.slice(0, 120),
        patientPhone: opts.patientPhone,
        whenAt: opts.whenAt,
        durationMinutes: doctor.slotMinutes || 30,
        status: needsPayment ? 'PENDING_PAYMENT' : 'BOOKED',
        cost: needsPayment ? doctor.consultationCost : null,
        currency: doctor.currency,
        source: opts.source || 'BOT',
      },
    })) as ApptWithRel;
    appt.doctor = doctor;

    if (!needsPayment) {
      await this.confirm(appt.id);
      return { appointment: appt, needsPayment: false };
    }

    // Cobro: genera la orden de pago y arma el bloque de instrucciones.
    const payText = await PaymentService.createAppointmentOrder(appt, doctor).catch((e) => {
      console.error('[APPT] no se pudo crear la orden de pago:', e?.message || e);
      return undefined;
    });
    return { appointment: appt, needsPayment: true, payText };
  }

  /**
   * Confirma una reserva (gratuita o ya pagada): crea el recordatorio espejo que avisa
   * al PACIENTE (reutiliza el motor de medication-reminder) y notifica al doctor.
   * Idempotente: si ya estaba confirmada con recordatorio, no hace nada.
   */
  static async confirm(appointmentId: string): Promise<void> {
    const appt = (await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { doctor: true } })) as any;
    if (!appt || appt.status === 'CANCELLED') return;
    const doctor: DoctorRow = appt.doctor;

    let patientReminderId = appt.patientReminderId as string | null;
    if (!patientReminderId && appt.userId) {
      const specialties = DoctorService.parseSpecialties(doctor.specialties);
      const note = `${specialties[0] ? specialties[0] + ' — ' : ''}${doctor.fullName}`;
      const reminder = await MedicationReminderService.createFromDraft(appt.userId, {
        kind: 'APPOINTMENT',
        medication: note,
        whenAt: new Date(appt.whenAt).toISOString(),
        leadMinutes: 60,
      });
      patientReminderId = reminder.id;
    }

    await prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'BOOKED', patientReminderId, doctorNotifiedAt: new Date() },
    });
    appt.patientReminderId = patientReminderId;
    await this.notifyDoctor({ ...appt, doctor }, 'NEW');
  }

  /** Cancela una reserva, desactiva el recordatorio del paciente y avisa al doctor. */
  static async cancel(appointmentId: string, opts: { silent?: boolean } = {}): Promise<boolean> {
    const appt = (await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { doctor: true } })) as any;
    if (!appt || appt.status === 'CANCELLED') return false;
    await prisma.appointment.update({ where: { id: appt.id }, data: { status: 'CANCELLED' } });
    if (appt.patientReminderId) {
      await prisma.medicationReminder.update({ where: { id: appt.patientReminderId }, data: { active: false } }).catch(() => {});
    }
    if (!opts.silent && appt.doctorNotifiedAt) await this.notifyDoctor(appt, 'CANCELLED');
    return true;
  }

  /** Reprograma: cambia la hora de la cita y del recordatorio espejo, y avisa al doctor. */
  static async reschedule(appointmentId: string, whenAt: Date): Promise<boolean> {
    const appt = (await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { doctor: true } })) as any;
    if (!appt || appt.status === 'CANCELLED') return false;
    await prisma.appointment.update({ where: { id: appt.id }, data: { whenAt, doctorLastSlot: null } });
    if (appt.patientReminderId) {
      await prisma.medicationReminder
        .update({ where: { id: appt.patientReminderId }, data: { whenAt, active: true, lastSentSlot: null } })
        .catch(() => {});
    }
    appt.whenAt = whenAt;
    if (appt.doctorNotifiedAt && appt.status === 'BOOKED') await this.notifyDoctor(appt, 'RESCHEDULED');
    return true;
  }

  /** Manda un aviso al WhatsApp del doctor (el doctor no interactúa con el bot). */
  static async notifyDoctor(appt: ApptWithRel, kind: 'NEW' | 'REMINDER' | 'CANCELLED' | 'RESCHEDULED'): Promise<boolean> {
    const doctor = appt.doctor;
    if (!doctor?.whatsappNumber) return false;
    const when = fmtWhen(appt.whenAt);
    const paciente = `${appt.patientName}${appt.patientPhone ? ` (${appt.patientPhone})` : ''}`;
    let text = '';
    switch (kind) {
      case 'NEW':
        text =
          `📅 *Nueva reserva de consulta*\n\n` +
          `👤 *Paciente:* ${paciente}\n` +
          `🕒 *Cuándo:* ${when}\n` +
          (appt.cost ? `💵 *Consulta:* ${DoctorService.formatMoney(appt.cost, appt.currency)} (pagada)\n` : '') +
          `\n_Aviso automático de Bio-Pass. Si no podés atender, coordiná con el paciente._`;
        break;
      case 'REMINDER':
        text =
          `🔔 *Recordatorio de cita*\n\n` +
          `👤 *Paciente:* ${paciente}\n` +
          `🕒 ${when}\n` +
          `⏱️ Faltan ${humanIn(new Date(appt.whenAt).getTime() - Date.now())}.`;
        break;
      case 'CANCELLED':
        text = `❌ *Cita cancelada*\n\n👤 *Paciente:* ${paciente}\n🕒 Era: ${when}`;
        break;
      case 'RESCHEDULED':
        text = `🔄 *Cita reprogramada*\n\n👤 *Paciente:* ${paciente}\n🕒 *Nueva fecha:* ${when}`;
        break;
    }
    return whatsappBot.sendMessage(doctor.whatsappNumber, text);
  }

  /** Citas con doctor del catálogo que todavía no pasaron, para el paciente (bot/web). */
  static async upcomingForUser(userId: string): Promise<ApptWithRel[]> {
    return (await prisma.appointment.findMany({
      where: { userId, status: { in: ['BOOKED', 'PENDING_PAYMENT'] }, whenAt: { gt: new Date() } },
      orderBy: { whenAt: 'asc' },
      include: { doctor: true },
    })) as any;
  }

  /**
   * Cron (cada minuto): le recuerda a cada DOCTOR su próxima cita, `doctorLeadMinutes`
   * antes. Los avisos al PACIENTE los sigue mandando el tick() de medication-reminder a
   * través del recordatorio espejo, así que acá solo se avisa al doctor. Devuelve cuántos
   * avisos salieron.
   */
  static async tickDoctorReminders(): Promise<number> {
    if (!whatsappBot.getStatus().connected) return 0;
    const now = Date.now();
    const appts = (await prisma.appointment.findMany({
      where: { status: 'BOOKED', whenAt: { gt: new Date(now - 15 * 60_000) } },
      include: { doctor: true },
    })) as any[];
    let sent = 0;
    for (const appt of appts) {
      const doctor: DoctorRow = appt.doctor;
      if (!doctor?.whatsappNumber) continue;
      const lead = Math.max(1, doctor.doctorLeadMinutes || 120);
      const until = new Date(appt.whenAt).getTime() - now;
      const due = until - lead * 60_000 <= 30_000 && until > -15 * 60_000;
      if (!due || appt.doctorLastSlot === 'LEAD') continue;
      if (await this.notifyDoctor(appt, 'REMINDER')) {
        await prisma.appointment.update({ where: { id: appt.id }, data: { doctorLastSlot: 'LEAD' } });
        sent++;
      }
    }
    if (sent) console.log(`⏰ [CRON] ${sent} recordatorio(s) a doctores enviado(s).`);
    return sent;
  }

  /** Confirma el pago de una consulta: llamado desde handlePaymentSuccess. */
  static async onPaymentConfirmed(appointmentId: string): Promise<void> {
    await this.confirm(appointmentId);
    const appt = (await prisma.appointment.findUnique({ where: { id: appointmentId } })) as any;
    if (appt?.userId) {
      PushService.notify(appt.userId, '✅ Turno confirmado', `Tu consulta quedó reservada para el ${fmtWhen(appt.whenAt)}.`, {
        tag: `appt-${appt.id}`,
        url: '/dashboard',
      });
    }
  }
}
