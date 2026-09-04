import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { QrPdfService } from '../services/qr-pdf.service';
import { StorageService } from '../storage/storage.service';
import { AuthenticatedRequest } from '../security/jwt';

export class StickerController {
  public static async downloadStickerPdf(req: Request, res: Response): Promise<void> {
    const { token } = req.params;

    const user = await prisma.user.findUnique({
      where: { emergencyToken: token },
      include: { organization: true },
    });

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    try {
      const sticker = await QrPdfService.generateStickerPdf({
        emergencyToken: user.emergencyToken,
        userName: user.fullName || 'Titular Bio-Pass',
        bloodType: user.bloodType || 'O+',
        organizationName: user.organization?.name,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="BioPass_Sticker_3x3cm_${user.emergencyToken.slice(0, 8)}.pdf"`);
      res.send(sticker.pdfBuffer);
    } catch (err: any) {
      res.status(500).json({ error: 'Error generando PDF de sticker', details: err.message });
    }
  }

  public static async getQrPng(req: Request, res: Response): Promise<void> {
    const { token } = req.params;
    try {
      const qrBuffer = await QrPdfService.generateQrPng(token);
      res.setHeader('Content-Type', 'image/png');
      res.send(qrBuffer);
    } catch (err: any) {
      res.status(500).json({ error: 'Error generando imagen QR', details: err.message });
    }
  }

  public static async updateCoBranding(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { organizationName, primaryColor } = req.body;
    let logoUrl: string | undefined;

    if (req.file) {
      const saved = await StorageService.saveFile('logos', `logo_${Date.now()}_${req.file.originalname}`, req.file.buffer);
      logoUrl = saved.fileUrl;
    }

    const slug = (organizationName || 'org').toLowerCase().replace(/[^a-z0-9]/g, '-');

    const org = await prisma.organization.upsert({
      where: { slug },
      update: {
        name: organizationName,
        logoUrl: logoUrl || undefined,
        primaryColor: primaryColor || '#e11d48',
      },
      create: {
        name: organizationName || 'Mi Empresa / Club',
        slug,
        logoUrl,
        primaryColor: primaryColor || '#e11d48',
      },
    });

    await prisma.user.update({
      where: { id: req.user.userId },
      data: { organizationId: org.id },
    });

    res.json({ success: true, organization: org });
  }
}
