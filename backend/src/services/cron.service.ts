import cron from 'node-cron';
import { prisma } from '../database/prisma';
import { config } from '../config';
import { whatsappBot } from '../whatsapp/baileys.client';
import { PaymentService } from './payment.service';
import { OtpService } from './otp.service';
import { MedicationReminderService } from './medication-reminder.service';
import { AiPromptService } from './ai-prompt.service';
import { PushService } from './push.service';

/**
 * Etapas de cobranza, contadas en días calendario (hora de Paraguay) respecto del
 * vencimiento:
 *   D_MINUS_5         5 días antes  → aviso de renovación
 *   D_0               el día        → "hoy vence"
 *   D_PLUS_3          3 días después → aviso de atraso
 *   D_PLUS_20_STANDBY 20 días después → la cuenta queda EN ESPERA: datos intactos,
 *                     QR apagado, sin multa. Se reactiva sola al pagar.
 * Entre el vencimiento y el día 20 el servicio sigue funcionando (período de gracia).
 * No se borra ningún dato por falta de pago.
 */
export type BillingStage = 'D_MINUS_5' | 'D_0' | 'D_PLUS_3' | 'D_PLUS_20_STANDBY';

const STAGE_ORDER: Record<string, number> = {
  NONE: 0,
  D_MINUS_5: 1,
  D_0: 2,
  D_PLUS_3: 3,
  D_PLUS_4_CANCELLED: 4, // etapa vieja (cancelación al día 4): equivale a "ya en espera"
  D_PLUS_20_STANDBY: 4,
  PURGED: 5,
};

/** Día calendario en la zona horaria del negocio, como número de días desde epoch. */
function dayNumber(d: Date): number {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const [y, m, day] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, day) / 86400_000);
}

/** Días que faltan para el vencimiento (negativo = días de atraso). */
export function daysUntilExpiry(expiry: Date, now: Date = new Date()): number {
  return dayNumber(expiry) - dayNumber(now);
}

/** Etapa que corresponde a esa cantidad de días; null si todavía no toca ninguna. */
export function stageFor(daysLeft: number): BillingStage | null {
  if (daysLeft <= -20) return 'D_PLUS_20_STANDBY';
  if (daysLeft <= -3) return 'D_PLUS_3';
  if (daysLeft <= 0) return 'D_0';
  if (daysLeft <= 5) return 'D_MINUS_5';
  return null;
}

type OrderInfo = Parameters<typeof PaymentService.payBlock>[0];

export class CronService {
  /**
   * Initializes daily automated subscription lifecycle checks
   */
  public static init(): void {
    // Todos los días a las 08:00 (hora de Paraguay — el contenedor corre en UTC).
    cron.schedule(
      '0 8 * * *',
      async () => {
        console.log('⏰ [CRON JOB] Revisión diaria de vencimientos…');
        const r = await this.runSubscriptionCheck().catch((e) => {
          console.error('[CRON] error en la revisión de vencimientos:', e?.message || e);
          return null;
        });
        if (r) console.log(`⏰ [CRON JOB] revisadas ${r.checked}, avisos ${r.notificationsSent}, en espera ${r.standby}`);
      },
      { timezone: config.timezone }
    );

    // Hourly: drop stale OTP codes
    cron.schedule('0 * * * *', async () => {
      const removed = await OtpService.purgeStale().catch(() => 0);
      if (removed) console.log(`🧹 [CRON JOB] Purged ${removed} stale OTP codes.`);
    });

    // Cada minuto: turnos/medicación cuyo aviso ya toca. Antes era cada 5 min —
    // eso obligaba a un piso artificial de "mínimo 5 min de anticipación" y podía
    // demorar hasta 5 min un aviso que ya estaba vencido. Con 1 min de por medio,
    // el piso baja a 1 min real y la demora máxima también.
    cron.schedule('* * * * *', async () => {
      const sent = await MedicationReminderService.tick().catch((e) => {
        console.warn('[CRON] reminder tick error:', e?.message);
        return 0;
      });
      if (sent) console.log(`⏰ [CRON] recordatorios enviados: ${sent}`);
    });

    // Seed default AI prompts once (editable afterwards in /admin → IA).
    AiPromptService.seed().catch(() => {});

    console.log('⏰ CRON: renovaciones (08:00 diario) + OTP (horario) + recordatorios de medicación (cada 1 min)');
  }

