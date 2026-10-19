import { prisma } from '../database/prisma';
import { config } from '../config';
import { DoctorService } from './doctor.service';
import { AppointmentService } from './appointment.service';
import { MedicationReminderService } from './medication-reminder.service';
import { PaymentService } from './payment.service';

/** Scope del hablante → qué tools expone el agente de voz. */
export type VoiceScope = 'guest' | 'member' | 'doctor';

/** Contexto resuelto del lado servidor a partir del JWT (NUNCA de los args del modelo). */
export interface VoiceContext {
  userId?: string;
  doctorId?: string; // si el que habla es un doctor del catálogo
}

const TZ = () => config.timezone || 'America/Asuncion';

/** Definición de una tool para la sesión Realtime (formato OpenAI function tool). */
interface ToolDef {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, any>;
}

const T = {
  list_doctors: {
    type: 'function',
    name: 'list_doctors',
    description: 'Lista los doctores disponibles para reservar, opcionalmente filtrando por especialidad (ej. "cardiología", "odontología").',
    parameters: {
      type: 'object',
      properties: { specialty: { type: 'string', description: 'Especialidad buscada, o vacío para todos.' } },
    },
  },
  doctor_free_slots: {
    type: 'function',
    name: 'doctor_free_slots',
    description: 'Devuelve los horarios libres de un doctor para una fecha. Usar primero list_doctors para obtener el doctorId.',
    parameters: {
      type: 'object',
      properties: {
        doctorId: { type: 'string' },
        date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD (hora de Paraguay).' },
      },
      required: ['doctorId', 'date'],
    },
  },
  plan_prices: {
    type: 'function',
    name: 'plan_prices',
    description: 'Precios actuales de los planes de Bio-Pass.',
    parameters: { type: 'object', properties: {} },
  },
  book_appointment: {
    type: 'function',
    name: 'book_appointment',
    description: 'Reserva una cita con un doctor para el usuario actual. Confirmar fecha y hora con el usuario antes de llamar.',
    parameters: {
      type: 'object',
      properties: {
        doctorId: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM (24h)' },
      },
      required: ['doctorId', 'date', 'time'],
    },
  },
  my_appointments: {
    type: 'function',
    name: 'my_appointments',
    description: 'Lista las próximas citas del usuario actual.',
    parameters: { type: 'object', properties: {} },
  },
  cancel_appointment: {
    type: 'function',
    name: 'cancel_appointment',
    description: 'Cancela una cita del usuario actual por su appointmentId (obtenido de my_appointments).',
    parameters: { type: 'object', properties: { appointmentId: { type: 'string' } }, required: ['appointmentId'] },
  },
  doctor_agenda: {
    type: 'function',
    name: 'doctor_agenda',
    description: 'Lista las próximas citas del DOCTOR que está hablando.',
    parameters: { type: 'object', properties: {} },
  },
  doctor_set_status: {
    type: 'function',
    name: 'doctor_set_status',
    description: 'El doctor marca una de sus citas como atendida (DONE), no vino (NO_SHOW) o la cancela (CANCELLED).',
    parameters: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string' },
        status: { type: 'string', enum: ['DONE', 'NO_SHOW', 'CANCELLED'] },
      },
      required: ['appointmentId', 'status'],
    },
  },
} satisfies Record<string, ToolDef>;

export class VoiceToolsService {
  /** Tools que puede usar el agente según quién habla. */
  static toolsFor(scope: VoiceScope): ToolDef[] {
    const guest = [T.list_doctors, T.doctor_free_slots, T.plan_prices];
    if (scope === 'guest') return guest;
    if (scope === 'doctor') return [...guest, T.doctor_agenda, T.doctor_set_status, T.my_appointments, T.book_appointment, T.cancel_appointment];
    return [...guest, T.book_appointment, T.my_appointments, T.cancel_appointment];
  }

