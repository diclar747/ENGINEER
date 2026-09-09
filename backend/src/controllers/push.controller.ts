import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../security/jwt';
import { PushService } from '../services/push.service';
import { prisma } from '../database/prisma';

export class PushController {
  /** Public — the browser needs this to build a subscription. */
  static getVapidPublicKey(_req: Request, res: Response): void {
    res.json({ enabled: PushService.enabled, publicKey: PushService.publicKey || null });
  }

  /**
   * Register a browser push subscription. Works anonymously (emergency-card viewers),
   * bound to the logged-in user when an Authorization header is present, or bound via
   * `emergencyToken` — the link the bot sends by WhatsApp (`/push/:emergencyToken`) for
   * members who only ever registered by chat and never logged into the web with their PIN.
   */
  static async subscribe(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!PushService.enabled) {
      res.status(503).json({ error: 'Web Push no está configurado en el servidor (faltan claves VAPID).' });
      return;
    }
    const { subscription, emergencyToken } = req.body;
    let userId = req.user?.userId;
    if (!userId && emergencyToken) {
      const u = await prisma.user.findUnique({ where: { emergencyToken: String(emergencyToken) }, select: { id: true } });
      userId = u?.id;
    }
    try {
      await PushService.saveSubscription(
        subscription,
        userId,
        req.headers['user-agent'] as string | undefined
      );
      res.json({ success: true, bound: !!userId });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'No se pudo registrar la suscripción' });
    }
  }

  static async unsubscribe(req: Request, res: Response): Promise<void> {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ error: 'endpoint requerido' });
      return;
    }
    await PushService.removeSubscription(endpoint);
    res.json({ success: true });
  }

  /** Fire a test notification to the current user's devices. */
  static async test(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await PushService.sendToUser(req.user.userId, {
      title: '🔔 Bio-Pass — notificaciones activas',
      body: 'Recibirás una alerta aquí cada vez que alguien escanee tu QR de emergencia.',
      tag: 'biopass-test',
      url: '/dashboard',
    });
    res.json({ success: true, ...result });
  }
}
