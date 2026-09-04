import { Response } from 'express';
import { AuthenticatedRequest } from '../security/jwt';
import { prisma } from '../database/prisma';
import { ZeroKnowledgeSecurity } from '../security/zero-knowledge';

/**
 * Client-side Zero-Knowledge re-initialization.
 *
 * During WhatsApp onboarding the server necessarily derives the key (the PIN arrives
 * as a chat message). On the user's first web login the browser derives the key
 * locally, re-encrypts the medical blob with a fresh salt, and sends only the
 * ciphertext + salt here. From that point the server can no longer decrypt it.
 */
export class VaultController {
  static async status(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { webVaultInitialized: true, encryptionSalt: true, encryptedMedicalBlob: true },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({
      webVaultInitialized: user.webVaultInitialized,
      encryptionSalt: user.encryptionSalt,
      encryptedMedicalBlob: user.encryptedMedicalBlob,
    });
  }

  static async reinitialize(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { encryptionSalt, encryptedMedicalBlob, pin } = req.body || {};

    if (typeof encryptionSalt !== 'string' || !/^[0-9a-fA-F]{16,64}$/.test(encryptionSalt)) {
      res.status(400).json({ error: 'encryptionSalt inválido (hex de 16-64 chars)' });
      return;
    }
    if (typeof encryptedMedicalBlob !== 'string' || encryptedMedicalBlob.length < 20) {
      res.status(400).json({ error: 'encryptedMedicalBlob inválido' });
      return;
    }
    // The payload must be parseable as the {iv, authTag, ciphertext} envelope
    try {
      const p = JSON.parse(encryptedMedicalBlob);
      if (!p.iv || !p.authTag || !p.ciphertext) throw new Error('shape');
    } catch {
      res.status(400).json({ error: 'encryptedMedicalBlob no tiene el formato esperado (iv/authTag/ciphertext)' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Verify the PIN so a stolen JWT alone can't overwrite the vault
    if (user.pinHash) {
      if (!pin || !(await ZeroKnowledgeSecurity.verifyPin(String(pin), user.pinHash))) {
        res.status(401).json({ error: 'PIN incorrecto' });
        return;
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        encryptionSalt,
        encryptedMedicalBlob,
        webVaultInitialized: true,
      },
    });

    res.json({ success: true, webVaultInitialized: true });
  }
}
