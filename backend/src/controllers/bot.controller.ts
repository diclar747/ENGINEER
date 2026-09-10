import { Request, Response } from 'express';
import { whatsappBot } from '../whatsapp/baileys.client';
import { BotStateMachine } from '../whatsapp/bot-state-machine';
import { CronService } from '../services/cron.service';
import { MedicationReminderService } from '../services/medication-reminder.service';
import { NiroService } from '../services/niro.service';
import { config } from '../config';

export class BotController {
  public static async getBotStatus(req: Request, res: Response): Promise<void> {
    const status = whatsappBot.getStatus();
    res.json({
      success: true,
      service: 'Baileys WhatsApp Web Engine',
      botNumber: config.baileys.botNumber,
      ...status,
    });
  }

  /** Force a new pairing attempt after the client gave up reconnecting. */
  public static async reconnect(req: Request, res: Response): Promise<void> {
    await whatsappBot.reconnect();
    res.json({ success: true, ...whatsappBot.getStatus() });
  }

  /** Solo botNumber — endpoint público que usa el login para el link "registrate por WhatsApp". */
  public static async publicInfo(_req: Request, res: Response): Promise<void> {
    const s = whatsappBot.getStatus();
    res.json({ botNumber: config.baileys.botNumber, connected: s.connected });
  }

  /** Feed de movimientos del bot (panel admin). */
  public static async getEvents(req: Request, res: Response): Promise<void> {
    const { limit, dir, phone, status } = req.query as Record<string, string>;
    res.json({
      status: { service: 'Baileys WhatsApp Web Engine', botNumber: config.baileys.botNumber, ...whatsappBot.getStatus() },
      events: whatsappBot.getEvents({
        limit: limit ? parseInt(limit, 10) : 120,
        dir: dir || undefined,
        phone: phone || undefined,
        status: status || undefined,
      }),
    });
  }

  /** Herramienta del panel: ¿el número está en WhatsApp? ¿qué LID? */
  public static async lookup(req: Request, res: Response): Promise<void> {
    const phone = String((req.query.phone as string) || (req.body?.phone as string) || '');
    const r = await whatsappBot.lookupNumber(phone);
    res.json({ phone: phone.replace(/[^0-9]/g, ''), result: r });
  }

  /** Herramienta del panel: enviar un mensaje de prueba a un número. */
  public static async sendTest(req: Request, res: Response): Promise<void> {
    const { phone, text } = req.body || {};
    const clean = String(phone || '').replace(/[^0-9]/g, '');
    if (!/^\d{7,15}$/.test(clean)) {
      res.status(400).json({ error: 'Número inválido' });
      return;
    }
    const ok = await whatsappBot.sendMessage(clean, String(text || '🔧 Mensaje de prueba desde el panel Bio-Pass.'));
    res.json({ ok, phone: clean });
  }

  /**
   * Interactive simulator endpoint: Test WhatsApp bot conversation directly via REST or UI!
   */
  public static async simulateMessage(req: Request, res: Response): Promise<void> {
    const { from, body } = req.body;
    const file = (req as any).file as
      | { buffer: Buffer; mimetype: string; originalname: string }
      | undefined;

    if (!from || (!body && !file)) {
      res.status(400).json({ error: 'from (phone) and body (text) or media (file) are required' });
      return;
    }

    // Nota de voz / audio en el simulador: se transcribe con Niro y se trata como texto,
    // igual que en WhatsApp — así se puede probar el flujo por voz de punta a punta.
    let effectiveBody = body || '';
    const isAudio = !!file && /^audio\//i.test(file.mimetype || '');
    if (isAudio && file) {
      try {
        const transcript = await NiroService.transcribeAudio(file.buffer, file.originalname || 'audio.ogg');
        if (transcript) effectiveBody = effectiveBody ? `${effectiveBody} ${transcript}` : transcript;
      } catch (e: any) {
        console.warn('[BOT SIM] no se pudo transcribir el audio:', e?.message);
      }
    }

    try {
      const response = await BotStateMachine.handleMessage({
        from,
        body: effectiveBody,
        mediaBuffer: isAudio ? undefined : file?.buffer,
        mediaMimeType: isAudio ? undefined : file?.mimetype,
        mediaFilename: isAudio ? undefined : file?.originalname,
      });

      res.json({
        success: true,
        sentBy: from,
        reply: response.replyText,
        mediaFirst: !!response.mediaFirst,
        mediaAttachment: response.mediaAttachment ? {
          filename: response.mediaAttachment.filename,
          mimetype: response.mediaAttachment.mimetype,
          kind: response.mediaAttachment.kind || 'document',
          // Inline images (e.g. payment QR) are small — safe to hand back as a data URL
          // so the web simulator can render them directly in the chat bubble.
          dataUrl: response.mediaAttachment.kind === 'image'
            ? `data:${response.mediaAttachment.mimetype};base64,${response.mediaAttachment.buffer.toString('base64')}`
            : undefined,
        } : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Error in bot state machine', details: err.message });
    }
  }

  /**
   * Trigger manual execution of subscription CRON job for testing
   */
  public static async triggerCronCheck(req: Request, res: Response): Promise<void> {
    try {
      const result = await CronService.runSubscriptionCheck();
      res.json({
        success: true,
        message: 'Subscription lifecycle CRON job executed successfully',
        result,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Error running CRON job', details: err.message });
    }
  }

  /** Dispara el tick de recordatorios de medicación / turnos (para pruebas). */
  public static async triggerReminders(_req: Request, res: Response): Promise<void> {
    try {
      const sent = await MedicationReminderService.tick();
      res.json({ success: true, sent });
    } catch (err: any) {
      res.status(500).json({ error: 'Error running reminder tick', details: err.message });
    }
  }
}
