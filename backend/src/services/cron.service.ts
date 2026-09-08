import cron from 'node-cron';
import { prisma } from '../database/prisma';
import { whatsappBot } from '../whatsapp/baileys.client';
import { StorageService } from '../storage/storage.service';
import { PaymentService } from './payment.service';
import { OtpService } from './otp.service';
import { MedicationReminderService } from './medication-reminder.service';
import { AiPromptService } from './ai-prompt.service';

export class CronService {
  /**
   * Initializes daily automated subscription lifecycle checks
   */
  public static init(): void {
    // Run every day at 08:00 AM (or every minute in debug/test mode)
    cron.schedule('0 8 * * *', async () => {
      console.log('⏰ [CRON JOB] Starting daily subscription expiration and purge check...');
      await this.runSubscriptionCheck();
    });

    // Hourly: drop stale OTP codes
    cron.schedule('0 * * * *', async () => {
      const removed = await OtpService.purgeStale().catch(() => 0);
      if (removed) console.log(`🧹 [CRON JOB] Purged ${removed} stale OTP codes.`);
    });

    // Every 5 minutes: dispatch medication-reminder alerts whose time is due.
    cron.schedule('*/5 * * * *', async () => {
      await MedicationReminderService.tick().catch((e) => console.warn('[CRON] reminder tick error:', e?.message));
    });

    // Seed default AI prompts once (editable afterwards in /admin → IA).
    AiPromptService.seed().catch(() => {});

    console.log('⏰ CRON: renovaciones (08:00 diario) + OTP (horario) + recordatorios de medicación (cada 5 min)');
  }

