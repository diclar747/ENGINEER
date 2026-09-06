import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  WASocket,
  proto,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { config } from '../config';
import { BotStateMachine } from './bot-state-machine';
import { NiroService } from '../services/niro.service';
import { prisma } from '../database/prisma';

export class BaileysClient {
  private sock: WASocket | null = null;
  private qrCodeDataUrl: string | null = null;
  private qrRaw: string | null = null;
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private reconnectAttempts = 0;
  private lastError: string | null = null;
  private gaveUp = false;
  private lastLogoutAt = 0;

  public async start(): Promise<void> {
    if (this.isConnecting || this.isConnected) return;
    this.isConnecting = true;
    this.gaveUp = false;

    try {
      const authDir = config.baileys.authDir;
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      // Baileys' internal logger. Default 'silent' — it floods "failed to decrypt message"
      // for history-sync artifacts that don't affect inbound handling. Our own
      // connection.update logging below is independent. Set WHATSAPP_LOG_LEVEL=warn to debug.
      const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || 'silent' });

      // Announce the CURRENT WhatsApp Web protocol version — WhatsApp servers
      // terminate connections that claim an outdated version ("Connection Terminated by Server").
      let version: [number, number, number] | undefined;
      try {
        const res = await fetchLatestBaileysVersion();
        version = res.version;
        console.log(`📲 [WHATSAPP BOT] Using WA Web version ${version.join('.')}${res.isLatest ? ' (latest)' : ''}`);
      } catch (e: any) {
        console.warn('⚠️ [WHATSAPP BOT] Could not fetch latest WA version, using bundled default:', e?.message);
      }

