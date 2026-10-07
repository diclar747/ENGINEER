import { prisma } from '../database/prisma';
import { config } from '../config';
import { whatsappBot } from '../whatsapp/baileys.client';
import { PushService } from './push.service';

/**
 * Promo "traé un cliente y ganá un mes gratis".
 *
 * Cada titular tiene un código propio (BP-XXXXX) y un link de WhatsApp que ya lo
 * lleva escrito. Quien entra con ese código queda anotado como invitado; cuando
 * hace su PRIMER pago, a quien lo invitó se le suma un mes a su suscripción.
 * Un invitado premia una sola vez, y nadie puede invitarse a sí mismo.
 */
export class ReferralService {
  /** Sin 0/O/1/I/L para que no se confundan al dictarlo. */
  private static readonly ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  static readonly CODE_RE = /\bBP[-\s]?([A-HJKMNP-Z2-9]{5})\b/i;

  /** Código "BP-XXXXX" mencionado en un texto, normalizado; null si no hay. */
  static findCode(text: string): string | null {
    const m = (text || '').match(ReferralService.CODE_RE);
    return m ? `BP-${m[1].toUpperCase()}` : null;
  }

  /** Devuelve el código del titular; lo crea la primera vez. */
  static async codeFor(userId: string): Promise<string> {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
    if (u?.referralCode) return u.referralCode;
    for (let i = 0; i < 8; i++) {
      let c = 'BP-';
      for (let j = 0; j < 5; j++) c += ReferralService.ALPHABET[Math.floor(Math.random() * ReferralService.ALPHABET.length)];
      try {
        await prisma.user.update({ where: { id: userId }, data: { referralCode: c } });
        return c;
      } catch {
        /* código repetido → otro intento */
      }
    }
    throw new Error('No se pudo generar el código de invitación');
  }

  /** Link de WhatsApp con el mensaje y el código ya escritos. */
  static inviteLink(code: string): string {
    const text = `Hola! Quiero mi Bio-Pass. Me invitaron con el código ${code}`;
    return `https://wa.me/${config.baileys.botNumber}?text=${encodeURIComponent(text)}`;
  }

  /**
   * Anota quién invitó a este titular. Solo vale mientras todavía no pagó nunca
   * y no tiene ya un invitador. Devuelve el nombre de quien invitó, o null.
   */
  static async attach(userId: string, code: string | null): Promise<string | null> {
    if (!code) return null;
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { referredById: true } });
    if (!me || me.referredById) return null;
    const referrer = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true, fullName: true } });
    if (!referrer || referrer.id === userId) return null;
    const alreadyPaid = await prisma.paymentOrder.count({ where: { userId, status: 'PAID' } });
    if (alreadyPaid) return null;
    await prisma.user.update({ where: { id: userId }, data: { referredById: referrer.id } });
    return (referrer.fullName || '').split(' ')[0] || 'un titular Bio-Pass';
  }

  static async stats(userId: string): Promise<{ invited: number; rewarded: number }> {
    const [invited, rewarded] = await Promise.all([
      prisma.user.count({ where: { referredById: userId } }),
      prisma.user.count({ where: { referredById: userId, referralRewardedAt: { not: null } } }),
    ]);
    return { invited, rewarded };
  }

  /**
   * Llamado al acreditarse el primer pago de `userId`. Si vino invitado, suma un
   * mes a quien lo invitó y le avisa. Devuelve true si se acreditó.
   */
  static async rewardIfDue(userId: string): Promise<boolean> {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, referredById: true, referralRewardedAt: true },
    });
    if (!u?.referredById || u.referralRewardedAt) return false;
    const referrer = await prisma.user.findUnique({ where: { id: u.referredById } });
    if (!referrer || referrer.status === 'PURGED') return false;

    // Marca primero (condicional) para que dos confirmaciones simultáneas no premien doble.
    const claimed = await prisma.user.updateMany({
      where: { id: u.id, referralRewardedAt: null },
      data: { referralRewardedAt: new Date() },
    });
    if (!claimed.count) return false;

    const sub = await prisma.subscription.findFirst({
      where: { userId: referrer.id, status: { in: ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PAUSED'] } },
      orderBy: { expiryDate: 'desc' },
    });
    const base = sub && sub.expiryDate > new Date() ? new Date(sub.expiryDate) : new Date();
    base.setMonth(base.getMonth() + 1);
    if (sub) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { expiryDate: base, status: 'ACTIVE', finePending: false, fineAmount: 0, lastNotification: 'NONE' },
      });
    } else {
      await prisma.subscription.create({
        data: { userId: referrer.id, plan: 'MONTHLY', country: 'PARAGUAY', currency: 'PYG', amount: 0, status: 'ACTIVE', expiryDate: base, lastNotification: 'NONE' },
      });
    }
    // Una cuenta pausada por decisión del titular sigue pausada: el mes queda sumado igual.
    if (referrer.status !== 'PAUSED' && referrer.status !== 'PENDING_PAYMENT') {
      await prisma.user.update({ where: { id: referrer.id }, data: { status: 'ACTIVE' } });
    }

    const hasta = base.toLocaleDateString('es-PY', { timeZone: config.timezone });
    const quien = (u.fullName || '').split(' ')[0] || 'Tu invitado';
    const msg =
      `🎁 *¡Ganaste 1 mes gratis de Bio-Pass!*\n\n` +
      `${quien} se sumó con tu código y ya activó su cuenta.\n` +
      `📅 Tu Bio-Pass ahora está vigente hasta el *${hasta}*.\n\n` +
      `_Seguí invitando: cada persona que se suma con tu código te regala otro mes. Escribí *PROMO* para ver tu link._`;
    PushService.notify(referrer.id, '🎁 Ganaste 1 mes gratis', msg, { tag: 'biopass-referral', url: '/payments' });
    await whatsappBot.sendMessage(referrer.whatsappJid || referrer.phoneNumber, msg).catch(() => false);
    return true;
  }
}
