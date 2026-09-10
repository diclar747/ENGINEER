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

export interface BotEvent {
  id: string;
  ts: number;
  dir: 'in' | 'out' | 'sys';
  jid?: string;
  phone?: string;
  kind?: string; // text | image | audio | document | connection
  preview?: string;
  status?: 'received' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';
  msgId?: string;
  error?: string;
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
  private sessionSince: number | null = null;
  /** IDs de mensajes ya atendidos — evita procesar dos veces el mismo (append + notify, replays al reconectar). */
  private seenMsgIds = new Set<string>();
  /** Nº de generación del socket. Los listeners de un socket viejo (fugado tras un
   *  reconnect que no lo destruyó) comparan contra esto y se abortan solos, así no
   *  hay doble procesado del mismo inbound. */
  private socketGen = 0;
  /** Última vez que se procesó un inbound por chat — freno anti-rebote (mismo mensaje entregado dos veces). */
  private lastInboundAt = new Map<string, number>();
  /** (chat|firma-de-contenido) → timestamp. Dedup por CONTENIDO: la sesión @lid
   *  reentrega el mismo mensaje con id distinto y a >2 s; esto lo corta igual. */
  private recentContent = new Map<string, number>();
  /** chat → epoch hasta el cual se ignora todo de ese chat (cortafuegos anti-ráfaga). */
  private burstCooldown = new Map<string, number>();
  /** epoch del último QR mostrado — solo tras un pareo FRESCO hay ráfaga de historial. */
  private lastQrAt = 0;
  /** control del bucle de "restart required" (515). */
  private last515At = 0;
  private restart515Count = 0;
  /** Últimos envíos (jid|texto → timestamp) — evita mandar DOS VECES el mismo mensaje
   *  al mismo chat en pocos segundos (re-entrega de WhatsApp, replay tras reinicio,
   *  listener duplicado momentáneo). Es la última red de seguridad del doble mensaje. */
  private lastOutbound = new Map<string, number>();
  private static readonly OUTBOUND_DEDUP_MS = 20_000;

  /** ¿Ya mandamos este texto exacto a este chat hace <20 s? (y registra el envío) */
  private isDuplicateOutbound(jid: string, text: string): boolean {
    const now = Date.now();
    // limpieza barata
    if (this.lastOutbound.size > 400) {
      for (const [k, t] of this.lastOutbound) if (now - t > 120_000) this.lastOutbound.delete(k);
    }
    const key = `${jid}|${text}`;
    const prev = this.lastOutbound.get(key) || 0;
    if (now - prev < BaileysClient.OUTBOUND_DEDUP_MS) return true;
    this.lastOutbound.set(key, now);
    return false;
  }

  /**
   * Cierre ordenado para el apagado del proceso (SIGTERM en un redeploy): suelta ya
   * la conexión de WhatsApp para que el contenedor NUEVO no quede solapado con el
   * viejo sobre la misma sesión (esa ventana de solape es la que producía respuestas
   * dobles durante los despliegues). NO hace logout (no invalida la sesión).
   */
  public stop(): void {
    this.socketGen++; // invalida los listeners del socket actual
    this.isConnected = false;
    try { this.teardownSocket(); } catch { /* noop */ }
  }

  /** Cierra y desengancha el socket actual antes de crear uno nuevo (evita listeners fugados). */
  private teardownSocket(): void {
    const s = this.sock;
    this.sock = null;
    if (!s) return;
    try { s.ev.removeAllListeners('messages.upsert'); } catch { /* noop */ }
    try { s.ev.removeAllListeners('messages.update'); } catch { /* noop */ }
    try { s.ev.removeAllListeners('connection.update'); } catch { /* noop */ }
    try { s.ev.removeAllListeners('creds.update'); } catch { /* noop */ }
    try { (s as any).end?.(undefined); } catch { /* noop */ }
    try { (s as any).ws?.close?.(); } catch { /* noop */ }
  }

  /** Búfer en memoria de los últimos eventos del bot (para el panel admin). Se pierde al reiniciar. */
  private events: BotEvent[] = [];
  private static readonly MAX_EVENTS = 500;

