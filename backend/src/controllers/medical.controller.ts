import { Response } from 'express';
import { AuthenticatedRequest } from '../security/jwt';
import { prisma } from '../database/prisma';
import { StorageService } from '../storage/storage.service';
import { OcrAiService } from '../services/ocr-ai.service';
import { withSignedFileUrl } from '../security/signed-url';
import { ZeroKnowledgeSecurity } from '../security/zero-knowledge';
import { MedicationReminderService } from '../services/medication-reminder.service';

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Anticipación del aviso, en minutos: entero entre 5 y 10080 (7 días); si no, el default. */
function clampLead(raw: unknown, fallback: number): number {
  const n = parseInt(String(raw), 10);
  return n >= 5 && n <= 10080 ? n : fallback;
}

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
    // `fileUrl` sale FIRMADO y con vencimiento: /uploads ya no entrega nada suelto.
    const studies = rows.map((s) => ({
      ...withSignedFileUrl(s),
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

  /**
   * Vigencia del recordatorio tal como la manda el calendario web: desde cuándo
   * empieza a avisar y cuándo para solo. El bot ya la guardaba; acá faltaba, así
   * que la fecha de fin que se elegía en la web no llegaba nunca a la base.
   */
  private static vigenciaFrom(body: any): { startsAt: Date | null; endsAt: Date | null } {
    const parse = (v: unknown): Date | null => {
      if (!v) return null;
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? null : d;
    };
    let endsAt = parse(body?.endsAt);
    if (!endsAt && body?.durationDays && Number(body.durationDays) >= 1 && Number(body.durationDays) <= 1095) {
      endsAt = new Date(Date.now() + Number(body.durationDays) * 86400_000);
    }
    return { startsAt: parse(body?.startsAt), endsAt };
  }

  public static async createReminder(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const kind = req.body?.kind === 'APPOINTMENT' ? 'APPOINTMENT' : 'MED';
    const medication = String(req.body?.medication || '').trim();
    if (!medication) { res.status(400).json({ error: 'Falta el nombre del medicamento o del turno.' }); return; }
    const leadMinutes = clampLead(req.body?.leadMinutes, kind === 'APPOINTMENT' ? 120 : 10);

    if (kind === 'APPOINTMENT') {
      const whenAt = new Date(req.body?.whenAt || '');
      if (isNaN(whenAt.getTime())) { res.status(400).json({ error: 'Fecha/hora de turno inválida.' }); return; }
      const vig = MedicalController.vigenciaFrom(req.body);
      const row = await prisma.medicationReminder.create({
        data: { userId: req.user.userId, kind, medication, whenAt, times: '[]', leadMinutes, ...vig },
      });
      res.json({ reminder: { ...row, times: [] } });
      return;
    }

    const dose = req.body?.dose ? String(req.body.dose).trim() : null;
    const scheduleKind = req.body?.scheduleKind === 'INTERVAL' ? 'INTERVAL' : 'CLOCK';
    const { startsAt, endsAt } = MedicalController.vigenciaFrom(req.body);

    if (scheduleKind === 'INTERVAL') {
      const intervalHours = parseInt(String(req.body?.intervalHours), 10);
      if (!(intervalHours >= 1 && intervalHours <= 720)) { res.status(400).json({ error: 'Intervalo inválido (1 hora a 30 días).' }); return; }
      const anchorAt = req.body?.anchorAt ? new Date(req.body.anchorAt) : new Date();
      if (isNaN(anchorAt.getTime())) { res.status(400).json({ error: 'Fecha de última toma inválida.' }); return; }
      const nextDoseAt = MedicationReminderService.computeNextDose(anchorAt, intervalHours);
      const row = await prisma.medicationReminder.create({
        data: { userId: req.user.userId, kind: 'MED', scheduleKind: 'INTERVAL', medication, dose, times: '[]', intervalHours, anchorAt, nextDoseAt, leadMinutes, startsAt, endsAt },
      });
      res.json({ reminder: { ...row, times: [] } });
      return;
    }

    const times: string[] = Array.isArray(req.body?.times)
      ? req.body.times.map((t: unknown) => String(t).trim()).filter((t: string) => HHMM_RE.test(t))
      : [];
    if (!times.length) { res.status(400).json({ error: 'Agregá al menos un horario válido (HH:MM).' }); return; }
    const row = await prisma.medicationReminder.create({
      data: { userId: req.user.userId, kind: 'MED', scheduleKind: 'CLOCK', medication, dose, times: JSON.stringify(times), leadMinutes, startsAt, endsAt },
    });
    res.json({ reminder: { ...row, times } });
  }

  public static async updateReminder(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const current = await prisma.medicationReminder.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
    if (!current) { res.status(404).json({ error: 'Recordatorio no encontrado.' }); return; }

    const data: any = {};
    if (typeof req.body?.active === 'boolean') data.active = req.body.active;
    if (req.body?.dose !== undefined) data.dose = req.body.dose ? String(req.body.dose).trim() : null;
    if (req.body?.leadMinutes !== undefined) data.leadMinutes = clampLead(req.body.leadMinutes, current.leadMinutes);
    if (req.body?.medication !== undefined) {
      const medication = String(req.body.medication).trim();
      if (!medication) { res.status(400).json({ error: 'El nombre no puede quedar vacío.' }); return; }
      data.medication = medication;
    }
    if (Array.isArray(req.body?.times)) {
      const times = req.body.times.map((t: unknown) => String(t).trim()).filter((t: string) => HHMM_RE.test(t));
      if (!times.length) { res.status(400).json({ error: 'Agregá al menos un horario válido (HH:MM).' }); return; }
      data.times = JSON.stringify(times);
      data.scheduleKind = 'CLOCK';
    }
    if (req.body?.whenAt !== undefined) {
      const whenAt = new Date(req.body.whenAt);
      if (isNaN(whenAt.getTime())) { res.status(400).json({ error: 'Fecha/hora de turno inválida.' }); return; }
      data.whenAt = whenAt;
    }
    // Vigencia. `null` explícito = sacar la fecha (vuelve a ser sin corte); un
    // valor inválido se rechaza en vez de guardarse como null en silencio.
    for (const campo of ['startsAt', 'endsAt'] as const) {
      if (req.body?.[campo] === undefined) continue;
      if (req.body[campo] === null || req.body[campo] === '') {
        data[campo] = null;
        continue;
      }
      const d = new Date(String(req.body[campo]));
      if (isNaN(d.getTime())) { res.status(400).json({ error: `Fecha de ${campo === 'startsAt' ? 'inicio' : 'fin'} inválida.` }); return; }
      data[campo] = d;
    }
    // Volver a poner una fecha de fin futura implica querer recibir los avisos otra
    // vez: sin esto el recordatorio quedaba apagado por el cierre anterior.
    if (data.endsAt instanceof Date && data.endsAt.getTime() > Date.now() && current.lastSentSlot === 'ENDED') {
      data.active = data.active ?? true;
      data.lastSentSlot = null;
    }
    // Cambio de intervalo o "ya tomé" desde la web → recalcular la próxima toma.
    const nextInterval = req.body?.intervalHours !== undefined ? parseInt(String(req.body.intervalHours), 10) : current.intervalHours;
    const nextAnchor = req.body?.anchorAt !== undefined ? new Date(req.body.anchorAt) : current.anchorAt;
    if ((req.body?.intervalHours !== undefined || req.body?.anchorAt !== undefined) && current.scheduleKind === 'INTERVAL') {
      if (!(Number(nextInterval) >= 1 && Number(nextInterval) <= 720)) { res.status(400).json({ error: 'Intervalo inválido (1 hora a 30 días).' }); return; }
      if (!nextAnchor || isNaN(new Date(nextAnchor).getTime())) { res.status(400).json({ error: 'Fecha de última toma inválida.' }); return; }
      data.intervalHours = Number(nextInterval);
      data.anchorAt = new Date(nextAnchor);
      data.nextDoseAt = MedicationReminderService.computeNextDose(new Date(nextAnchor), Number(nextInterval));
      data.lastSentSlot = null;
    }

    if (!Object.keys(data).length) { res.status(400).json({ error: 'Nada para actualizar.' }); return; }
    await prisma.medicationReminder.update({ where: { id: current.id }, data });
    const row = await prisma.medicationReminder.findUnique({ where: { id: current.id } });
    res.json({ reminder: row ? { ...row, times: JSON.parse(row.times || '[]') } : null });
  }

  public static async deleteReminder(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const r = await prisma.medicationReminder.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    if (!r.count) { res.status(404).json({ error: 'Recordatorio no encontrado.' }); return; }
    res.json({ ok: true });
  }
}
