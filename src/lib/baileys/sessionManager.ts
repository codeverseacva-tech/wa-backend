import makeWASocket, {
  DisconnectReason,
  WASocket,
  fetchLatestBaileysVersion,
  ConnectionState,
  proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { redis } from '@/lib/redis';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { config } from '@/config';
import { useBaileysAuthState } from './authStateAdapter';
import { baileysActiveSessions } from '@/lib/metrics';
import { slack } from '@/lib/slack';
import { webhookService } from '@/services/webhook.service';

/**
 * Internal session entry — holds the socket and the owning user's ID
 * so that message events can be dispatched to the correct webhook fan-out.
 */
interface SessionEntry {
  socket: WASocket;
  userId: string;
}

/**
 * Resolves the best available JID for the 'from' field.
 * WhatsApp increasingly uses LID format (@lid) for privacy.
 * remoteJidAlt, when present, holds the original phone-number JID (@s.whatsapp.net).
 * We expose the phone-number JID as `from` and keep the raw LID as `fromLid`.
 */
function resolveFromJid(msg: proto.IWebMessageInfo): { from: string; fromLid: string | null } {
  const key = msg.key ?? {};
  const remoteJid = key.remoteJid ?? '';
  const remoteJidAlt = (key as any).remoteJidAlt as string | undefined;

  if (remoteJidAlt && !remoteJidAlt.endsWith('@lid')) {
    // remoteJidAlt is the normalised phone JID; remoteJid is the LID
    return { from: remoteJidAlt, fromLid: remoteJid };
  }

  if (remoteJid.endsWith('@lid') && remoteJidAlt) {
    // remoteJid is LID, remoteJidAlt is the phone JID
    return { from: remoteJidAlt, fromLid: remoteJid };
  }

  // No LID involved — remoteJid is already a phone JID
  return { from: remoteJid, fromLid: null };
}

/**
 * Extracts a normalised message type string from a Baileys message object.
 * Falls back to "unknown" for unsupported or missing message types.
 */
function extractMessageType(msg: proto.IWebMessageInfo): string {
  const m = msg.message;
  if (!m) return 'unknown';
  if (m.conversation || m.extendedTextMessage) return 'text';
  if (m.imageMessage) return 'image';
  if (m.audioMessage) return 'audio';
  if (m.videoMessage) return 'video';
  if (m.documentMessage) return 'document';
  if (m.stickerMessage) return 'sticker';
  if (m.locationMessage) return 'location';
  if (m.contactMessage) return 'contact';
  if (m.reactionMessage) return 'reaction';
  return 'unknown';
}

/**
 * Extracts plain text from a Baileys message where available.
 * Returns null for media-only messages.
 */
function extractText(msg: proto.IWebMessageInfo): string | null {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    null
  );
}

/**
 * Singleton Session Manager for maintaining active Baileys WhatsApp sockets.
 * Handles lifecycle events, persistent status updates, and webhook fan-out
 * for all inbound WhatsApp messages.
 */
export class SessionManager {
  private static instance: SessionManager;

  /**
   * Each entry stores both the live socket and the userId that owns it.
   * userId is required to route incoming messages to the correct webhooks.
   */
  private sockets = new Map<string, SessionEntry>();

