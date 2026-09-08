import { Request, Response } from 'express';
import { whatsappBot } from '../whatsapp/baileys.client';
import { BotStateMachine } from '../whatsapp/bot-state-machine';
import { CronService } from '../services/cron.service';
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
}
