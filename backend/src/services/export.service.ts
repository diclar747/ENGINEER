import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { prisma } from '../database/prisma';
import { StorageService } from '../storage/storage.service';
import { config } from '../config';
import { EXPORT_URL_TTL_SECONDS, signPath } from '../security/signed-url';
import { ZeroKnowledgeSecurity } from '../security/zero-knowledge';

// Register zip encrypt plugin if available
try {
  const archiverZipEncrypted = require('archiver-zip-encrypted');
  archiver.registerFormat('zip-encrypted', archiverZipEncrypted);
} catch (e) {
  // fallback if optional
}

export class ExportService {
  /**
   * A stored fileUrl always looks like `${config.baseUrl}/uploads/<folder>/<name>`
   * (see StorageService.saveFile) — map it back to the file actually on disk.
   */
  private static resolveLocalPath(fileUrl: string | null | undefined): string | null {
    if (!fileUrl) return null;
    const marker = '/uploads/';
    const idx = fileUrl.indexOf(marker);
    if (idx === -1) return null;
    const relative = fileUrl.slice(idx + marker.length);
    const resolved = path.join(config.storage.uploadDir, relative);
    if (!resolved.startsWith(config.storage.uploadDir)) return null; // guard against path traversal
    return fs.existsSync(resolved) ? resolved : null;
  }