  /** Ejecuta una tool. La identidad SIEMPRE sale de `ctx` (JWT), nunca de `args`. */
  static async execute(name: string, args: any, ctx: VoiceContext): Promise<any> {
    try {
      switch (name) {
        case 'list_doctors': {
          const root = args?.specialty ? DoctorService.matchSpecialty(String(args.specialty)) : null;
          const docs = await DoctorService.findBySpecialty(root);
          return {
            doctors: docs.map((d) => ({
              id: d.id,
              nombre: d.fullName,
              especialidades: DoctorService.parseSpecialties(d.specialties),
              costo: DoctorService.formatMoney(d.consultationCost, d.currency),
              horario: DoctorService.formatSchedule(d.schedule),
            })),
          };
        }
        case 'doctor_free_slots': {
          const doctor = await prisma.doctor.findUnique({ where: { id: String(args?.doctorId || '') } });
          if (!doctor || !doctor.active) return { error: 'Doctor no encontrado.' };
          const date = String(args?.date || '');
          const slots = await DoctorService.freeSlots(doctor as any, date);
          return { doctor: doctor.fullName, fecha: date, horarios_libres: slots };
        }
        case 'plan_prices':
          return { precios: await PaymentService.priceText('es') };

        case 'book_appointment': {
          if (!ctx.userId) return { error: 'Para reservar hay que iniciar sesión / estar registrado.' };
          const user = await prisma.user.findUnique({ where: { id: ctx.userId } });
          if (!user) return { error: 'Usuario no encontrado.' };
          const whenAt = MedicationReminderService.localDateTime(String(args?.date || ''), String(args?.time || ''));
          if (!whenAt) return { error: 'Fecha u hora inválida (usar YYYY-MM-DD y HH:MM).' };
          const res = await AppointmentService.book({
            doctorId: String(args?.doctorId || ''),
            userId: user.id,
            patientName: user.fullName || 'Paciente',
            patientPhone: user.phoneNumber,
            whenAt,
            source: 'VOICE',
          });
          if ('error' in res) return { error: res.error };
          return res.needsPayment
            ? { ok: true, estado: 'esperando_pago', mensaje: 'Reserva creada. Queda confirmada al pagar la consulta.', pago: res.payText }
            : { ok: true, estado: 'confirmada', mensaje: 'Turno confirmado. Ya se avisó al doctor.' };
        }
        case 'my_appointments': {
          if (!ctx.userId) return { error: 'Iniciá sesión para ver tus citas.' };
          const appts = await AppointmentService.upcomingForUser(ctx.userId);
          return {
            citas: appts.map((a: any) => ({
              id: a.id,
              doctor: a.doctor?.fullName,
              cuando: new Date(a.whenAt).toLocaleString('es-PY', { timeZone: TZ(), weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
              estado: a.status,
            })),
          };
        }
        case 'cancel_appointment': {
          if (!ctx.userId) return { error: 'Iniciá sesión para cancelar.' };
          const appt = await prisma.appointment.findUnique({ where: { id: String(args?.appointmentId || '') } });
          if (!appt || appt.userId !== ctx.userId) return { error: 'No encontré esa cita entre las tuyas.' };
          await AppointmentService.cancel(appt.id);
          return { ok: true, mensaje: 'Cita cancelada. Se avisó al doctor.' };
        }

        case 'doctor_agenda': {
          if (!ctx.doctorId) return { error: 'Esta acción es solo para doctores del catálogo.' };
          const appts = await prisma.appointment.findMany({
            where: { doctorId: ctx.doctorId, status: { in: ['BOOKED', 'PENDING_PAYMENT'] }, whenAt: { gt: new Date() } },
            orderBy: { whenAt: 'asc' },
            take: 20,
          });
          return {
            agenda: appts.map((a) => ({
              id: a.id,
              paciente: a.patientName,
              telefono: a.patientPhone,
              cuando: new Date(a.whenAt).toLocaleString('es-PY', { timeZone: TZ(), weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
              estado: a.status,
            })),
          };
        }
        case 'doctor_set_status': {
          if (!ctx.doctorId) return { error: 'Esta acción es solo para doctores del catálogo.' };
          const appt = await prisma.appointment.findUnique({ where: { id: String(args?.appointmentId || '') } });
          if (!appt || appt.doctorId !== ctx.doctorId) return { error: 'Esa cita no es de tu agenda.' };
          const status = String(args?.status || '');
          if (!['DONE', 'NO_SHOW', 'CANCELLED'].includes(status)) return { error: 'Estado inválido.' };
          if (status === 'CANCELLED') await AppointmentService.cancel(appt.id);
          else await prisma.appointment.update({ where: { id: appt.id }, data: { status: status as any } });
          return { ok: true, mensaje: `Cita marcada como ${status}.` };
        }
        default:
          return { error: `Tool desconocida: ${name}` };
      }
    } catch (e: any) {
      console.error('[VOICE] tool error:', name, e?.message || e);
      return { error: 'No se pudo completar la acción.' };
    }
  }
}
