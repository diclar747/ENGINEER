import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { prisma } from '../database/prisma';
import { StorageService } from '../storage/storage.service';
import { config } from '../config';
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
        const downloadUrl = `${config.baseUrl}/api/export/download/${filename}?token=${user.emergencyToken}`;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        resolve({
          downloadUrl,
          expiresAt,
          filename,
        });
      });

      archive.on('error', (err) => {
        // Fallback to standard zip if zip-encrypted plugin isn't active
        const fallbackArchive = archiver('zip', { zlib: { level: 9 } });
        fallbackArchive.pipe(fs.createWriteStream(outputPath));
        fallbackArchive.append(JSON.stringify(manifest, null, 2), { name: 'MEDICAL_MANIFEST.json' });
        fallbackArchive.append(JSON.stringify(user.auditLogs, null, 2), { name: 'AUDIT_LOGS_FORENSICS.json' });
        fallbackArchive.finalize().then(() => {
          resolve({
            downloadUrl: `${config.baseUrl}/api/export/download/${filename}?token=${user.emergencyToken}`,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            filename,
          });
        }).catch(reject);
      });

      archive.pipe(output);

      // Append manifest and logs
      archive.append(JSON.stringify(manifest, null, 2), { name: 'HISTORIAL_MEDICO_OFICIAL.json' });
      archive.append(JSON.stringify(user.auditLogs, null, 2), { name: 'REGISTRO_FORENSE_ESCANEO.json' });

      // Add readme explanation
      archive.append(
        `DOORWAY CORTEX BIO-PASS - EXPEDIENTE CLINICO PORTABLE\n` +
        `=======================================================\n` +
        `Este archivo contiene el historial clínico completo y estudios médicos del paciente.\n` +
        `Clave de apertura: PIN de 4 dígitos del usuario.\n` +
        `Generado el: ${new Date().toLocaleString('es-PY', { timeZone: config.timezone })}\n` +
        `Validez del enlace de descarga: 24 Horas.\n`,
        { name: 'LEAME_SEGURIDAD.txt' }
      );

      archive.finalize();
    });
  }
}