      this.sock = makeWASocket({
        version,
        auth: state,
        logger,
        browser: Browsers.ubuntu('Chrome'),
        qrTimeout: 60_000,
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 15_000,
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          const firstOfSession = !this.qrRaw;
          this.qrRaw = qr;
          this.qrCodeDataUrl = await QRCode.toDataURL(qr);
          if (firstOfSession) {
            console.log('📲 [WHATSAPP BOT] Pairing QR ready — open /bot-connect in the web app or GET /api/bot/status. (auto-refreshes until scanned)');
          }
        }

        if (connection === 'close') {
          const err = lastDisconnect?.error as any;
          const statusCode = err?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          this.lastError = `${err?.message || 'close'} [${statusCode ?? 'unknown'}]`;
          console.warn(
            `⚠️ [WHATSAPP BOT] close · status=${statusCode} · msg="${err?.message}" · data=${JSON.stringify(err?.data || err?.output?.payload || {})}`
          );
          this.isConnected = false;
          this.isConnecting = false;

          if (loggedOut) {
            // WhatsApp cerró la sesión (401). Reconectar sin credenciales devuelve 401 al
            // instante: sin freno esto era un loop que martillaba a WhatsApp (riesgo de baneo
            // del número), y el contador de reintentos no servía porque un 'open' transitorio
            // lo reseteaba en cada vuelta. Guard por tiempo: si volvió a desloguear en < 2 min
            // es un loop → se frena y espera re-vinculado manual (/bot-connect + POST
            // /api/bot/reconnect). Si pasó más, limpia la sesión y reintenta UNA vez para
            // mostrar un QR nuevo.
            const now = Date.now();
            const loopingFast = now - this.lastLogoutAt < 120_000;
            this.lastLogoutAt = now;
            try { this.sock?.ev.removeAllListeners('connection.update'); } catch { /* noop */ }
            if (loopingFast) {
              this.gaveUp = true;
              console.warn(
                '⚠️ [WHATSAPP BOT] Logout en loop — freno la reconexión. ' +
                  'Escaneá el QR en /bot-connect y luego POST /api/bot/reconnect.'
              );
              return;
            }
            console.warn('⚠️ [WHATSAPP BOT] Logged out. Clearing session — re-pair from /bot-connect.');
            try { fs.rmSync(authDir, { recursive: true, force: true }); } catch { /* noop */ }
            this.qrRaw = null;
            this.reconnectAttempts = 0;
            setTimeout(() => this.start(), 3_000);
            return;
          }

          // 515 (restartRequired) fires right after a successful QR scan — it's expected,
          // reconnect immediately and don't count it against the retry budget.
          if (statusCode === DisconnectReason.restartRequired) {
            console.log('🔄 [WHATSAPP BOT] Restart required after pairing — reconnecting…');
            setTimeout(() => this.start(), 1_000);
            return;
          }

          // 428 = WhatsApp rate-limited this number for too many linked-device attempts.
          // Hammering it makes the throttle worse — back off hard and stop after a couple tries.
          if (statusCode === 428) {
            this.reconnectAttempts += 1;
            if (this.reconnectAttempts >= 3) {
              this.gaveUp = true;
              console.warn(
                '⚠️ [WHATSAPP BOT] WhatsApp está limitando este número (428). ' +
                  'Esperá 20-30 min, cerrá dispositivos vinculados viejos, y luego POST /api/bot/reconnect.'
              );
              return;
            }
            console.warn(`⚠️ [WHATSAPP BOT] Rate-limited (428). Retry ${this.reconnectAttempts}/3 in 5 min.`);
            setTimeout(() => this.start(), 5 * 60_000);
            return;
          }

          this.reconnectAttempts += 1;
          if (this.reconnectAttempts > config.whatsappMaxReconnect) {
            this.gaveUp = true;
            console.warn(
              `⚠️ [WHATSAPP BOT] Gave up after ${this.reconnectAttempts} reconnect attempts. ` +
                `Call POST /api/bot/reconnect (or restart) to retry.`
            );
            return;
          }
          const delay = Math.min(30_000, 3_000 * this.reconnectAttempts);
          console.warn(`⚠️ [WHATSAPP BOT] Connection closed (${this.lastError}). Retry ${this.reconnectAttempts}/${config.whatsappMaxReconnect} in ${delay / 1000}s.`);
          setTimeout(() => this.start(), delay);
        } else if (connection === 'open') {
          console.log('✅ [WHATSAPP BOT] Connected to WhatsApp via Baileys.');
          this.isConnected = true;
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.lastError = null;
          this.qrCodeDataUrl = null;
          this.qrRaw = null;
        }
      });

      // Handle inbound messages — 1:1 DMs only
      this.sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') {
          console.log(`[WHATSAPP BOT] messages.upsert ignorado (type="${m.type}", ${m.messages?.length ?? 0} msgs)`);
          return;
        }

        for (const msg of m.messages) {
          if (!msg.key) continue;
          if (msg.key.fromMe) {
            // Messages sent FROM the bot's own linked account (e.g. testing by writing
            // to yourself from the same phone the bot is paired to) are ignored on
            // purpose — otherwise the bot would reply to its own messages in a loop.
            // Test the real flow from a DIFFERENT phone number.
            console.log('[WHATSAPP BOT] Ignorando mensaje propio (fromMe) — probá desde otro número, no el vinculado.');
            continue;
          }
          const jid = msg.key.remoteJid || '';
          // 1:1 DMs arrive either as "<phone>@s.whatsapp.net" or, for contacts WhatsApp
          // routes through its privacy-preserving "linked id" scheme, "<lid>@lid" — both
          // are valid individual chats. Groups ("@g.us") carry a `participant` (the
          // sender within the group) even when @lid-addressed; broadcasts/status/channels
          // use their own suffixes. Only true 1:1s (no participant) are handled here.
          const isDm = (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) && !msg.key.participant;
          if (!isDm) {
            console.log(`[WHATSAPP BOT] Ignorando jid no-DM: "${jid}" (participant="${msg.key.participant || ''}")`);
            continue;
          }
          await this.processIncomingMessage(msg);
        }
      });
    } catch (err) {
      console.error('❌ [WHATSAPP BOT] Error initializing Baileys socket:', err);
      this.isConnecting = false;
    }
  }

  private async processIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
    const remoteJid = msg.key.remoteJid || '';
    // remoteJid is "<phone>@s.whatsapp.net" for normal contacts, or "<lid>@lid" for
    // contacts WhatsApp only exposes via a linked-id (no real number in the stanza).
    const rawId = remoteJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const isLid = remoteJid.endsWith('@lid');

    if (!/^\d{7,15}$/.test(rawId)) {
      console.warn(`[WHATSAPP BOT] Ignoring message from unparseable JID: ${remoteJid}`);
      return;
    }
    // BotStateMachine keys users by "phone number". For @lid contacts we don't have
    // their real MSISDN (this Baileys version has no lid->phone resolver), so the lid
    // itself becomes their identity — they can still use the bot fully over WhatsApp;
    // only logging into the *web* dashboard needs a real phone number, which they won't
    // have unless they also register from the web with their actual number.
    const rawPhone = rawId;

    // Extract text
    let body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      '';

    let mediaBuffer: Buffer | undefined;
    let mediaMimeType: string | undefined;
    let mediaFilename: string | undefined;

    // Nota de voz / audio → transcribir con Niro y tratarlo como si el usuario hubiera escrito.
    // Así el audio funciona en TODO el flujo (registro, menú, preguntas) sin tocar el motor.
    if (msg.message?.audioMessage) {
      try {
        const audioBuf = (await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }), reuploadRequest: this.sock!.updateMediaMessage }
        )) as Buffer;
        const mime = msg.message.audioMessage.mimetype || 'audio/ogg';
        const ext = mime.includes('mp4') || mime.includes('m4a')
          ? 'm4a'
          : mime.includes('mpeg') || mime.includes('mp3')
            ? 'mp3'
            : mime.includes('wav')
              ? 'wav'
              : 'ogg';
        const transcript = await NiroService.transcribeAudio(audioBuf, `wa_audio_${Date.now()}.${ext}`);
        if (transcript) {
          body = body ? `${body} ${transcript}` : transcript;
          console.log('[WHATSAPP BOT] audio transcrito:', transcript.slice(0, 140));
        } else {
          console.warn('[WHATSAPP BOT] no se pudo transcribir el audio (Niro devolvió vacío)');
        }
      } catch (e) {
        console.warn('Could not download/transcribe audio message:', e);
      }
    }

    // Check for image or document media
    if (msg.message?.imageMessage) {
      try {
        mediaBuffer = (await downloadMediaMessage(
          msg,
          'buffer',
          {},
          {
            logger: pino({ level: 'silent' }),
            reuploadRequest: this.sock!.updateMediaMessage,
          }
        )) as Buffer;
        mediaMimeType = msg.message.imageMessage.mimetype || 'image/jpeg';
        mediaFilename = `wa_img_${Date.now()}.jpg`;
      } catch (e) {
        console.warn('Could not download image media buffer from Baileys:', e);
      }
    } else if (msg.message?.documentMessage) {
      try {
        mediaBuffer = (await downloadMediaMessage(
          msg,
          'buffer',
          {},
          {
            logger: pino({ level: 'silent' }),
            reuploadRequest: this.sock!.updateMediaMessage,
          }
        )) as Buffer;
        mediaMimeType = msg.message.documentMessage.mimetype || 'application/pdf';
        mediaFilename = msg.message.documentMessage.fileName || `doc_${Date.now()}.pdf`;
      } catch (e) {
        console.warn('Could not download document media buffer from Baileys:', e);
      }
    }

    // Best-effort "escribiendo…" indicator while the engine works (OCR/vision calls can
    // take several seconds) — never let a presence hiccup break the actual reply.
    this.sock?.sendPresenceUpdate('composing', remoteJid).catch(() => {});

    try {
      const response = await BotStateMachine.handleMessage({
        from: rawPhone,
        body,
        mediaBuffer,
        mediaMimeType,
        mediaFilename,
      });

      // Reply to the exact JID the message arrived on (correct for both @s.whatsapp.net
      // and @lid) rather than reconstructing one from the bare phone/lid digits.
      await this.sendMessage(remoteJid, response.replyText);

      if (response.mediaAttachment) {
        if (response.mediaAttachment.kind === 'image') {
          await this.sendImage(
            remoteJid,
            response.mediaAttachment.buffer,
            response.mediaAttachment.caption,
            response.mediaAttachment.mimetype
          );
        } else {
          await this.sendDocument(
            remoteJid,
            response.mediaAttachment.buffer,
            response.mediaAttachment.filename,
            response.mediaAttachment.mimetype,
            response.mediaAttachment.caption
          );
        }
      }

      // Best-effort: remember the exact JID so later async messages (payment
      // confirmations, cron reminders) can reach @lid-only contacts too.
      prisma.user
        .updateMany({ where: { phoneNumber: rawPhone }, data: { whatsappJid: remoteJid } })
        .catch(() => {});
    } catch (err: any) {
      console.error(`Error processing message from ${rawPhone}${isLid ? ' (lid)' : ''}:`, err);
    } finally {
      this.sock?.sendPresenceUpdate('paused', remoteJid).catch(() => {});
    }
  }

  /**
   * Accepts either a bare phone number ("595981123456") or an already-suffixed JID
   * ("595981123456@s.whatsapp.net" / "<lid>@lid" — as captured from an inbound message
   * or stored on `user.whatsappJid`) and returns a JID ready for `sock.sendMessage`, or
   * null if it's not a recognizable target.
   */
  private resolveJid(target: string): string | null {
    const raw = (target || '').trim();
    if (raw.includes('@')) {
      return /^\d{7,20}@(s\.whatsapp\.net|lid)$/.test(raw) ? raw : null;
    }
    const cleanPhone = raw.replace(/[^0-9]/g, '');
    return /^\d{7,15}$/.test(cleanPhone) ? `${cleanPhone}@s.whatsapp.net` : null;
  }

  /**
   * Sends a plain text WhatsApp message
   */
  public async sendMessage(target: string, text: string): Promise<boolean> {
    const jid = this.resolveJid(target);
    if (!jid) {
      console.warn(`[WHATSAPP BOT] Refusing to send to invalid target "${target}"`);
      return false;
    }

    console.log(`\n📨 [WHATSAPP OUTBOUND -> ${jid}]:\n${text}\n----------------------------------`);

    if (this.sock && this.isConnected) {
      try {
        await this.sock.sendMessage(jid, { text });
        return true;
      } catch (err) {
        console.error(`Failed to send real WhatsApp message to ${jid}:`, err);
        return false;
      }
    }

    return true; // Logged and handled
  }

  /**
   * Sends an inline photo (e.g. a payment QR code) rather than a file attachment.
   */
  public async sendImage(
    target: string,
    buffer: Buffer,
    caption?: string,
    mimetype = 'image/png'
  ): Promise<boolean> {
    const jid = this.resolveJid(target);
    if (!jid) {
      console.warn(`[WHATSAPP BOT] Refusing to send image to invalid target "${target}"`);
      return false;
    }

    console.log(`🖼️ [WHATSAPP IMAGE -> ${jid}]: (${buffer.length} bytes)`);

    if (this.sock && this.isConnected) {
      try {
        await this.sock.sendMessage(jid, { image: buffer, mimetype, caption });
        return true;
      } catch (err) {
        console.error(`Failed to send image to ${jid}:`, err);
        return false;
      }
    }

    return true;
  }

  /**
   * Sends a document (like 3x3cm Sticker PDF or medical study)
   */
  public async sendDocument(
    target: string,
    buffer: Buffer,
    fileName: string,
    mimetype = 'application/pdf',
    caption?: string
  ): Promise<boolean> {
    const jid = this.resolveJid(target);
    if (!jid) {
      console.warn(`[WHATSAPP BOT] Refusing to send document to invalid target "${target}"`);
      return false;
    }

    console.log(`📎 [WHATSAPP ATTACHMENT -> ${jid}]: Document ${fileName} (${buffer.length} bytes)`);

    if (this.sock && this.isConnected) {
      try {
        await this.sock.sendMessage(jid, {
          document: buffer,
          mimetype,
          fileName,
          caption,
        });
        return true;
      } catch (err) {
        console.error(`Failed to send document to ${jid}:`, err);
        return false;
      }
    }

    return true;
  }

  public getStatus() {
    return {
      connected: this.isConnected,
      connecting: this.isConnecting,
      qrCode: this.qrCodeDataUrl,
      reconnectAttempts: this.reconnectAttempts,
      gaveUp: this.gaveUp,
      lastError: this.lastError,
    };
  }

  /** Force a fresh connection attempt (used after the client has given up). */
  public async reconnect(): Promise<void> {
    this.reconnectAttempts = 0;
    this.gaveUp = false;
    this.lastLogoutAt = 0; // re-vinculado manual: no lo cuentes como "loop"
    if (this.isConnected || this.isConnecting) return;
    await this.start();
  }
}

export const whatsappBot = new BaileysClient();