  private constructor() { }

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Initializes or re-connects a specific WhatsApp session.
   * userId is stored alongside the socket so message events can be
   * dispatched to the correct webhook fan-out without an extra DB lookup.
   */
  public async createSocket(sessionId: string, userId: string): Promise<WASocket> {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useBaileysAuthState(sessionId, redis);

    const socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: logger.child({ module: 'baileys', sessionId }) as any,
    });

    this.sockets.set(sessionId, { socket, userId });
    baileysActiveSessions.set(this.sockets.size);

    socket.ev.on('creds.update', saveCreds);

    const reconnectCounterKey = `session:${sessionId}:reconnect_attempts`;

    // -------------------------------------------------------------------------
    // CONNECTION LIFECYCLE
    // -------------------------------------------------------------------------
    socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        await redis.set(`session:${sessionId}:qr`, qr, 'EX', 60);
        await redis.publish(`session:${sessionId}:events`, JSON.stringify({ type: 'qr', data: qr }));
        logger.debug({ sessionId }, '🔄 QR Updated');
      }

      if (connection === 'open') {
        logger.info(`✅ Connection opened  sessionId: ${sessionId}`);
        await this.updateSessionStatus(sessionId, 'authenticated');

        // Link session to Partner Sub-user if metadata exists
        const metaStr = await redis.get(`session:${sessionId}:meta`);
        if (metaStr) {
          const meta = JSON.parse(metaStr);
          if (meta.sub_user_id) {
            await supabase
              .from('partner_sub_users')
              .update({ session_id: sessionId })
              .eq('id', meta.sub_user_id);
            
            logger.info({ sessionId, subUserId: meta.sub_user_id }, '🔗 Linked session to partner sub-user');
          }
        }

        await redis.del(`session:${sessionId}:qr`);
        await redis.del(reconnectCounterKey);
        await redis.publish(`session:${sessionId}:events`, JSON.stringify({ type: 'connected' }));
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn({ sessionId, statusCode }, '🛑 Connection closed');
        if (config.api.nodeEnv === 'production') {
          await this.updateSessionStatus(sessionId, 'disconnected');
        }

        if (shouldReconnect) {
          const attempts = await redis.incr(reconnectCounterKey);
          if (attempts > 3) {
            logger.error({ sessionId }, '🚨 Max reconnect attempts reached');
            await slack.sendAlert(
              'warning',
              'WhatsApp Disconnected',
              `Session ${sessionId} failed after 3 reconnect attempts.`,
              { sessionId, statusCode }
            );
            this.sockets.delete(sessionId);
            baileysActiveSessions.set(this.sockets.size);
            return;
          }
          logger.info({ sessionId, attempts }, '🔄 Reconnecting...');
          await this.createSocket(sessionId, userId);
        } else {
          this.sockets.delete(sessionId);
          baileysActiveSessions.set(this.sockets.size);
          if (config.api.nodeEnv === 'production') {
            await this.updateSessionStatus(sessionId, 'logged_out');
          }
        }
      }
    });

    // -------------------------------------------------------------------------
    // INCOMING MESSAGE HANDLER — drives webhook fan-out
    // -------------------------------------------------------------------------
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      // Only process new messages — "append" is historical/already-seen
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Guard: stub events arrive without a message body — skip them
        if (!msg.message) continue;

        // Guard: skip protocol/system messages (e.g. key rotation, history sync)
        if (msg.message.protocolMessage) continue;

        const messageType = extractMessageType(msg);
        const text = extractText(msg);
        const fromMe = msg.key.fromMe ?? false;
        const { from, fromLid } = resolveFromJid(msg);
        const messageId = msg.key.id ?? '';
        const timestamp =
          typeof msg.messageTimestamp === 'number'
            ? msg.messageTimestamp
            : Number(msg.messageTimestamp ?? Date.now() / 1000);

        // Build a clean, consistent payload for webhook consumers.
        // `from`    — normalised phone-number JID (e.g. 254700000000@s.whatsapp.net)
        // `fromLid` — raw WhatsApp LID if the account uses it, null otherwise
        const payload = {
          sessionId,
          messageId,
          from,
          fromLid,
          fromMe,
          type: messageType,
          text,
          timestamp,
          raw: msg, // Full Baileys object for advanced consumers
        };

        const eventType = fromMe ? 'message.sent' : 'message.received';

        logger.info(
          { sessionId, userId, messageId, from, eventType },
          '📨 Dispatching message webhook'
        );

        // Dispatch event — identifies if it's a sub-user vs regular user
        webhookService.dispatchContextualEvent(eventType, payload, sessionId, userId).catch((err) => {
          logger.error(
            { err, sessionId, userId, messageId },
            'Webhook dispatchContextualEvent failed silently'
          );
        });
      }
    });

    return socket;
  }

  /**
   * Gracefully close and cleanup a session socket.
   */
  public async terminateSocket(sessionId: string) {
    const entry = this.sockets.get(sessionId);
    if (entry) {
      entry.socket.end(undefined);
      this.sockets.delete(sessionId);
      baileysActiveSessions.set(this.sockets.size);
    }
    await redis.del(`session:${sessionId}:qr`);
  }

  public getSocket(sessionId: string): WASocket | undefined {
    return this.sockets.get(sessionId)?.socket;
  }

  public isSocketActive(sessionId: string): boolean {
    return this.sockets.has(sessionId);
  }

  private async updateSessionStatus(sessionId: string, status: string) {
    try {
      await supabase
        .from('whatsapp_sessions')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('session_id', sessionId);
    } catch (err) {
      logger.error({ err, sessionId, status }, 'Failed to update session status in DB');
    }
  }

  /**
   * Re-hydrates all authenticated sessions on process start.
   * Selects user_id alongside session_id so each socket is created
   * with the correct userId for webhook routing.
   */
  public async rehydrateSessions() {
    const { data: sessions, error } = await supabase
      .from('whatsapp_sessions')
      .select('session_id, user_id')          // user_id added — required for webhook routing
      .eq('status', 'authenticated');

    if (error) {
      logger.error({ error }, 'Failed to fetch sessions for re-hydration');
      return;
    }

    logger.info(`Re-hydrating active sessions...  count: ${sessions?.length || 0}`);

    for (const session of sessions || []) {
      try {
        await this.createSocket(session.session_id, session.user_id);
      } catch (err) {
        logger.error(
          { err, sessionId: session.session_id },
          'Failed to re-hydrate session'
        );
      }
    }
  }

  public getActiveSessionsCount(): number {
    return this.sockets.size;
  }
}

export const sessionManager = SessionManager.getInstance();