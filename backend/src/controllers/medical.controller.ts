import { Response } from 'express';
import { AuthenticatedRequest } from '../security/jwt';
import { prisma } from '../database/prisma';
import { StorageService } from '../storage/storage.service';
import { OcrAiService } from '../services/ocr-ai.service';
import { ZeroKnowledgeSecurity } from '../security/zero-knowledge';

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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

  // ---- Recordatorios de medicación / turnos (calendario del titular en la web) ----
  // El bot de WhatsApp ya podía crear/leer/borrar estos mismos registros por
  // chat (MedicationReminder); acá se exponen para que el titular los vea y
  // programe también desde su bóveda web, no solo por WhatsApp.
  public static async getReminders(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const rows = await prisma.medicationReminder.findMany({
      where: { userId: req.user.userId },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ reminders: rows.map((r) => ({ ...r, times: JSON.parse(r.times || '[]') })) });
  }

  public static async createReminder(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const kind = req.body?.kind === 'APPOINTMENT' ? 'APPOINTMENT' : 'MED';
    const medication = String(req.body?.medication || '').trim();
    if (!medication) { res.status(400).json({ error: 'Falta el nombre del medicamento o del turno.' }); return; }

    if (kind === 'APPOINTMENT') {
      const whenAt = new Date(req.body?.whenAt || '');
      if (isNaN(whenAt.getTime())) { res.status(400).json({ error: 'Fecha/hora de turno inválida.' }); return; }
      const row = await prisma.medicationReminder.create({
        data: { userId: req.user.userId, kind, medication, whenAt, times: '[]' },
      });
      res.json({ reminder: { ...row, times: [] } });
      return;
    }

    const times: string[] = Array.isArray(req.body?.times)
      ? req.body.times.map((t: unknown) => String(t).trim()).filter((t: string) => HHMM_RE.test(t))
      : [];
    if (!times.length) { res.status(400).json({ error: 'Agregá al menos un horario válido (HH:MM).' }); return; }
    const dose = req.body?.dose ? String(req.body.dose).trim() : null;
    const row = await prisma.medicationReminder.create({
      data: { userId: req.user.userId, kind: 'MED', medication, dose, times: JSON.stringify(times) },
    });
    res.json({ reminder: { ...row, times } });
  }

  public static async updateReminder(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const data: any = {};
    if (typeof req.body?.active === 'boolean') data.active = req.body.active;
    if (req.body?.dose !== undefined) data.dose = req.body.dose ? String(req.body.dose).trim() : null;
    if (req.body?.medication !== undefined) {
      const medication = String(req.body.medication).trim();
      if (!medication) { res.status(400).json({ error: 'El nombre no puede quedar vacío.' }); return; }
      data.medication = medication;
    }
    if (Array.isArray(req.body?.times)) {
      const times = req.body.times.map((t: unknown) => String(t).trim()).filter((t: string) => HHMM_RE.test(t));
      if (!times.length) { res.status(400).json({ error: 'Agregá al menos un horario válido (HH:MM).' }); return; }
      data.times = JSON.stringify(times);
    }
    if (req.body?.whenAt !== undefined) {
      const whenAt = new Date(req.body.whenAt);
      if (isNaN(whenAt.getTime())) { res.status(400).json({ error: 'Fecha/hora de turno inválida.' }); return; }
      data.whenAt = whenAt;
    }
    if (!Object.keys(data).length) { res.status(400).json({ error: 'Nada para actualizar.' }); return; }
    const r = await prisma.medicationReminder.updateMany({ where: { id: req.params.id, userId: req.user.userId }, data });
    if (!r.count) { res.status(404).json({ error: 'Recordatorio no encontrado.' }); return; }
    const row = await prisma.medicationReminder.findUnique({ where: { id: req.params.id } });
    res.json({ reminder: row ? { ...row, times: JSON.parse(row.times || '[]') } : null });
  }

  public static async deleteReminder(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const r = await prisma.medicationReminder.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    if (!r.count) { res.status(404).json({ error: 'Recordatorio no encontrado.' }); return; }
    res.json({ ok: true });
  }
}