  /**
   * Generates a password-protected ZIP containing all user files, studies and audit logs
   * The password is the user's 4-digit PIN.
   * Download link expires in 24 hours.
   */
  public static async generateFullDataExport(userId: string, pin: string): Promise<{ downloadUrl: string; expiresAt: Date; filename: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        emergencyContacts: true,
        medicalStudies: true,
        auditLogs: true,
        subscriptions: true,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Verify PIN against stored hash
    if (user.pinHash) {
      const isPinValid = await ZeroKnowledgeSecurity.verifyPin(pin, user.pinHash);
      if (!isPinValid) {
        throw new Error('Invalid PIN. Cannot decrypt and package records.');
      }
    }

    const timestamp = Date.now();
    const filename = `biopass_vault_${user.id}_${timestamp}.zip`;
    const exportFolder = path.join(config.storage.uploadDir, 'exports');
    if (!fs.existsSync(exportFolder)) {
      fs.mkdirSync(exportFolder, { recursive: true });
    }
    const outputPath = path.join(exportFolder, filename);
    const output = fs.createWriteStream(outputPath);

    // Decrypt medical data if present
    let decryptedMedicalInfo = 'No encrypted blob found.';
    if (user.encryptedMedicalBlob && user.encryptionSalt) {
      try {
        decryptedMedicalInfo = ZeroKnowledgeSecurity.decryptWithPin(user.encryptedMedicalBlob, pin, user.encryptionSalt);
      } catch {
        decryptedMedicalInfo = 'Could not decrypt blob with provided key.';
      }
    }

    const manifest = {
      exportDate: new Date().toISOString(),
      system: 'Doorway Cortex Bio-Pass System',
      security: 'Zero-Knowledge AES-256 Protected Vault',
      patientInfo: {
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        ciNumber: user.ciNumber,
        bloodType: user.bloodType,
        emergencyConditions: user.emergencyConditions,
        severeAllergies: user.severeAllergies,
        contraindicatedMeds: user.contraindicatedMeds,
        address: user.address,
        email: user.email,
      },
      decryptedMedicalHistory: decryptedMedicalInfo,
      emergencyContacts: user.emergencyContacts,
      medicalStudiesCount: user.medicalStudies.length,
      medicalStudies: user.medicalStudies.map((s) => ({
        title: s.title,
        studyType: s.studyType,
        studyDate: s.studyDate,
        fileUrl: s.fileUrl,
        aiSummary: ZeroKnowledgeSecurity.kmsDecrypt(s.aiSummary),
        ocrRawText: ZeroKnowledgeSecurity.kmsDecrypt(s.ocrRawText),
        createdAt: s.createdAt,
      })),
      auditLogsCount: user.auditLogs.length,
    };

    return new Promise((resolve, reject) => {
      // Create encrypted zip archive with PIN as encryption password
      // `encryptionMethod` / `password` come from the archiver-zip-encrypted plugin,
      // which is not covered by archiver's built-in ArchiverOptions typings.
      const archive = archiver.create('zip-encrypted', {
        zlib: { level: 9 },
        encryptionMethod: 'aes256',
        password: pin,
      } as archiver.ArchiverOptions & { encryptionMethod: string; password: string });

      output.on('close', () => {
        // Firmada y con vencimiento. Antes el `token` era el de emergencia (público,
        // el del QR) y encima el endpoint ni lo miraba: cualquiera con el nombre del
        // archivo se bajaba el export completo del titular.
        const { exp, sig } = signPath(`exports/${filename}`, EXPORT_URL_TTL_SECONDS);
        const downloadUrl = `${config.baseUrl}/api/export/download/${filename}?exp=${exp}&sig=${sig}`;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        resolve({
          downloadUrl,
          expiresAt,
          filename,
        });
      });

      archive.on('error', (err) => {
        // Never fall back to an unencrypted zip for medical data — surface the error instead.
        output.destroy();
        fs.unlink(outputPath, () => undefined);
        reject(err);
      });

      archive.pipe(output);

      // Append manifest and logs
      archive.append(JSON.stringify(manifest, null, 2), { name: 'HISTORIAL_MEDICO_OFICIAL.json' });
      archive.append(JSON.stringify(user.auditLogs, null, 2), { name: 'REGISTRO_FORENSE_ESCANEO.json' });

      // Append the real documents, not just their metadata — this is what makes the
      // export "portable": identity photos + every uploaded study, actually inside the zip.
      const ciFront = this.resolveLocalPath(user.ciFrontUrl);
      if (ciFront) archive.file(ciFront, { name: `documentos_identidad/cedula_frente${path.extname(ciFront)}` });
      const ciBack = this.resolveLocalPath(user.ciBackUrl);
      if (ciBack) archive.file(ciBack, { name: `documentos_identidad/cedula_dorso${path.extname(ciBack)}` });

      let missingStudyFiles = 0;
      for (const study of user.medicalStudies) {
        const localPath = this.resolveLocalPath(study.fileUrl);
        if (!localPath) {
          missingStudyFiles++;
          continue;
        }
        const safeTitle = (study.title || study.studyType || 'estudio').replace(/[\\/:*?"<>|]+/g, '_');
        const dateTag = study.studyDate ? new Date(study.studyDate).toISOString().slice(0, 10) : study.createdAt.toISOString().slice(0, 10);
        archive.file(localPath, { name: `estudios_medicos/${dateTag}_${safeTitle}${path.extname(localPath)}` });
      }

      // Add readme explanation
      archive.append(
        `DOORWAY CORTEX BIO-PASS - EXPEDIENTE CLINICO PORTABLE\n` +
        `=======================================================\n` +
        `Este archivo contiene el historial clínico completo, documentos de identidad y estudios médicos del paciente.\n` +
        `Clave de apertura: PIN de 4 dígitos del usuario.\n` +
        `Generado el: ${new Date().toLocaleString('es-PY', { timeZone: config.timezone })}\n` +
        `Validez del enlace de descarga: 24 Horas.\n` +
        (missingStudyFiles > 0 ? `\nATENCION: ${missingStudyFiles} estudio(s) tenian su archivo original faltante en el servidor y no se pudieron incluir.\n` : '') +
        `\nESTE ARCHIVO USA CIFRADO AES-256 (no el cifrado clasico Zip 2.0).\n` +
        `Si tu computadora dice que el archivo esta "danado" o "invalido" al abrirlo con el\n` +
        `descompresor nativo de Windows o Mac, es porque esas herramientas NO soportan AES-256.\n` +
        `Instala un programa gratuito que si lo soporte:\n` +
        `  - Windows: 7-Zip (https://www.7-zip.org)\n` +
        `  - Mac: Keka (https://www.keka.io) o The Unarchiver\n` +
        `  - Android/iOS: RAR o ZArchiver\n`,
        { name: 'LEAME_SEGURIDAD.txt' }
      );

      archive.finalize();
    });
  }
}