  public static async runSubscriptionCheck(): Promise<{ checked: number; notificationsSent: number; purged: number }> {
    const now = new Date();
    let notificationsSent = 0;
    let purged = 0;

    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'EXPIRED', 'CANCELLED'] },
      },
      include: {
        user: true,
      },
    });

    for (const sub of subscriptions) {
      const user = sub.user;
      if (!user) continue;

      const diffMs = sub.expiryDate.getTime() - now.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)); // positive if before expiry, negative if after

      const isPY = sub.country === 'PARAGUAY';
      const renewalOrder = await PaymentService.createPaymentOrder({
        userId: user.id,
        plan: sub.plan,
        country: isPY ? 'PARAGUAY' : 'BRASIL',
        isFine: sub.status === 'CANCELLED',
      });

      // DAY -5 (5 days before expiration)
      if (diffDays <= 5 && diffDays > 0 && sub.lastNotification === 'NONE') {
        const msg = `⏳ *AVISO DE RENOVACIÓN BIO-PASS*\n\n` +
          `Tu Bio-Pass vence en *5 días*.\n` +
          `Renueva ahora para no perder tu historial médico ni la disponibilidad de tu QR de emergencia.\n\n` +
          `🔗 *Enlace de renovación:* ${renewalOrder.paymentLink}\n` +
          (isPY ? `🏦 *Alias:* ${renewalOrder.aliasInfo}` : `📱 *PIX Copia y Pega:*\n\`${renewalOrder.pixPayload}\``);

        await whatsappBot.sendMessage(user.whatsappJid || user.phoneNumber, msg);
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { lastNotification: 'D_MINUS_5' },
        });
        notificationsSent++;
      }

      // DAY 0 (Day of Expiration)
      else if (diffDays <= 0 && diffDays > -3 && sub.lastNotification !== 'D_0' && sub.lastNotification !== 'D_PLUS_3' && sub.lastNotification !== 'D_PLUS_4_CANCELLED') {
        const msg = `🚨 *HOY VENCE TU SERVICIO BIO-PASS*\n\n` +
          `Tu cuenta ha llegado a su fecha de expiración.\n` +
          `Realiza el pago hoy mismo para mantener tu QR de emergencia activo y visible ante paramédicos.\n\n` +
          `🔗 *Pagar Ahora:* ${renewalOrder.paymentLink}`;

        await whatsappBot.sendMessage(user.whatsappJid || user.phoneNumber, msg);
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'EXPIRED',
            lastNotification: 'D_0',
          },
        });
        await prisma.user.update({
          where: { id: user.id },
          data: { status: 'EXPIRED' },
        });
        notificationsSent++;
      }

      // DAY +3 (3 days past expiration)
      else if (diffDays <= -3 && diffDays > -4 && sub.lastNotification !== 'D_PLUS_3' && sub.lastNotification !== 'D_PLUS_4_CANCELLED') {
        const msg = `⚠️ *AVISO CRÍTICO BIO-PASS*\n\n` +
          `Tu servicio venció hace *3 días*. Tu QR público está en riesgo de bloqueo inmediato.\n` +
          `Actualiza tu pago ahora para evitar recargos por cancelación:\n\n` +
          `🔗 *Enlace:* ${renewalOrder.paymentLink}`;

        await whatsappBot.sendMessage(user.whatsappJid || user.phoneNumber, msg);
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { lastNotification: 'D_PLUS_3' },
        });
        notificationsSent++;
      }

      // DAY +4 (Service Cancellation & Fine requirement)
      else if (diffDays <= -4 && diffDays > -30 && sub.lastNotification !== 'D_PLUS_4_CANCELLED') {
        const fineText = isPY ? 'Gs. 50.000 (cincuenta mil guaraníes)' : '44 reales brasileros';
        const msg = `🚫 *SERVICIO CANCELADO POR FALTA DE PAGO*\n\n` +
          `Tu Bio-Pass ha sido *CANCELADO*. Tus datos médicos han sido bloqueados y el QR de emergencia desactivado.\n\n` +
          `⚠️ *Periodo de Gracia (30 días):*\n` +
          `Si deseas recuperarlos en los próximos 30 días, abona una multa de *${fineText}* más la cuota correspondiente y reactivamos tu cuenta.\n\n` +
          `🔗 *Enlace de reactivación con multa incluida:*\n${renewalOrder.paymentLink}`;

        await whatsappBot.sendMessage(user.whatsappJid || user.phoneNumber, msg);
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'CANCELLED',
            finePending: true,
            fineAmount: isPY ? 50000 : 44,
            lastNotification: 'D_PLUS_4_CANCELLED',
          },
        });
        await prisma.user.update({
          where: { id: user.id },
          data: { status: 'CANCELLED' },
        });
        notificationsSent++;
      }

      // DAY +30 (Physical Data Purge - GDPR / LGPD compliance)
      else if (diffDays <= -30 && sub.status === 'CANCELLED') {
        console.log(`🗑️ [GDPR PURGE] Physically purging all records and files for user: ${user.phoneNumber} (${user.id})`);

        // 1. Delete physical files from disk / S3
        await StorageService.purgeUserData(user.id);

        // 2. Cascade delete records from database
        await prisma.scanAuditLog.deleteMany({ where: { userId: user.id } });
        await prisma.medicalStudy.deleteMany({ where: { userId: user.id } });
        await prisma.emergencyContact.deleteMany({ where: { userId: user.id } });
        await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
        await prisma.subscription.deleteMany({ where: { userId: user.id } });
        
        // Update user to PURGED status with zeroed sensitive data
        await prisma.user.update({
          where: { id: user.id },
          data: {
            fullName: '[DATOS PURGADOS GDPR]',
            ciNumber: null,
            ciFrontUrl: null,
            ciBackUrl: null,
            bloodType: null,
            emergencyConditions: null,
            severeAllergies: null,
            contraindicatedMeds: null,
            address: null,
            email: null,
            encryptedMedicalBlob: null,
            pinHash: null,
            status: 'PURGED',
            onboardingState: 'PURGED',
          },
        });

        const finalMsg = `🗑️ *AVISO FINAL BIO-PASS (GDPR/LGPD)*\n\n` +
          `Habiendo transcurrido el plazo máximo de 30 días posteriores a la cancelación sin regularización, informamos que:\n\n` +
          `*Tus datos han sido desechados por seguridad y eliminados físicamente de nuestros servidores.*\n` +
          `Si deseas utilizar Bio-Pass en el futuro, deberás realizar un nuevo registro desde cero.`;

        await whatsappBot.sendMessage(user.whatsappJid || user.phoneNumber, finalMsg);
        purged++;
      }
    }

    return {
      checked: subscriptions.length,
      notificationsSent,
      purged,
    };
  }
}
