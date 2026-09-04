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

    const studies = await prisma.medicalStudy.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });

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
        ocrRawText: analysis.rawText,
        aiSummary: analysis.aiSummary,
      },
    });

    res.json({
      success: true,
      message: 'Estudio médico procesado y almacenado exitosamente',
      study,
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
      address,
      email,
      encryptedMedicalBlob,
    } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        fullName,
        bloodType,
        emergencyConditions: typeof emergencyConditions === 'object' ? JSON.stringify(emergencyConditions) : emergencyConditions,
        severeAllergies,
        contraindicatedMeds,
        address,
        email,
        encryptedMedicalBlob,
      },
    });

    res.json({ success: true, user });
  }
}
