import { Response } from 'express';
import { prisma } from '../database/prisma';
import { AuthenticatedRequest } from '../security/jwt';

export class AuditController {
  static async listMine(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    try {
      const logs = await prisma.scanAuditLog.findMany({
        where: { userId: req.user.userId },
        orderBy: { scannedAt: 'desc' },
        take: 200,
        select: {
          id: true,
          scannedAt: true,
          ipAddress: true,
          userAgent: true,
          mode: true,
          city: true,
          country: true,
          gpsFixed: true,
          alertSentViaWhatsApp: true,
        },
      });
      res.json({ logs });
    } catch (error) {
      console.error('[audit] No se pudo cargar el historial', error);
      res.status(500).json({ error: 'No se pudo cargar el historial de accesos.' });
    }
  }
}
