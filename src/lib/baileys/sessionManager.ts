import makeWASocket, { 
  DisconnectReason, 
  WASocket, 
  fetchLatestBaileysVersion, 
  ConnectionState, 
  useMultiFileAuthState 
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { redis } from '@/lib/redis';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { useBaileysAuthState } from './authStateAdapter';
import { baileysActiveSessions } from '@/lib/metrics';
import { slack } from '@/lib/slack';

/**
 * Singleton Session Manager for maintaining active Baileys WhatsApp sockets.
 * Handles lifecycle events and persistent status updates.
 */
export class SessionManager {
  private static instance: SessionManager;
  private sockets = new Map<string, WASocket>();

  private constructor() {}

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Initializes or re-connects a specific WhatsApp session.
   */
  public async createSocket(sessionId: string): Promise<WASocket> {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useBaileysAuthState(sessionId, redis);

    const socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: logger.child({ module: 'baileys', sessionId }) as any,
    });

    this.sockets.set(sessionId, socket);
    baileysActiveSessions.set(this.sockets.size);

    socket.ev.on('creds.update', saveCreds);

    const reconnectCounterKey = `session:${sessionId}:reconnect_attempts`;

    socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Store the QR in Redis with a 60-second TTL as required
        await redis.set(`session:${sessionId}:qr`, qr, 'EX', 60);
        await redis.publish(`session:${sessionId}:events`, JSON.stringify({ type: 'qr', data: qr }));
        logger.debug({ sessionId }, '🔄 QR Updated');
      }

      if (connection === 'open') {
        logger.info({ sessionId }, '✅ Connection opened');
        await this.updateSessionStatus(sessionId, 'authenticated');
        // Clear QR from Redis on success
        await redis.del(`session:${sessionId}:qr`);
        await redis.del(reconnectCounterKey); // Reset retry counter on success
        await redis.publish(`session:${sessionId}:events`, JSON.stringify({ type: 'connected' }));
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn({ sessionId, statusCode }, '🛑 Connection closed');
        await this.updateSessionStatus(sessionId, 'disconnected');

        if (shouldReconnect) {
          const attempts = await redis.incr(reconnectCounterKey);
          if (attempts > 3) {
            logger.error({ sessionId }, '🚨 Max reconnect attempts reached');
            await slack.sendAlert('warning', 'WhatsApp Disconnected', `Session ${sessionId} failed after 3 reconnect attempts.`, {
              sessionId,
              statusCode,
            });
            this.sockets.delete(sessionId);
            return;
          }
          logger.info({ sessionId, attempts }, '🔄 Reconnecting...');
          await this.createSocket(sessionId);
        } else {
          this.sockets.delete(sessionId);
          await this.updateSessionStatus(sessionId, 'logged_out');
        }
      }
    });

    return socket;
  }

  /**
   * Gracefully close and cleanup a session socket
   */
  public async terminateSocket(sessionId: string) {
    const socket = this.sockets.get(sessionId);
    if (socket) {
      socket.end(undefined);
      this.sockets.delete(sessionId);
      baileysActiveSessions.set(this.sockets.size);
    }
    await redis.del(`session:${sessionId}:qr`);
  }

  public getSocket(sessionId: string): WASocket | undefined {
    return this.sockets.get(sessionId);
  }

  public isSocketActive(sessionId: string): boolean {
    const socket = this.sockets.get(sessionId);
    return !!socket;
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
   * Re-hydrates all existing authenticated sessions on process start.
   */
  public async rehydrateSessions() {
    const { data: sessions, error } = await supabase
      .from('whatsapp_sessions')
      .select('session_id')
      .eq('status', 'authenticated');

    if (error) {
      logger.error({ error }, 'Failed to fetch sessions for re-hydration');
      return;
    }

    logger.info({ count: sessions?.length }, '🚀 Re-hydrating active sessions...');
    
    for (const session of sessions || []) {
      try {
        await this.createSocket(session.session_id);
      } catch (err) {
        logger.error({ err, sessionId: session.session_id }, 'Failed to re-hydrate session');
      }
    }
  }

  public getActiveSessionsCount(): number {
    return this.sockets.size;
  }
}

export const sessionManager = SessionManager.getInstance();
