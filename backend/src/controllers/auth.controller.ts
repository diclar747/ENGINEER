import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { generateToken, AuthenticatedRequest } from '../security/jwt';
import { ZeroKnowledgeSecurity } from '../security/zero-knowledge';
import { OtpService } from '../services/otp.service';
import { BotStateMachine } from '../whatsapp/bot-state-machine';
import { NiroService } from '../services/niro.service';
import { config } from '../config';

export class AuthController {
  /**
   * Web self-service registration. Drives the SAME conversational engine the
   * WhatsApp bot uses, so a web sign-up produces an identical account
   * (phone number + PIN + zero-knowledge vault). The client sends one step at a
   * time (a text answer or an optional CI/photo upload); we echo the bot's next
   * prompt plus the user's current onboarding state so the UI can show progress
   * and detect completion.
   */
  public static async registerStep(req: Request, res: Response): Promise<void> {
    const { phoneNumber, message } = req.body;
    const file = (req as any).file as
      | { buffer: Buffer; mimetype: string; originalname: string }
      | undefined;

    const cleanPhone = (phoneNumber || '').replace(/[^0-9]/g, '');
    if (!/^\d{7,15}$/.test(cleanPhone)) {
      res.status(400).json({ error: 'Número de teléfono inválido (formato internacional, 7-15 dígitos).' });
      return;
    }
    if (!message && !file) {
      res.status(400).json({ error: 'Enviá una respuesta o un archivo.' });
      return;
    }

    // Audio (nota de voz) → transcribir con Niro y pasarlo como texto; no como media.
    let effectiveBody = message || '';
    let mediaBuffer = file?.buffer;
    let mediaMimeType = file?.mimetype;
    let mediaFilename = file?.originalname;
    if (file && /^audio\//.test(file.mimetype || '')) {
      const transcript = await NiroService.transcribeAudio(file.buffer, file.originalname || 'audio.ogg');
      if (transcript) effectiveBody = effectiveBody ? `${effectiveBody} ${transcript}` : transcript;
      mediaBuffer = undefined;
      mediaMimeType = undefined;
      mediaFilename = undefined;
    }

    try {
      const response = await BotStateMachine.handleMessage({
        from: cleanPhone,
        body: effectiveBody,
        mediaBuffer,
        mediaMimeType,
        mediaFilename,
      });

      const user = await prisma.user.findUnique({
        where: { phoneNumber: cleanPhone },
        select: { onboardingState: true, status: true, fullName: true },
      });

      res.json({
        success: true,
        reply: response.replyText,
        state: user?.onboardingState ?? 'STEP1_WELCOME',
        status: user?.status ?? 'PENDING_PAYMENT',
        fullName: user?.fullName ?? null,
        // ACTIVE => they can log in now with phone + the PIN chosen in the flow
        completed: user?.status === 'ACTIVE',
        mediaAttachment: response.mediaAttachment && response.mediaAttachment.kind === 'image' ? {
          filename: response.mediaAttachment.filename,
          mimetype: response.mediaAttachment.mimetype,
          dataUrl: `data:${response.mediaAttachment.mimetype};base64,${response.mediaAttachment.buffer.toString('base64')}`,
        } : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Error en el motor de registro', details: err.message });
    }
  }
  /**
   * Request a one-time code. Delivered over WhatsApp via Baileys; if the bot is
   * offline the code is logged server-side and (in development) echoed in the response.
   */
  public static async requestOtp(req: Request, res: Response): Promise<void> {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const user = await prisma.user.findUnique({ where: { phoneNumber: cleanPhone } });

    // Do not reveal whether the number is registered — always behave the same.
    const dispatch = await OtpService.createAndSend(cleanPhone, 'LOGIN');

    res.json({
      success: true,
      channel: dispatch.channel,
      message:
        dispatch.channel === 'whatsapp'
          ? `Te enviamos un código por WhatsApp al ${cleanPhone}.`
          : `Código generado para ${cleanPhone} (el bot de WhatsApp no está vinculado; revisá el log del servidor).`,
      expiresAt: dispatch.expiresAt,
      registered: !!user,
      // Only ever surfaced in development, even if OTP_DEV_ECHO is left on elsewhere.
      devOtp: config.env === 'development' ? dispatch.devCode : undefined,
    });
  }

  /**
   * Verify OTP + PIN and authenticate user session
   */
  public static async verifyLogin(req: Request, res: Response): Promise<void> {
    const { phoneNumber, pin, code } = req.body;
    const cleanPhone = (phoneNumber || '').replace(/[^0-9]/g, '');
    if (!cleanPhone || !pin) {
      res.status(400).json({ error: 'Telefono y PIN son obligatorios' });
      return;
    }

    // OTP en el login: se activa con REQUIRE_LOGIN_OTP=true (opt-in, para poder
    // desplegar el frontend nuevo primero y recién después exigirlo). Si el request
    // trae `code`, siempre se valida aunque el flag esté apagado.
    const requireOtp = process.env.REQUIRE_LOGIN_OTP === 'true' || !!code;
    if (requireOtp) {
      if (!code) {
        res.status(400).json({ error: 'Falta el código de verificación (OTP).', needOtp: true });
        return;
      }
      const otp = await OtpService.verify(cleanPhone, String(code), 'LOGIN');
      if (!otp.ok) {
        res.status(401).json({ error: otp.reason || 'Código de verificación inválido.', needOtp: true });
        return;
      }
    }

    const user = await prisma.user.findUnique({
      where: { phoneNumber: cleanPhone },
      include: { emergencyContacts: true, subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!user || !user.pinHash) {
      res.status(404).json({
        error:
          'No encontramos ese número. Si ya te registraste por WhatsApp, escribile al bot *VINCULAR* para asociar tu número real al login (algunos WhatsApp no le pasan el número al chat). Si todavía no te registraste, escribile al bot para empezar.',
      });
      return;
    }
    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
      const mins = Math.ceil((user.pinLockedUntil.getTime() - Date.now()) / 60000);
      res.status(429).json({ error: `Demasiados intentos. Reintenta en ${mins} min.` });
      return;
    }
    const ok = await ZeroKnowledgeSecurity.verifyPin(pin, user.pinHash);
    if (!ok) {
      const attempts = user.failedPinAttempts + 1;
      const lock = attempts >= 5;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedPinAttempts: lock ? 0 : attempts, pinLockedUntil: lock ? new Date(Date.now() + 15 * 60000) : null },
      });
      res.status(401).json({ error: lock ? 'PIN incorrecto 5 veces. Bloqueado 15 minutos.' : `PIN incorrecto (intento ${attempts}/5).` });
      return;
    }
    if (user.failedPinAttempts > 0 || user.pinLockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedPinAttempts: 0, pinLockedUntil: null } });
    }
    const token = generateToken({ userId: user.id, phoneNumber: user.phoneNumber, status: user.status });
    res.json({
      success: true, token,
      user: {
        id: user.id, phoneNumber: user.phoneNumber, fullName: user.fullName, ciNumber: user.ciNumber,
        bloodType: user.bloodType, emergencyConditions: user.emergencyConditions, severeAllergies: user.severeAllergies,
        contraindicatedMeds: user.contraindicatedMeds, address: user.address, email: user.email,
        status: user.status, emergencyToken: user.emergencyToken, encryptionSalt: user.encryptionSalt,
      },
    });
  }

  public static async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        emergencyContacts: true,
        subscriptions: { orderBy: { createdAt: 'desc' } },
        organization: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  }
}
