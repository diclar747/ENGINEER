import { prisma } from '../database/prisma';
import { StorageService } from '../storage/storage.service';

/**
 * Borrado físico total de una cuenta (GDPR/LGPD). Usado por dos caminos:
 * el cron de purga automática a D+30 de una cancelación por falta de pago
 * (`CronService`), y la baja voluntaria inmediata del flujo de retención del
 * bot ("El valor de lo construido" → opción "borrar todo ya"). El row del
 * usuario se conserva solo como lápida (phoneNumber + status=PURGED) para que
 * un re-registro arranque limpio y quede traza de que existió.
 */
export class AccountPurgeService {
  public static async purgeUser(userId: string): Promise<void> {
    await StorageService.purgeUserData(userId);

    await prisma.scanAuditLog.deleteMany({ where: { userId } });
    await prisma.medicalStudy.deleteMany({ where: { userId } });
    await prisma.emergencyContact.deleteMany({ where: { userId } });
    await prisma.medicationReminder.deleteMany({ where: { userId } });
    await prisma.pushSubscription.deleteMany({ where: { userId } });
    await prisma.paymentOrder.deleteMany({ where: { userId } });
    await prisma.subscription.deleteMany({ where: { userId } });

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        fullName: '[DATOS PURGADOS GDPR]',
        whatsappJid: null,
        ciNumber: null,
        ciFrontUrl: null,
        ciBackUrl: null,
        dateOfBirth: null,
        birthPlace: null,
        sex: null,
        bloodType: null,
        emergencyConditions: null,
        severeAllergies: null,
        contraindicatedMeds: null,
        currentMedications: null,
        address: null,
        email: null,
        photoUrl: null,
        onboardingData: null,
        encryptedMedicalBlob: null,
        encryptionSalt: null,
        recoveryKeyHash: null,
        pinHash: null,
        organizationId: null,
        status: 'PURGED',
        onboardingState: 'PURGED',
      },
      select: { phoneNumber: true },
    });

    await prisma.otpCode.deleteMany({ where: { phoneNumber: user.phoneNumber } }).catch(() => {});
    await prisma.recoveryShard.deleteMany({ where: { userId } }).catch(() => {});
  }
}
