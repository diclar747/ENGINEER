import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { StorageService } from '../storage/storage.service';

export interface StickerOptions {
  emergencyToken: string;
  userName: string;
  bloodType?: string;
  organizationName?: string;
  organizationLogoPath?: string;
}

export class QrPdfService {
  /**
   * Generates a high-res data URL or PNG buffer of the emergency QR code
   */
  public static async generateQrPng(emergencyToken: string): Promise<Buffer> {
    const emergencyUrl = `${config.publicEmergencyBaseUrl}/${emergencyToken}`;
    return QRCode.toBuffer(emergencyUrl, {
      errorCorrectionLevel: 'H',
      type: 'png',
      margin: 1,
      width: 600,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
  }

  /**
   * Generates 3x3 cm Sticker PDF with bleed (sangrado), crop marks, co-branding and print guidelines
   * 1 cm = 28.3464 points in PDFKit
   * 3x3 cm = 85.04 x 85.04 pt
   * With 3mm bleed on each side (6mm total = 17 pt), total canvas = 102.04 x 102.04 pt
   * We also create a printable A4 or US Letter sheet with multiple 3x3 stickers + graphic instructions!
   */
  public static async generateStickerPdf(options: StickerOptions): Promise<{ pdfBuffer: Buffer; fileUrl: string; filename: string }> {
    const emergencyUrl = `${config.publicEmergencyBaseUrl}/${options.emergencyToken}`;
    const qrBuffer = await this.generateQrPng(options.emergencyToken);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 30,
          info: {
            Title: `Bio-Pass Emergency Sticker - ${options.userName}`,
            Author: 'Doorway Cortex Bio-Pass System',
            Subject: '3x3cm Waterproof Contact Vinyl Sticker Sheet',
          },
        });

        const buffers: Buffer[] = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', async () => {
          const pdfBuffer = Buffer.concat(buffers);
          const filename = `sticker_${options.emergencyToken}.pdf`;
          const saved = await StorageService.saveFile('qr_stickers', filename, pdfBuffer);
          resolve({
            pdfBuffer,
            fileUrl: saved.fileUrl,
            filename,
          });
        });

        // Header / Branding
        doc.rect(30, 30, 535, 45).fill('#0f172a');
        doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold')
           .text('DOORWAY CORTEX BIO-PASS', 45, 42);
        doc.fontSize(9).font('Helvetica')
           .text('KIT FÍSICO DE EMERGENCIA & STICKERS ADHESIVOS (3x3 CM)', 45, 60);

        // Subtitle / User info
        doc.fillColor('#1e293b').fontSize(11).font('Helvetica-Bold')
           .text(`Titular: ${options.userName.toUpperCase()}`, 30, 90);
        doc.fontSize(10).font('Helvetica')
           .text(`Grupo Sanguíneo: ${options.bloodType || 'Registrado'}   |   Token: ${options.emergencyToken.slice(0, 8)}...`, 30, 105);

        // Co-branding tag if present
        if (options.organizationName) {
          doc.fillColor('#e11d48').fontSize(9).font('Helvetica-Bold')
             .text(`Entidad Asociada: ${options.organizationName.toUpperCase()}`, 380, 90, { align: 'right', width: 185 });
        }

        // Divider
        doc.moveTo(30, 125).lineTo(565, 125).strokeColor('#cbd5e1').stroke();

        // 3x3 cm Sticker Layout Grid (Showing 4 printable stickers with crop marks)
        // 3cm in points = 85.04pt
        const stickerSize = 85.04;
        const bleed = 8.5; // ~3mm bleed
        const startX = 50;
        const startY = 145;

        // Draw 3x3cm Sticker 1 (Card format with Header, QR and Blood type)
        for (let i = 0; i < 4; i++) {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const x = startX + col * (stickerSize + 80);
          const y = startY + row * (stickerSize + 70);

          // Bleed area (dashed guide for cutting)
          doc.rect(x - bleed, y - bleed, stickerSize + bleed * 2, stickerSize + bleed * 2)
             .dash(3, { space: 2 })
             .strokeColor('#94a3b8')
             .stroke();

          // Cut line 3x3 cm
          doc.rect(x, y, stickerSize, stickerSize)
             .undash()
             .fillAndStroke('#ffffff', '#e11d48');

          // Header band inside sticker
          doc.rect(x, y, stickerSize, 14).fill('#e11d48');
          doc.fillColor('#ffffff').fontSize(6).font('Helvetica-Bold')
             .text('EMERGENCIA BIO-PASS', x, y + 4, { width: stickerSize, align: 'center' });

          // QR Image inside sticker
          doc.image(qrBuffer, x + (stickerSize - 54) / 2, y + 16, { width: 54, height: 54 });

          // Footer inside sticker (RH + Logo note)
          doc.rect(x, y + stickerSize - 13, stickerSize, 13).fill('#0f172a');
          doc.fillColor('#ffffff').fontSize(5.5).font('Helvetica-Bold')
             .text(`RH: ${options.bloodType || 'VER FICHA'}  |  SCAN ME`, x, y + stickerSize - 10, { width: stickerSize, align: 'center' });

          // Label
          doc.fillColor('#64748b').fontSize(7).font('Helvetica')
             .text(`Sticker #${i + 1} (3x3 cm + sangrado)`, x, y + stickerSize + bleed + 4, { width: stickerSize, align: 'center' });
        }

        // Instructions & Recommendations Box
        const boxY = 460;
        doc.rect(30, boxY, 535, 300).fillAndStroke('#f8fafc', '#e2e8f0');

        doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
           .text('RECOMENDACIONES DE USO E IMPRESIÓN (KIT FÍSICO)', 45, boxY + 15);

        doc.fillColor('#334155').fontSize(9).font('Helvetica');
        
        const bulletPoints = [
          '📌 Formato de Impresión: Imprimir en papel Contact (vinilo adhesivo laminado) resistente al agua, rayos UV y a la abrasión.',
          '📌 Tamaño Final: 3x3 cm. La hoja incluye marcas de corte (crop marks) y sangrado de 3mm para guillotina o troquel.',
          '📱 Ubicación #1 (Celular): Coloca este sticker en la parte trasera de tu celular o funda para acceso inmediato.',
          '👷 Ubicación #2 (Casco): En tu casco de seguridad industrial o deportivo para brigadistas y primeros auxilios.',
          '💼 Ubicación #3 (Billetera): Pégalo en tu carnet corporativo o dentro de tu billetera junto a tu Cédula de Identidad.',
          '🔒 Seguridad: El QR no expone datos sensibles privados. Solo muestra información crítica de rescate y activa llamadas a tu contacto.',
          '🌐 URL Pública de Emergencia:',
        ];

        let currentY = boxY + 38;
        for (const point of bulletPoints) {
          doc.text(point, 45, currentY, { width: 500 });
          currentY += 18;
        }

        doc.fillColor('#2563eb').fontSize(9).font('Helvetica-Bold')
           .text(emergencyUrl, 45, currentY + 5, { link: emergencyUrl, underline: true });

        // Watermark / Security seal
        doc.rect(30, 780, 535, 30).fill('#0f172a');
        doc.fillColor('#94a3b8').fontSize(7.5).font('Helvetica')
           .text('DOORWAY CORTEX BIO-PASS • ZERO-KNOWLEDGE ENCRYPTED HEALTH PASSPORT • PROTOCOLO ISO 27001 / GDPR / LGPD', 30, 791, { align: 'center', width: 535 });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
