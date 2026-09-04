import path from 'path';
import fs from 'fs';
import { createWorker, Worker } from 'tesseract.js';
import { config } from '../config';
import { AiVisionService } from './ai-vision.service';

export interface CiOcrResult {
  fullName?: string;
  ciNumber?: string;
  dateOfBirth?: string;
  birthPlace?: string;
  nationality?: string;
  sex?: string;
  rawText: string;
  source: 'ai+ocr' | 'ocr' | 'none';
}

export interface MedicalStudyOcrResult {
  title: string;
  studyType: 'LABORATORY' | 'XRAY' | 'TOMOGRAPHY' | 'PRESCRIPTION' | 'CARDIOLOGY' | 'OTHER';
  studyDate?: Date;
  rawText: string;
  aiSummary: string;
  keyFindings: string[];
  source: 'ai+ocr' | 'ocr' | 'none';
}

const STUDY_TYPES: MedicalStudyOcrResult['studyType'][] = [
  'LABORATORY',
  'XRAY',
  'TOMOGRAPHY',
  'PRESCRIPTION',
  'CARDIOLOGY',
  'OTHER',
];

/** Lazily-created, reused Tesseract worker (worker creation is expensive). */
class OcrWorker {
  private static worker: Worker | null = null;
  private static creating: Promise<Worker> | null = null;

  static async get(): Promise<Worker> {
    if (this.worker) return this.worker;
    if (this.creating) return this.creating;

    const cachePath = path.resolve(config.storage.uploadDir, '..', '.tess-cache');
    if (!fs.existsSync(cachePath)) fs.mkdirSync(cachePath, { recursive: true });

    this.creating = createWorker(config.ocr.langs, 1, {
      cachePath,
      logger: () => {},
      errorHandler: (e) => console.warn('[tesseract]', e),
    }).then((w) => {
      this.worker = w;
      this.creating = null;
      return w;
    });
    return this.creating;
  }

  static async recognize(buffer: Buffer): Promise<string> {
    const w = await this.get();
    const { data } = await w.recognize(buffer);
    return (data.text || '').trim();
  }
}

async function runOcr(buffer: Buffer, filename: string): Promise<string> {
  if (!config.ocr.enabled) return '';
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return ''; // Tesseract needs a raster; PDFs are handled by AI vision or skipped
  try {
    return await OcrWorker.recognize(buffer);
  } catch (err: any) {
    console.warn('[ocr] recognize failed:', err?.message || err);
    return '';
  }
}

function guessMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.png' ? 'image/png' : ext === '.pdf' ? 'application/pdf' : 'image/jpeg';
}