  /** Texto de cada aviso de cobranza. `daysLeft` solo se usa en el aviso previo. */
  public static buildNotice(stage: BillingStage, order: OrderInfo, opts: { daysLeft?: number; expiry?: Date; lang?: string } = {}): { title: string; text: string } {
    const pay = PaymentService.payBlock(order, opts.lang);
    const fecha = opts.expiry ? opts.expiry.toLocaleDateString('es-PY', { timeZone: config.timezone }) : '';
    switch (stage) {
      case 'D_MINUS_5': {
        const n = Math.max(1, opts.daysLeft ?? 5);
        const cuando = n === 1 ? 'mañana' : `en *${n} días*`;
        return {
          title: `⏳ Tu Bio-Pass vence ${n === 1 ? 'mañana' : `en ${n} días`}`,
          text:
            `⏳ *AVISO DE RENOVACIÓN BIO-PASS*\n\n` +
            `Tu Bio-Pass vence ${cuando}${fecha ? ` (el ${fecha})` : ''}.\n` +
            `Renovalo ahora y seguís con tu QR de emergencia y tu historial médico sin interrupciones.\n\n` +
            pay,
        };
      }
      case 'D_0':
        return {
          title: '🚨 Hoy vence tu Bio-Pass',
          text:
            `🚨 *HOY VENCE TU BIO-PASS*\n\n` +
            `Tu suscripción llegó a su fecha de vencimiento.\n` +
            `Pagá hoy para mantener tu QR de emergencia activo y visible ante paramédicos.\n\n` +
            pay,
        };
      case 'D_PLUS_3':
        return {
          title: '⚠️ Tu Bio-Pass está vencido',
          text:
            `⚠️ *TU BIO-PASS ESTÁ VENCIDO*\n\n` +
            `Tu suscripción venció hace *3 días*. Por ahora tu QR sigue funcionando, pero si no se regulariza la cuenta pasa a *en espera* y el QR se apaga.\n\n` +
            pay,
        };
      case 'D_PLUS_20_STANDBY':
        return {
          title: '⏸️ Tu Bio-Pass quedó en espera',
          text:
            `⏸️ *TU BIO-PASS QUEDÓ EN ESPERA*\n\n` +
            `Pasaron 20 días desde el vencimiento sin registrar el pago, así que tu QR de emergencia quedó *desactivado*.\n\n` +
            `Tus datos, estudios y recetas siguen guardados y *no se borra nada*. Tampoco hay multa: pagando la cuota normal todo vuelve a funcionar al instante.\n\n` +
            pay,
        };
    }
  }

  /**
   * Revisión diaria. Por cada titular se mira UNA sola suscripción (la vigente) y
   * se manda, como mucho, el aviso de la etapa en la que está hoy. La orden de
   * pago se genera recién cuando hay un aviso para mandar.
   */
  public static async runSubscriptionCheck(now: Date = new Date()): Promise<{ checked: number; notificationsSent: number; standby: number; purged: number }> {
    let notificationsSent = 0;
    let standby = 0;

    const subs = await prisma.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'EXPIRED', 'CANCELLED'] } },
      include: { user: true },
      orderBy: { expiryDate: 'desc' },
    });
    // La primera de cada titular (vencimiento más lejano) es la vigente; el resto es historia.
    const seen = new Set<string>();
    const current = subs.filter((s) => {
      if (!s.user || seen.has(s.userId)) return false;
      seen.add(s.userId);
      return true;
    });

    for (const sub of current) {
      const user = sub.user;
      // Pausa voluntaria, cuentas borradas o que nunca pagaron: no se les cobra.
      if (user.status === 'PAUSED' || user.status === 'PURGED' || user.status === 'PENDING_PAYMENT') continue;

      try {
        const daysLeft = daysUntilExpiry(sub.expiryDate, now);
        const stage = stageFor(daysLeft);

        if (!stage) {
          // Al día (p. ej. le extendieron la vigencia a mano): se limpia el rastro de avisos.
          if (sub.lastNotification !== 'NONE' || sub.status !== 'ACTIVE' || user.status !== 'ACTIVE') {
            await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', lastNotification: 'NONE' } });
            await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
          }
          continue;
        }
        // Ya se le avisó esta etapa (o una posterior).
        if ((STAGE_ORDER[sub.lastNotification] ?? 0) >= STAGE_ORDER[stage]) continue;

        const order = await PaymentService.getRenewalOrder(user.id);
        const notice = this.buildNotice(stage, order, { daysLeft, expiry: sub.expiryDate, lang: user.language });

        PushService.notify(user.id, notice.title, notice.text, { tag: 'subscription', url: '/payments', requireInteraction: stage !== 'D_MINUS_5' });
        await whatsappBot.sendMessage(user.whatsappJid || user.phoneNumber, notice.text);

        const newStatus = stage === 'D_MINUS_5' ? 'ACTIVE' : stage === 'D_PLUS_20_STANDBY' ? 'CANCELLED' : 'EXPIRED';
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: newStatus, lastNotification: stage, finePending: false, fineAmount: 0 },
        });
        if (user.status !== newStatus) await prisma.user.update({ where: { id: user.id }, data: { status: newStatus } });
        notificationsSent++;
        if (stage === 'D_PLUS_20_STANDBY') standby++;
      } catch (e: any) {
        // Un titular con problema (p. ej. Bancard caído al generar la orden) no frena al resto.
        console.error(`[CRON] cobranza de ${user.phoneNumber} falló:`, e?.message || e);
      }
    }

    return { checked: current.length, notificationsSent, standby, purged: 0 };
  }

  /**
   * PRUEBA de avisos: manda a un número el aviso de la etapa pedida, tal cual
   * saldría, sin esperar la fecha y SIN cambiar el estado de la cuenta ni de la
   * suscripción. Lo usa el panel admin.
   */
  public static async sendTestNotice(phone: string, stage: BillingStage): Promise<{ ok: boolean; error?: string; text?: string }> {
    const digits = (phone || '').replace(/\D/g, '');
    const user = await prisma.user.findFirst({
      where: { OR: [{ phoneNumber: digits }, { whatsappJid: { startsWith: digits } }] },
    });
    if (!user) return { ok: false, error: 'No hay ninguna cuenta con ese número.' };
    const sub = await PaymentService.currentSubscription(user.id);
    const order = await PaymentService.getRenewalOrder(user.id);
    const notice = this.buildNotice(stage, order, { daysLeft: 5, expiry: sub?.expiryDate, lang: user.language });
    const text = `🧪 _PRUEBA — así llega este aviso. Tu cuenta no cambió._\n\n${notice.text}`;
    const sent = await whatsappBot.sendMessage(user.whatsappJid || user.phoneNumber, text);
    return sent ? { ok: true, text } : { ok: false, error: 'WhatsApp no está conectado o no se pudo enviar.', text };
  }
}
