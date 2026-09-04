import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { EmergencyService } from '../services/emergency.service';
import { ZeroKnowledgeSecurity } from '../security/zero-knowledge';

export class EmergencyController {
  /**
   * Public emergency scan endpoint (No PIN required)
   * Triggers WhatsApp push alert to the owner and logs IP geolocation
   */
  public static async getEmergencyCard(req: Request, res: Response): Promise<void> {
    const { token } = req.params;
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown Scanner Browser';

    try {
      const data = await EmergencyService.processEmergencyScan(token, ip, userAgent);
      if (!data) {
        res.status(404).json({ error: 'Código de emergencia Bio-Pass no encontrado o inactivo.' });
        return;
      }

      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: 'Error procesando ficha de emergencia', details: err.message });
    }
  }

  /**
   * Private consultation mode unlock (Requires 4-digit PIN)
   * Decrypts client-side zero-knowledge encrypted medical studies and history
   */
  public static async unlockConsultationMode(req: Request, res: Response): Promise<void> {
    const { token } = req.params;
    const { pin } = req.body;

    if (!pin || pin.length !== 4) {
      res.status(400).json({ error: 'Se requiere un PIN de 4 dígitos' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { emergencyToken: token },
      include: {
        medicalStudies: { orderBy: { studyDate: 'desc' } },
        emergencyContacts: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'Expediente no encontrado' });
      return;
    }

    // Verify PIN against stored Bcrypt hash
    if (user.pinHash) {
      const isPinValid = await ZeroKnowledgeSecurity.verifyPin(pin, user.pinHash);
      if (!isPinValid) {
        res.status(401).json({ error: 'PIN incorrecto. Acceso al historial clínico denegado.' });
        return;
      }
    }

    // Log consultation access
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    await prisma.scanAuditLog.create({
      data: {
        userId: user.id,
        ipAddress: ip,
        userAgent: req.headers['user-agent'] || 'Medical Portal Doctor View',
        mode: 'CONSULTATION_PIN',
        city: 'Acceso Médico Autorizado',
        country: 'PY',
      },
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        fullName: user.fullName,
        ciNumber: user.ciNumber,
        bloodType: user.bloodType,
        emergencyConditions: user.emergencyConditions ? JSON.parse(user.emergencyConditions) : [],
        severeAllergies: user.severeAllergies,
        contraindicatedMeds: user.contraindicatedMeds,
        address: user.address,
        email: user.email,
        encryptionSalt: user.encryptionSalt,
        encryptedMedicalBlob: user.encryptedMedicalBlob,
      },
      medicalStudies: user.medicalStudies,
      emergencyContacts: user.emergencyContacts,
    });
  }

  /**
   * Triggers emergency call to relative / emergency contact
   */
  public static async callEmergencyContact(req: Request, res: Response): Promise<void> {
    const { token } = req.params;
    const user = await prisma.user.findUnique({
      where: { emergencyToken: token },
      include: { emergencyContacts: { where: { isPrimary: true }, take: 1 } },
    });

    if (!user || !user.emergencyContacts[0]) {
      res.status(404).json({ error: 'Contacto de emergencia no configurado' });
      return;
    }

    const contact = user.emergencyContacts[0];
    const callResult = await EmergencyService.triggerEmergencyCall(
      user.id,
      contact.phoneNumber,
      user.fullName || 'Titular Bio-Pass'
    );

    res.json({
      success: true,
      message: `Llamada de rescate en curso a ${contact.fullName} (${contact.phoneNumber})`,
      contactPhone: contact.phoneNumber,
      contactName: contact.fullName,
      callSid: callResult.callSid,
    });
  }
}