  private logEvent(e: Omit<BotEvent, 'id' | 'ts'> & { ts?: number }): void {
    const fullText = e.preview;
    const ev: BotEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: e.ts ?? Date.now(),
      ...e,
      // El buffer en memoria (panel "en vivo") recorta el preview a 160 chars;
      // el texto completo se guarda sin recortar en BotMessageLog (historial).
      preview: e.preview ? String(e.preview).replace(/\s+/g, ' ').slice(0, 160) : e.preview,
    };
    this.events.unshift(ev);
    if (this.events.length > BaileysClient.MAX_EVENTS) this.events.length = BaileysClient.MAX_EVENTS;
    this.persistEvent(ev, fullText).catch(() => {});
  }

  /** Guarda el mensaje en BotMessageLog (historial persistente para el panel admin). */
  private async persistEvent(ev: BotEvent, fullText?: string): Promise<void> {
    try {
      await prisma.botMessageLog.create({
        data: {
          id: ev.id,
          ts: new Date(ev.ts),
          dir: ev.dir,
          jid: ev.jid || null,
          phone: ev.phone || null,
          kind: ev.kind || null,
          text: fullText ?? ev.preview ?? null,
          status: ev.status || null,
          msgId: ev.msgId || null,
          error: ev.error || null,
        },
      });
    } catch (e: any) {
      console.warn('[WHATSAPP BOT] no se pudo guardar el mensaje en BotMessageLog:', e?.message);
    }
  }

  private setEventStatus(msgId: string | null | undefined, status: BotEvent['status']): void {
    if (!msgId) return;
    const ev = this.events.find((x) => x.msgId === msgId && x.dir === 'out');
    if (ev) ev.status = status;
    prisma.botMessageLog.updateMany({ where: { msgId, dir: 'out' }, data: { status } }).catch(() => {});
  }

  /** Eventos recientes, con filtros opcionales. */
  public getEvents(opts: { limit?: number; dir?: string; phone?: string; status?: string } = {}): BotEvent[] {
    let list = this.events;
    if (opts.dir) list = list.filter((e) => e.dir === opts.dir);
    if (opts.phone) list = list.filter((e) => (e.phone || '').includes(opts.phone!) || (e.jid || '').includes(opts.phone!));
    if (opts.status) list = list.filter((e) => e.status === opts.status);
    return list.slice(0, Math.min(opts.limit || 100, BaileysClient.MAX_EVENTS));
  }

  /** Métricas agregadas de las últimas 24 h para los tiles del panel. */
  public getMetrics() {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = this.events.filter((e) => e.ts >= dayAgo);
    const out = recent.filter((e) => e.dir === 'out');
    const delivered = out.filter((e) => e.status === 'delivered' || e.status === 'read').length;
    const failed = out.filter((e) => e.status === 'failed').length;
    return {
      inbound24h: recent.filter((e) => e.dir === 'in').length,
      outbound24h: out.length,
      delivered24h: delivered,
      failed24h: failed,
      deliveryRate: out.length ? Math.round((delivered / out.length) * 100) : null,
    };
  }

  /** ¿Está un número en WhatsApp? Devuelve su jid/lid. Para la herramienta del panel. */
  public async lookupNumber(phone: string): Promise<{ exists: boolean; jid?: string; lid?: string } | null> {
    const clean = (phone || '').replace(/[^0-9]/g, '');
    if (!this.sock || !/^\d{7,15}$/.test(clean)) return null;
    try {
      const res = await this.sock.onWhatsApp(clean);
      const hit: any = Array.isArray(res) ? res[0] : undefined;
      if (!hit) return { exists: false };
      return { exists: hit.exists !== false, jid: hit.jid, lid: hit.lid };
    } catch {
      return null;
    }
  }

  private markSeen(id: string): boolean {
    if (this.seenMsgIds.has(id)) return false;
    this.seenMsgIds.add(id);
    if (this.seenMsgIds.size > 8000) {
      // recorta el más viejo (orden de inserción)
      this.seenMsgIds.delete(this.seenMsgIds.values().next().value as string);
    }
    return true;
  }

  public async start(): Promise<void> {
    if (this.isConnecting || this.isConnected) return;
    this.isConnecting = true;
    this.gaveUp = false;
    // Un reconnect anterior pudo dejar un socket vivo con sus listeners → destruílo.
    this.teardownSocket();
    const myGen = ++this.socketGen;

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
        // ONLINE al conectar: si el bot figura offline, WhatsApp no da por
        // entregados los mensajes y los REEMPUJA sin parar (bucle de "historial"
        // que reprocesaba cada respuesta vieja del registro). Online + acuse
        // explícito de cada mensaje corta ese reenvío en origen.
        markOnlineOnConnect: true,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        if (this.socketGen !== myGen) return; // listener de un socket viejo
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          const firstOfSession = !this.qrRaw;
          this.qrRaw = qr;
          this.lastQrAt = Date.now();
          this.qrCodeDataUrl = await QRCode.toDataURL(qr);
          if (firstOfSession) {
            console.log('📲 [WHATSAPP BOT] Pairing QR ready — open /bot-connect in the web app or GET /api/bot/status. (auto-refreshes until scanned)');
            this.logEvent({ dir: 'sys', kind: 'connection', preview: 'QR de vinculación generado', status: 'skipped' });
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
          this.logEvent({ dir: 'sys', kind: 'connection', preview: `Desconectado (${err?.message || 'close'} [${statusCode ?? '?'}])`, status: 'failed' });
          this.isConnected = false;
          this.isConnecting = false;
          this.sessionSince = null;

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

          // 515 (restartRequired) fires una vez tras escanear el QR — es esperado.
          // Si se REPITE seguido (sesión inestable), NO reconectar a 1 s en bucle
          // (eso martilla a WhatsApp y deja el bot inservible): backoff progresivo.
          if (statusCode === DisconnectReason.restartRequired) {
            const now = Date.now();
            this.restart515Count = now - this.last515At < 180_000 ? this.restart515Count + 1 : 1;
            this.last515At = now;
            const delay = this.restart515Count <= 1 ? 1_000 : Math.min(60_000, 4_000 * this.restart515Count);
            console.log(`🔄 [WHATSAPP BOT] Restart required (${this.restart515Count}x) — reconecto en ${Math.round(delay / 1000)}s…`);
            setTimeout(() => this.start(), delay);
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
          this.sessionSince = Date.now();
          this.logEvent({ dir: 'sys', kind: 'connection', preview: `Conectado como ${(this.sock as any)?.user?.id?.split(':')[0] || '?'}`, status: 'delivered' });
        }
      });

      // Acuses de entrega / lectura → actualizan el estado del evento saliente.
      this.sock.ev.on('messages.update', (updates) => {
        if (this.socketGen !== myGen) return;
        for (const u of updates) {
          const st = (u.update as any)?.status;
          if (st == null) continue;
          // proto Status: 1=SERVER_ACK(enviado) 2=DELIVERY_ACK(entregado) 3=READ 4=PLAYED
          const mapped: BotEvent['status'] =
            st >= 4 ? 'read' : st === 3 ? 'read' : st === 2 ? 'delivered' : 'sent';
          this.setEventStatus(u.key?.id, mapped);
        }
      });

      // Handle inbound messages — 1:1 DMs only.
      // SOLO `notify` = mensaje nuevo en vivo. `append` = mensajes que WhatsApp agrega
      // al chat = SIEMPRE historial/sincronización. Se ignora entero: al re-vincular,
      // WhatsApp reproduce toda la conversación vieja como `append` (con timestamp
      // "ahora"), y el bot procesaba cada mensaje viejo ("1", "ACEPTO", la foto…) y
      // se comía los pasos del registro. Perder el primer mensaje post-QR (raro) es
      // mucho mejor que reproducir 40 mensajes de historial.
      this.sock.ev.on('messages.upsert', async (m) => {
        if (this.socketGen !== myGen) return; // listener de un socket viejo → ignorar
        if (m.type !== 'notify') {
          if (m.type === 'append') {
            console.log(`[WHATSAPP BOT] Ignoro batch 'append' (${m.messages?.length ?? 0} msgs) — historial/sincronización, no en vivo.`);
          }
          return;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        // Ventana de gracia SOLO tras un pareo FRESCO (QR escaneado): ahí WhatsApp
        // vuelca el historial como `notify`. En una RECONEXIÓN normal NO hay ráfaga
        // (markOnlineOnConnect + ack ya lo cortan) → aplicar gracia ahí dejaba al
        // bot sin responder si el usuario escribía justo después de reconectar.
        const freshPair = this.lastQrAt > 0 && Date.now() - this.lastQrAt < 90_000;
        const sinceConnect = this.sessionSince ? Date.now() - this.sessionSince : Number.MAX_SAFE_INTEGER;
        if (freshPair && sinceConnect < 20_000) {
          console.log(`[WHATSAPP BOT] Gracia post-pareo (${Math.round(sinceConnect / 1000)}s) — ignoro ${m.messages?.length ?? 0} msg(s).`);
          return;
        }

        for (const msg of m.messages) {
          if (!msg.key) continue;
          const ts = Number(msg.messageTimestamp) || 0;

          // Mensaje viejo (historial que llegó como notify): un mensaje EN VIVO tiene
          // timestamp de hace segundos, no de hace minutos.
          if (ts && nowSec - ts > 90) {
            console.log(`[WHATSAPP BOT] Ignoro mensaje viejo (${nowSec - ts}s) de ${msg.key.remoteJid} — historial.`);
            continue;
          }

          const dupById = msg.key.id ? !this.markSeen(`id:${msg.key.id}`) : false;
          const dupByTs = ts ? !this.markSeen(`ts:${msg.key.remoteJid || '?'}|${ts}`) : false;
          if (dupById || dupByTs) {
            continue; // ya atendido (replay del mismo mensaje)
          }

          // Cortafuegos anti-ráfaga: tras atender UN mensaje de un chat, se ignora
          // todo lo que llegue de ESE chat en los próximos 3 s. Una persona en el
          // registro deja segundos entre paso y paso; una reproducción de historial
          // vuelca 5-6 mensajes seguidos → solo pasa el primero.
          const cd = this.burstCooldown.get(msg.key.remoteJid || '') || 0;
          if (Date.now() < cd) {
            console.log(`[WHATSAPP BOT] Cortafuegos anti-ráfaga: ignoro ${msg.key.remoteJid} (quedan ${cd - Date.now()}ms)`);
            continue;
          }
          this.burstCooldown.set(msg.key.remoteJid || '', Date.now() + 3000);

          if (msg.key.fromMe) {
            // Messages sent FROM the bot's own linked account (e.g. testing by writing
            // to yourself from the same phone the bot is paired to) are ignored on
            // purpose — otherwise the bot would reply to its own messages in a loop.
            // Test the real flow from a DIFFERENT phone number.
            const dbgTxt =
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              '[media/otro]';
            console.log(
              `[WHATSAPP BOT] Ignorando mensaje propio (fromMe) · remoteJid="${msg.key.remoteJid}" · participant="${msg.key.participant || ''}" · texto="${String(dbgTxt).slice(0, 40)}"`
            );
            this.logEvent({
              dir: 'in',
              jid: msg.key.remoteJid || undefined,
              phone: (msg.key.remoteJid || '').split('@')[0],
              kind: 'text',
              preview: `[IGNORADO fromMe] ${String(dbgTxt).slice(0, 120)}`,
              status: 'skipped',
              msgId: msg.key.id || undefined,
            });
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
          // Acuse explícito: le decimos a WhatsApp que este mensaje ya llegó y se
          // leyó → deja de reempujarlo (era la fuente del bucle de "historial").
          this.sock?.readMessages([msg.key]).catch(() => {});
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

    const nowMs = Date.now();
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

    const inKind = audioMessage ? 'audio' : imageMessage ? 'image' : documentMessage ? 'document' : 'text';

    // Dedup principal: por CONTENIDO. Esta sesión @lid reentrega el MISMO mensaje
    // muchísimas veces (key.id distinto, hasta con varios segundos entre medio) y
    // también reentrega mensajes de rato atrás. Firmamos por (chat + contenido):
    // media = fileSha256 del protocolo (sin descargar); texto = el texto. Si esa
    // firma ya se atendió hace <120 s, se ignora. Preciso: NO descarta un mensaje
    // legítimo distinto aunque llegue pegado al anterior (antes el freno por tiempo
    // de 1,5 s se comía el "1" de confirmar la cédula durante la lluvia de reentregas).
    const sha =
      (imageMessage?.fileSha256 as Uint8Array | undefined) ||
      (documentMessage?.fileSha256 as Uint8Array | undefined) ||
      (audioMessage?.fileSha256 as Uint8Array | undefined);
    const bodyNorm = body.trim().toLowerCase();
    const contentSig = sha ? `${inKind}:${Buffer.from(sha).toString('base64')}` : `text:${bodyNorm}`;
    if (body || sha) {
      // Respuestas cortas ("1", "si", "no", "ok") se repiten de verdad en un flujo
      // por pasos → ventana chica (4 s, solo mata la ráfaga de reentregas). Media y
      // textos largos casi nunca se repiten a propósito → ventana larga (2 min).
      const shortAnswer = !sha && bodyNorm.length <= 4;
      const windowMs = shortAnswer ? 4_000 : 120_000;
      const ck = `${remoteJid}|${contentSig}`;
      const seenAt = this.recentContent.get(ck) || 0;
      if (nowMs - seenAt < windowMs) {
        console.warn(`[WHATSAPP BOT] Inbound duplicado por contenido, ignoro (${remoteJid}, ${inKind}, ${nowMs - seenAt}ms)`);
        return;
      }
      this.recentContent.set(ck, nowMs);
      if (this.recentContent.size > 800) {
        for (const [k, t] of this.recentContent) if (nowMs - t > 180_000) this.recentContent.delete(k);
      }
    }

    // Guarda extra SOLO contra doble-procesado casi simultáneo del MISMO arribo
    // físico (dos listeners, o la misma tanda entregada dos veces en el mismo ms).
    // Ventana chica (600 ms) para no comerse mensajes legítimos rápidos.
    const prev = this.lastInboundAt.get(remoteJid) || 0;
    if (nowMs - prev < 600) {
      console.warn(`[WHATSAPP BOT] Anti-rebote (600ms): ignoro inbound de ${remoteJid} (${nowMs - prev}ms)`);
      return;
    }
    this.lastInboundAt.set(remoteJid, nowMs);
    if (this.lastInboundAt.size > 500) {
      for (const [k, t] of this.lastInboundAt) if (nowMs - t > 60_000) this.lastInboundAt.delete(k);
    }

    this.logEvent({
      dir: 'in',
      jid: remoteJid,
      phone: rawPhone,
      kind: inKind,
      preview: body || `[${inKind}]`,
      status: 'received',
      msgId: msg.key.id || undefined,
    });

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
        isLid,
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

  private jidCache = new Map<string, string>();

  /**
   * Resuelve un target a un JID válido para ENVIAR. Si es un número pelado, consulta
   * `onWhatsApp`: WhatsApp está migrando a direccionamiento LID y en varias cuentas los
   * envíos a `<num>@s.whatsapp.net` NO se entregan (sin lanzar error) — hay que usar el
   * `jid`/`lid` que devuelve la API. Si el número no está en WhatsApp, devuelve null.
   */
  private async resolveJidForSend(target: string): Promise<string | null> {
    const raw = (target || '').trim();
    if (raw.includes('@')) {
      return /^\d{7,20}@(s\.whatsapp\.net|lid)$/.test(raw) ? raw : null;
    }
    const cleanPhone = raw.replace(/[^0-9]/g, '');
    if (!/^\d{7,15}$/.test(cleanPhone)) return null;

    const cached = this.jidCache.get(cleanPhone);
    if (cached) return cached;

    const fallback = `${cleanPhone}@s.whatsapp.net`;
    if (!this.sock) return fallback;
    try {
      const res = await this.sock.onWhatsApp(cleanPhone);
      const hit: any = Array.isArray(res) ? res[0] : undefined;
      console.log(`[WHATSAPP BOT] onWhatsApp(${cleanPhone}) -> ${JSON.stringify(hit || null)}`);
      if (!hit || hit.exists === false) {
        console.warn(`[WHATSAPP BOT] ${cleanPhone} NO está en WhatsApp — no se envía.`);
        return null;
      }
      const jid = hit.lid || hit.jid || fallback;
      this.jidCache.set(cleanPhone, jid);
      return jid;
    } catch (e: any) {
      console.warn(`[WHATSAPP BOT] onWhatsApp(${cleanPhone}) falló (${e?.message}) — uso ${fallback}`);
      return fallback;
    }
  }

  /**
   * Sends a plain text WhatsApp message
   */
  public async sendMessage(target: string, text: string): Promise<boolean> {
    const phone = (target || '').replace(/[^0-9@.]/g, '').split('@')[0];
    const jid = await this.resolveJidForSend(target);
    if (!jid) {
      console.warn(`[WHATSAPP BOT] Refusing to send to invalid target "${target}"`);
      this.logEvent({ dir: 'out', phone, kind: 'text', preview: text, status: 'failed', error: 'destino inválido o no está en WhatsApp' });
      return false;
    }

    // Última red contra el doble mensaje: si ya mandamos ESTE texto exacto a ESTE
    // chat hace menos de 20 s, no lo repetimos (re-entrega de WhatsApp / replay tras
    // reinicio / listener duplicado). No afecta el uso normal: el bot nunca manda el
    // mismo texto dos veces seguidas al mismo chat a propósito.
    if (this.isDuplicateOutbound(jid, text)) {
      console.warn(`[WHATSAPP BOT] Envío duplicado evitado -> ${jid}: ${text.slice(0, 60)}…`);
      this.logEvent({ dir: 'out', jid, phone, kind: 'text', preview: text, status: 'skipped', error: 'duplicado (anti doble mensaje)' });
      return true;
    }

    console.log(`\n📨 [WHATSAPP OUTBOUND -> ${jid}]:\n${text}\n----------------------------------`);

    if (this.sock && this.isConnected) {
      try {
        const sent = await this.sock.sendMessage(jid, { text });
        this.logEvent({ dir: 'out', jid, phone, kind: 'text', preview: text, status: 'sent', msgId: sent?.key?.id || undefined });
        return true;
      } catch (err: any) {
        console.error(`Failed to send real WhatsApp message to ${jid}:`, err);
        this.logEvent({ dir: 'out', jid, phone, kind: 'text', preview: text, status: 'failed', error: err?.message || String(err) });
        return false;
      }
    }

    this.logEvent({ dir: 'out', jid, phone, kind: 'text', preview: text, status: 'skipped', error: 'bot desconectado' });
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
    const jid = await this.resolveJidForSend(target);
    if (!jid) {
      console.warn(`[WHATSAPP BOT] Refusing to send image to invalid target "${target}"`);
      return false;
    }

    console.log(`🖼️ [WHATSAPP IMAGE -> ${jid}]: (${buffer.length} bytes)`);
    const phone = jid.split('@')[0];

    if (this.sock && this.isConnected) {
      try {
        const sent = await this.sock.sendMessage(jid, { image: buffer, mimetype, caption });
        this.logEvent({ dir: 'out', jid, phone, kind: 'image', preview: caption || '[imagen]', status: 'sent', msgId: sent?.key?.id || undefined });
        return true;
      } catch (err: any) {
        console.error(`Failed to send image to ${jid}:`, err);
        this.logEvent({ dir: 'out', jid, phone, kind: 'image', preview: caption || '[imagen]', status: 'failed', error: err?.message || String(err) });
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
    const jid = await this.resolveJidForSend(target);
    if (!jid) {
      console.warn(`[WHATSAPP BOT] Refusing to send document to invalid target "${target}"`);
      return false;
    }

    console.log(`📎 [WHATSAPP ATTACHMENT -> ${jid}]: Document ${fileName} (${buffer.length} bytes)`);
    const phone = jid.split('@')[0];

    if (this.sock && this.isConnected) {
      try {
        const sent = await this.sock.sendMessage(jid, {
          document: buffer,
          mimetype,
          fileName,
          caption,
        });
        this.logEvent({ dir: 'out', jid, phone, kind: 'document', preview: caption || fileName, status: 'sent', msgId: sent?.key?.id || undefined });
        return true;
      } catch (err: any) {
        console.error(`Failed to send document to ${jid}:`, err);
        this.logEvent({ dir: 'out', jid, phone, kind: 'document', preview: caption || fileName, status: 'failed', error: err?.message || String(err) });
        return false;
      }
    }

    return true;
  }

  public getStatus() {
    const me: any = this.sock?.user;
    return {
      connected: this.isConnected,
      connecting: this.isConnecting,
      qrCode: this.qrCodeDataUrl,
      reconnectAttempts: this.reconnectAttempts,
      gaveUp: this.gaveUp,
      lastError: this.lastError,
      meNumber: me?.id ? String(me.id).split(':')[0].split('@')[0] : null,
      meName: me?.name || me?.verifiedName || null,
      sessionSince: this.sessionSince,
      metrics: this.getMetrics(),
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
