import { Response } from 'express';
import { AuthenticatedRequest } from '../security/jwt';
import { prisma } from '../database/prisma';
import { StorageService } from '../storage/storage.service';
import { OcrAiService } from '../services/ocr-ai.service';
import { ZeroKnowledgeSecurity } from '../security/zero-knowledge';

export class MedicalController {
  public static async getStudies(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rows = await prisma.medicalStudy.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });
    // ocrRawText/aiSummary van cifrados at-rest (clave KMS del server) → se descifran al vuelo.
    const studies = rows.map((s) => ({
      ...s,
      ocrRawText: ZeroKnowledgeSecurity.kmsDecrypt(s.ocrRawText),
      aiSummary: ZeroKnowledgeSecurity.kmsDecrypt(s.aiSummary),
    }));

    res.json({ studies });
  }

  public static async uploadStudy(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Archivo médico no adjuntado' });
      return;
    }

    const saved = await StorageService.saveFile(
      'medical_studies',
      `web_study_${req.user.userId}_${Date.now()}_${file.originalname}`,
      file.buffer
    );

    // AI & OCR Analysis
    const analysis = await OcrAiService.processMedicalStudy(file.buffer, file.originalname);

    const study = await prisma.medicalStudy.create({
      data: {
        userId: req.user.userId,
        title: req.body.title || analysis.title,
        studyType: analysis.studyType,
        studyDate: req.body.studyDate ? new Date(req.body.studyDate) : new Date(),
        fileUrl: saved.fileUrl,
        ocrRawText: ZeroKnowledgeSecurity.kmsEncrypt(analysis.rawText),
        aiSummary: ZeroKnowledgeSecurity.kmsEncrypt(analysis.aiSummary),
        contentEncrypted: !!process.env.KMS_KEY,
      },
    });

    res.json({
      success: true,
      message: 'Estudio médico procesado y almacenado exitosamente',
      study: { ...study, ocrRawText: analysis.rawText, aiSummary: analysis.aiSummary },
    });
  }

  public static async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      fullName,
      bloodType,
      emergencyConditions,
      severeAllergies,
      contraindicatedMeds,
      currentMedications,
      address,
      email,
      encryptedMedicalBlob,
    } = req.body;

    // currentMedications llega como array desde la web; se guarda como JSON string.
    // `undefined` = no tocar; array vacío / string = sobrescribir.
    let medsValue: string | undefined;
    if (currentMedications !== undefined) {
      medsValue = Array.isArray(currentMedications)
        ? JSON.stringify(
            currentMedications
              .filter((m: any) => m && String(m.name || '').trim())
              .map((m: any) => ({
                name: String(m.name).trim(),
                dose: m.dose ? String(m.dose).trim() : undefined,
                frequency: m.frequency ? String(m.frequency).trim() : undefined,
                since: m.since ? String(m.since).trim() : undefined,
                source: ['manual', 'receta', 'photo'].includes(m.source) ? m.source : 'manual',
                addedAt: m.addedAt || new Date().toISOString(),
              }))
          )
        : String(currentMedications);
    }

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        fullName,
        bloodType,
        emergencyConditions: typeof emergencyConditions === 'object' ? JSON.stringify(emergencyConditions) : emergencyConditions,
        severeAllergies,
        contraindicatedMeds,
        ...(medsValue !== undefined ? { currentMedications: medsValue } : {}),
        address,
        email,
        encryptedMedicalBlob,
      },
    });

    res.json({ success: true, user });
  }
}
