import webpush from 'web-push';
import { prisma } from '../database/prisma';
import { config } from '../config';

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  requireInteraction?: boolean;
  data?: Record<string, unknown>;
}

export interface RawSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  if (!config.push.enabled) return false;
  webpush.setVapidDetails(
    config.push.vapidSubject,
    config.push.vapidPublicKey,
    config.push.vapidPrivateKey
  );
  configured = true;
  return true;
}

export class PushService {
  static get publicKey(): string {
    return config.push.vapidPublicKey;
  }

  static get enabled(): boolean {
    return config.push.enabled;
  }

  /** Upserts a browser subscription, optionally bound to a logged-in user. */
  static async saveSubscription(
    sub: RawSubscription,
    userId?: string,
    userAgent?: string
  ): Promise<void> {
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      throw new Error('Suscripción push inválida');
    }
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, userId: userId ?? undefined, userAgent },
      create: {
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userId: userId ?? null,
        userAgent,
      },
    });
  }

  static async removeSubscription(endpoint: string): Promise<void> {
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  /** Sends a payload to every subscription of a user. Prunes dead endpoints (404/410). */
  static async sendToUser(userId: string, payload: PushPayload): Promise<{ sent: number; pruned: number }> {
    if (!ensureConfigured()) return { sent: 0, pruned: 0 };

    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    let sent = 0;
    let pruned = 0;

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { TTL: 3600, urgency: payload.requireInteraction ? 'high' : 'normal' }
          );
          sent++;
        } catch (err: any) {
          const status = err?.statusCode;
          if (status === 404 || status === 410) {
            await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
            pruned++;
          } else {
            console.warn(`[push] send failed (${status}) to ${s.endpoint.slice(0, 40)}…`, err?.body || err?.message);
          }
        }
      })
    );

    return { sent, pruned };
  }

  /**
   * Paridad con WhatsApp: mismo evento, mismo aviso, en push. `body` puede venir con el
   * formato de WhatsApp (`*negrita*`, `_itálica_`, emojis, saltos de línea) — se limpia
   * para la notificación del navegador. Nunca tira (best-effort, igual que el envío por
   * WhatsApp de al lado no bloquea si push falla, y viceversa).
   */
  static async notify(userId: string, title: string, body: string, opts: Partial<PushPayload> = {}): Promise<void> {
    if (!this.enabled) return;
    const clean = body
      .replace(/[*_`~]/g, '')
      .replace(/\n{2,}/g, ' · ')
      .replace(/\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 180);
    await this.sendToUser(userId, { title, body: clean, ...opts }).catch(() => {});
  }

  /** Emergency-scan alert — high urgency, requires interaction so it stays on screen. */
  static async sendEmergencyAlert(
    userId: string,
    meta: { city: string; country: string; ip: string; time: string }
  ): Promise<void> {
    await this.sendToUser(userId, {
      title: '⚠️ Tu QR Bio-Pass fue escaneado',
      body: `${meta.time} · ${meta.city}, ${meta.country} (IP ${meta.ip}). Si no fuiste tú, contactá a soporte.`,
      tag: 'biopass-scan',
      url: '/audit-logs',
      requireInteraction: true,
      data: { kind: 'EMERGENCY_SCAN', ...meta },
    });
  }
}
