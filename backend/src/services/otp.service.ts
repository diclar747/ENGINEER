import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../database/prisma';
import { config } from '../config';
import { whatsappBot } from '../whatsapp/baileys.client';
import { OtpPurpose } from '@prisma/client';

export interface OtpDispatchResult {
  sent: boolean;
  channel: 'whatsapp' | 'log';
  expiresAt: Date;
  /** Only populated when OTP_DEV_ECHO=true and NODE_ENV=development — never in production. */
  devCode?: string;
}

export class OtpService {
  private static genCode(): string {
    // 6-digit, uniformly distributed, no modulo bias
    return (crypto.randomInt(0, 1_000_000)).toString().padStart(6, '0');
  }

  /**
   * Creates a fresh OTP, invalidates previous unconsumed ones for the same phone+purpose,
   * and delivers it over WhatsApp (Baileys). Falls back to server log if the bot is offline.
   */
  public static async createAndSend(
    phoneNumber: string,
    purpose: OtpPurpose = 'LOGIN'
  ): Promise<OtpDispatchResult> {
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const code = this.genCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + config.otp.ttlMinutes * 60_000);

    // Invalidate any still-valid codes so only the newest one works
    await prisma.otpCode.updateMany({
      where: { phoneNumber: cleanPhone, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await prisma.otpCode.create({
      data: { phoneNumber: cleanPhone, codeHash, purpose, expiresAt },
    });

    const text =
      `🔐 *Doorway Cortex Bio-Pass*\n\n` +
      `Tu código de verificación es:\n\n*${code}*\n\n` +
      `Vence en ${config.otp.ttlMinutes} minutos. No lo compartas con nadie.\n` +
      `_Si no solicitaste este código, ignora este mensaje._`;

    const delivered = await whatsappBot.sendMessage(cleanPhone, text);
    const botOnline = whatsappBot.getStatus().connected;

    return {
      sent: delivered,
      channel: botOnline ? 'whatsapp' : 'log',
      expiresAt,
      // Populated whenever OTP_DEV_ECHO is on; the controller only exposes it in development.
      devCode: config.otp.devEcho ? code : undefined,
    };
  }

  /**
   * Verifies a submitted code. Consumes it on success; counts attempts and
   * locks the code after OTP_MAX_ATTEMPTS failures.
   */
  public static async verify(
    phoneNumber: string,
    code: string,
    purpose: OtpPurpose = 'LOGIN'
  ): Promise<{ ok: boolean; reason?: string }> {
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const otp = await prisma.otpCode.findFirst({
      where: { phoneNumber: cleanPhone, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) return { ok: false, reason: 'No hay un código activo. Solicitá uno nuevo.' };
    if (otp.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: 'El código expiró. Solicitá uno nuevo.' };
    }
    if (otp.attempts >= config.otp.maxAttempts) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      return { ok: false, reason: 'Demasiados intentos. Solicitá un código nuevo.' };
    }

    const match = await bcrypt.compare(String(code || '').trim(), otp.codeHash);
    if (!match) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      return { ok: false, reason: 'Código incorrecto.' };
    }

    await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    return { ok: true };
  }

  /** Housekeeping — drop expired/consumed codes older than a day. */
  public static async purgeStale(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const res = await prisma.otpCode.deleteMany({
      where: { OR: [{ consumedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
    });
    return res.count;
  }
}
