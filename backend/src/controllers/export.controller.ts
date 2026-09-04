import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../security/jwt';
import { ExportService } from '../services/export.service';
import { EmailService } from '../services/email.service';
import { prisma } from '../database/prisma';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

export class ExportController {
  public static async createFullExport(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { pin } = req.body;
    if (!pin || pin.length !== 4) {
      res.status(400).json({ error: 'Debes proporcionar tu PIN de 4 dígitos para cifrar la exportación' });
      return;
    }

    try {
      const result = await ExportService.generateFullDataExport(req.user.userId, pin);

      // Email the download link (best-effort)
      const u = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { email: true, fullName: true },
      });
      let emailed = false;
      if (u?.email) {
        const r = await EmailService.sendVaultBackup(u.email, {
          fullName: u.fullName || '',
          downloadUrl: result.downloadUrl,
          expiresAt: new Date(result.expiresAt),
        }).catch(() => ({ status: 'FAILED' as const }));
        emailed = r.status === 'SENT';
      }

      res.json({
        success: true,
        message: 'Archivo ZIP cifrado generado con éxito. Expira en 24 horas.',
        downloadUrl: result.downloadUrl,
        expiresAt: result.expiresAt,
        filename: result.filename,
        emailed,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Error generando exportación' });
    }
  }

  public static async downloadExportFile(req: Request, res: Response): Promise<void> {
    const { filename } = req.params;
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(config.storage.uploadDir, 'exports', sanitizedFilename);

    if (!fs.existsSync(filePath)) {
      res.status(404).send('Enlace de descarga expirado o archivo no encontrado.');
      return;
    }

    res.download(filePath, sanitizedFilename);
  }
}