export class OcrAiService {
  /**
   * OCR + optional AI interpretation of a Cédula de Identidad.
   * Real pipeline: Tesseract text extraction → regex parse; if an AI vision provider
   * is configured, it also asks the model for structured fields and prefers those.
   */
  public static async processCiImage(imageBuffer: Buffer, filename: string): Promise<CiOcrResult> {
    const rawText = await runOcr(imageBuffer, filename);

    // Regex heuristics over the OCR text (Paraguay / Brasil cédula layouts)
    const ciMatch =
      rawText.match(/(?:\bC[ÉE]DULA\b|\bC\.?I\.?\b|\bNRO\.?\b|\bN[ÚU]MERO\b|\bDOCUMENTO\b|\bRG\b|\bCPF\b)[^\d]{0,12}([\d][\d.\s-]{5,12}\d)/i) ||
      rawText.match(/\b(\d{1,3}(?:[.\s]\d{3}){1,2})\b/);
    const nameMatch =
      rawText.match(/(?:APELLIDOS?\s*Y\s*NOMBRES?|NOMBRE\s*Y\s*APELLIDO|NOME|TITULAR|NOMBRES?)[\s:.\-]*\n?([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'\s]{4,60})/i);
    const dobMatch = rawText.match(/(\d{2}[/.\-]\d{2}[/.\-]\d{4})/);

    let result: CiOcrResult = {
      fullName: nameMatch ? nameMatch[1].replace(/\s+/g, ' ').trim() : undefined,
      ciNumber: ciMatch ? ciMatch[1].replace(/[^\d]/g, '') : undefined,
      dateOfBirth: dobMatch ? dobMatch[1] : undefined,
      nationality: /PARAGUAY/i.test(rawText) ? 'PARAGUAYA' : /BRASIL|BRASILEIR/i.test(rawText) ? 'BRASILEIRA' : undefined,
      rawText,
      source: config.ocr.enabled ? 'ocr' : 'none',
    };

    if (AiVisionService.available) {
      const ai = await AiVisionService.extractJson(
        imageBuffer,
        guessMime(filename),
        'Extraé TODOS los datos legibles de este documento de identidad (Cédula de Identidad de Paraguay o Brasil), ' +
          'de ambos lados si se ven. El usuario NO va a volver a escribir estos datos — tienen que salir completos de acá. ' +
          'Devolvé JSON con las claves: fullName (nombre completo tal cual figura), ciNumber (solo dígitos, sin puntos), ' +
          'dateOfBirth (fecha de nacimiento, formato DD/MM/YYYY), birthPlace (lugar de nacimiento: ciudad/departamento tal cual figura), ' +
          'nationality (ej. PARAGUAYA, BRASILEIRA), sex (M o F si figura). Si un dato no está visible, usá null — no inventes nada.'
      );
      if (ai) {
        result = {
          fullName: (ai.fullName && String(ai.fullName).trim()) || result.fullName,
          ciNumber: (ai.ciNumber && String(ai.ciNumber).replace(/[^\d]/g, '')) || result.ciNumber,
          dateOfBirth: (ai.dateOfBirth && String(ai.dateOfBirth).trim()) || result.dateOfBirth,
          birthPlace: (ai.birthPlace && String(ai.birthPlace).trim()) || undefined,
          nationality: (ai.nationality && String(ai.nationality).trim()) || result.nationality,
          sex: (ai.sex && String(ai.sex).trim().toUpperCase().slice(0, 1)) || undefined,
          rawText,
          source: 'ai+ocr',
        };
      }
    }

    return result;
  }

  /**
   * OCR + AI classification of a medical study (blood panel, X-ray, tomography, prescription…).
   */
  public static async processMedicalStudy(
    imageBuffer: Buffer,
    filename: string
  ): Promise<MedicalStudyOcrResult> {
    const rawText = await runOcr(imageBuffer, filename);

    // Heuristic classification from the OCR text itself (not the filename)
    const hay = `${rawText}\n${filename}`.toLowerCase();
    let studyType: MedicalStudyOcrResult['studyType'] = 'OTHER';
    if (/hemograma|glucosa|colesterol|urea|creatinina|laboratorio|análisis de sangre|hematolog|orina/i.test(hay)) studyType = 'LABORATORY';
    else if (/radiograf|rayos\s*x|x-?ray|placa de t[oó]rax/i.test(hay)) studyType = 'XRAY';
    else if (/tomograf|tac\b|scanner|resonancia|rmn/i.test(hay)) studyType = 'TOMOGRAPHY';
    else if (/receta|prescripci[oó]n|indicaci[oó]n m[eé]dica|rp\/|tomar cada/i.test(hay)) studyType = 'PRESCRIPTION';
    else if (/electrocardiograma|ecg\b|ekg\b|holter|ecocardio|cardiolog/i.test(hay)) studyType = 'CARDIOLOGY';

    const dateMatch = rawText.match(/(\d{2}[/.\-]\d{2}[/.\-]\d{2,4})/);
    let studyDate: Date | undefined;
    if (dateMatch) {
      const [d, m, y] = dateMatch[1].split(/[/.\-]/);
      const yy = y.length === 2 ? `20${y}` : y;
      const parsed = new Date(`${yy}-${m}-${d}T00:00:00`);
      if (!isNaN(parsed.getTime())) studyDate = parsed;
    }

    const firstLines = rawText.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8);
    let title =
      firstLines.find((l) => l.length > 8 && l.length < 80 && /[a-záéíóú]/i.test(l)) ||
      {
        LABORATORY: 'Análisis Clínico de Laboratorio',
        XRAY: 'Estudio Radiográfico',
        TOMOGRAPHY: 'Tomografía Computarizada',
        PRESCRIPTION: 'Receta / Prescripción Médica',
        CARDIOLOGY: 'Estudio Cardiológico',
        OTHER: 'Documento Médico',
      }[studyType];

    let aiSummary = rawText
      ? `Documento procesado por OCR (${rawText.length} caracteres extraídos). Clasificado como ${studyType}.`
      : 'No se pudo extraer texto; documento almacenado en la bóveda cifrada.';
    let keyFindings: string[] = [];
    let source: MedicalStudyOcrResult['source'] = config.ocr.enabled ? 'ocr' : 'none';

    if (AiVisionService.available) {
      const ai = await AiVisionService.extractJson(
        imageBuffer,
        guessMime(filename),
        'Analizá este estudio o documento médico. Devolvé JSON con: ' +
          `studyType (uno de: ${STUDY_TYPES.join(', ')}), ` +
          'title (nombre corto del estudio en español), ' +
          'studyDate (DD/MM/YYYY si es visible, si no null), ' +
          'aiSummary (2-3 frases, resumen clínico en español para un médico de emergencia), ' +
          'keyFindings (array de strings con los valores/hallazgos más relevantes). ' +
          'No inventes datos que no estén en la imagen.'
      );
      if (ai) {
        const t = String(ai.studyType || '').toUpperCase();
        if ((STUDY_TYPES as string[]).includes(t)) studyType = t as MedicalStudyOcrResult['studyType'];
        if (ai.title) title = String(ai.title).trim();
        if (ai.aiSummary) aiSummary = String(ai.aiSummary).trim();
        if (Array.isArray(ai.keyFindings)) keyFindings = ai.keyFindings.map((x: any) => String(x)).slice(0, 12);
        if (ai.studyDate && /\d{2}[/.\-]\d{2}[/.\-]\d{2,4}/.test(String(ai.studyDate))) {
          const [d, m, y] = String(ai.studyDate).split(/[/.\-]/);
          const yy = y.length === 2 ? `20${y}` : y;
          const parsed = new Date(`${yy}-${m}-${d}T00:00:00`);
          if (!isNaN(parsed.getTime())) studyDate = parsed;
        }
        source = 'ai+ocr';
      }
    }

    return { title, studyType, studyDate, rawText, aiSummary, keyFindings, source };
  }

  /** Free the OCR worker (called on graceful shutdown / tests). */
  public static async dispose(): Promise<void> {
    // @ts-expect-error accessing the private static for cleanup
    const w = OcrWorker.worker as Worker | null;
    if (w) await w.terminate();
  }
}
