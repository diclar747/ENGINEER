import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  WASocket,
  proto,
  downloadMediaMessage,
  normalizeMessageContent,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { config } from '../config';
import { BotStateMachine } from './bot-state-machine';
import { NiroService } from '../services/niro.service';
import { prisma } from '../database/prisma';

/**
 * Vacía la carpeta de sesión de Baileys SIN borrar la carpeta en sí — `authDir`
 * suele ser un mount point de un volumen de Docker y `rmdir` sobre él tira EBUSY.
 */
function clearAuthDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      return;
    }
    for (const entry of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  } catch (e: any) {
    console.warn('⚠️ [WHATSAPP BOT] No se pudo limpiar authDir:', e?.message);
  }
}

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
            clearAuthDir(authDir);
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

    // WhatsApp nests the real payload for several common cases the web simulator
    // never hits: disappearing-messages chats (ephemeralMessage), "ver una vez"
    // media (viewOnceMessage / viewOnceMessageV2), and — muy habitual con una
    // cédula — la foto enviada como *archivo adjunto* con epígrafe
    // (documentWithCaptionMessage). Sin desanidar, `msg.message.imageMessage` /
    // `documentMessage` quedan undefined y el bot actúa como si no hubiera llegado
    // nada. normalizeMessageContent los desenvuelve para que el manejo de
    // imagen/documento/audio sea idéntico al del simulador.
    const content = normalizeMessageContent(msg.message) || msg.message || undefined;
    const normMsg = { ...msg, message: content } as proto.IWebMessageInfo;
    const imageMessage = content?.imageMessage;
    const documentMessage = content?.documentMessage;
    const audioMessage = content?.audioMessage;

    // Extract text
    let body =
      content?.conversation ||
      content?.extendedTextMessage?.text ||
      imageMessage?.caption ||
      documentMessage?.caption ||
      '';

    let mediaBuffer: Buffer | undefined;
    let mediaMimeType: string | undefined;
    let mediaFilename: string | undefined;

    // Nota de voz / audio → transcribir con Niro y tratarlo como si el usuario hubiera escrito.
    // Así el audio funciona en TODO el flujo (registro, menú, preguntas) sin tocar el motor.
    if (audioMessage) {
      try {
        const audioBuf = await this.downloadWithRetry(normMsg);
        const mime = audioMessage.mimetype || 'audio/ogg';
        const ext = mime.includes('mp4') || mime.includes('m4a')
          ? 'm4a'
          : mime.includes('mpeg') || mime.includes('mp3')
            ? 'mp3'
            : mime.includes('wav')
              ? 'wav'
              : 'ogg';
        const transcript = audioBuf
          ? await NiroService.transcribeAudio(audioBuf, `wa_audio_${Date.now()}.${ext}`)
          : null;
        if (transcript) {
          body = body ? `${body} ${transcript}` : transcript;
          console.log('[WHATSAPP BOT] audio transcrito:', transcript.slice(0, 140));
        } else {
          console.warn('[WHATSAPP BOT] no se pudo transcribir el audio (descarga vacía o Niro sin texto)');
        }
      } catch (e) {
        console.warn('Could not download/transcribe audio message:', e);
      }
    }

    // Imagen o documento (foto de cédula, PDF escaneado, estudio médico…).
    if (imageMessage || documentMessage) {
      const isDoc = !imageMessage;
      const declaredMime =
        (isDoc ? documentMessage?.mimetype : imageMessage?.mimetype) ||
        (isDoc ? 'application/pdf' : 'image/jpeg');
      try {
        mediaBuffer = await this.downloadWithRetry(normMsg);
      } catch (e) {
        console.warn('[WHATSAPP BOT] no se pudo descargar el adjunto:', (e as any)?.message || e);
      }

      // Un buffer vacío / minúsculo = descarga fallida (media vencida en los
      // servers de WhatsApp, error de descifrado, etc.). Antes esto se guardaba
      // igual y el OCR devolvía texto vacío → "no transcribe nada". Ahora se
      // descarta y, si no vino texto junto, se le pide al usuario que reenvíe.
      if (mediaBuffer && mediaBuffer.length > 512) {
        mediaMimeType = declaredMime;
        const ext = extFromMime(declaredMime);
        mediaFilename = isDoc
          ? documentMessage?.fileName || `wa_doc_${Date.now()}.${ext}`
          : `wa_img_${Date.now()}.${ext}`;
      } else {
        console.warn(
          `[WHATSAPP BOT] adjunto ${isDoc ? 'documento' : 'imagen'} sin bytes utilizables ` +
            `(len=${mediaBuffer?.length ?? 0}) — pido reenvío`
        );
        mediaBuffer = undefined;
        if (!body.trim()) {
          await this.sendMessage(
            remoteJid,
            '📷 Recibí tu archivo pero no pude abrirlo. Por favor reenviá la *foto de la cédula* ' +
              '(mejor como foto, no como documento), o escribí tu *Nombre Completo y Número de Cédula*.'
          );
          this.sock?.sendPresenceUpdate('paused', remoteJid).catch(() => {});
          return;
        }
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
   * Descarga el adjunto de un mensaje a un Buffer, con UN reintento. La primera
   * descarga después de recibir un mensaje falla de vez en cuando
   * ("failed to decrypt" / media aún no replicada en el CDN de WhatsApp); un
   * segundo intento con `reuploadRequest` la recupera. Devuelve undefined si
   * ambos intentos fallan o el resultado viene vacío.
   */
  private async downloadWithRetry(msg: proto.IWebMessageInfo): Promise<Buffer | undefined> {
    const opts = {
      logger: pino({ level: 'silent' }),
      reuploadRequest: this.sock!.updateMediaMessage,
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const buf = (await downloadMediaMessage(msg, 'buffer', {}, opts)) as Buffer;
        if (buf && buf.length) return buf;
        console.warn(`[WHATSAPP BOT] descarga de media vacía (intento ${attempt}/2)`);
      } catch (e) {
        console.warn(`[WHATSAPP BOT] descarga de media falló (intento ${attempt}/2):`, (e as any)?.message || e);
      }
      if (attempt === 1) await new Promise((r) => setTimeout(r, 800));
    }
    return undefined;
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

    // Si la última caída fue un logout / 401, las credenciales en disco ya no
    // sirven. El guard de "logout en loop" frena la reconexión pero NO limpia la
    // carpeta, así que un `start()` posterior vuelve a cargar esas credenciales
    // muertas → Baileys intenta *reanudar* la sesión (no emite QR) → 401 de nuevo.
    // Resultado: el botón "Generar nuevo QR" nunca mostraba un QR. Acá, en el
    // reintento manual, borramos la sesión para arrancar una vinculación limpia.
    const err = (this.lastError || '').toLowerCase();
    if (err.includes('401') || err.includes('logged out') || err.includes('logout')) {
      clearAuthDir(config.baileys.authDir);
      console.log('🧹 [WHATSAPP BOT] Sesión inválida (401) borrada — se generará un QR nuevo para vincular.');
      this.qrRaw = null;
      this.qrCodeDataUrl = null;
      this.lastError = null;
    }

    await this.start();
  }
}

/**
 * Extensión de archivo a partir del mimetype real que declara WhatsApp. Antes el
 * nombre se fijaba siempre a `.jpg`, así que un PNG o un PDF de la cédula llegaban
 * al OCR con la extensión equivocada y `OcrAiService.guessMime()` los mandaba como
 * image/jpeg (o Tesseract intentaba rasterizar un PDF).
 */
function extFromMime(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('heic') || m.includes('heif')) return 'heic';
  return 'jpg';
}

export const whatsappBot = new BaileysClient();
