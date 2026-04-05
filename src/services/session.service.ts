import { sessionManager } from '@/lib/baileys/sessionManager';
import { sessionRepository } from '@/repositories/session.repository';
import { planQuotaService } from './planQuota.service';
import { Pagination } from '@/repositories/base.repository';
import { redis } from '@/lib/redis';
import { supabase } from '@/lib/supabase';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';

/**
 * Service orchestrating the full WhatsApp session lifecycle for multi-tenant users.
 * Coordinates between database records, Baileys sockets, and Redis-backed state.
 */
export class SessionService {
  /**
   * Creates a new WhatsApp session after verifying plan quotas.
   * userId is the primary owner; apiKeyId is used to check for Partner Sub-user context.
   */
  public async createSession(userId: string, apiKeyId?: string) {
    // 1. Quota Check - prevents over-provisioning
    await planQuotaService.checkSessionLimit(userId);

    // 2. Unique Session Generator
    const sessionId = `zap_${randomUUID().replace(/-/g, '').substring(0, 12)}`;

    // 3. Partner Sub-user Detection & Metadata
    let subUserId: string | undefined;
    if (apiKeyId) {
      const { data: subUser } = await supabase
        .from('partner_sub_users')
        .select('id, partner_id')
        .eq('api_key_id', apiKeyId)
        .maybeSingle();

      if (subUser) {
        subUserId = subUser.id;
        // Store sub-user metadata in Redis for fast routing on the hot path
        // This metadata allows Zaplink to bypass DB queries during inbound message routing.
        await redis.set(`session:${sessionId}:meta`, JSON.stringify({
          sub_user_id: subUser.id,
          partner_id: subUser.partner_id
        }), 'EX', 86400 * 30); // 30 day TTL
      }
    }

    // 4. Persist record to Supabase
    await sessionRepository.createRecord(userId, sessionId, subUserId);

    // 5. Initialize the Baileys socket
    await sessionManager.createSocket(sessionId, userId);

    return { sessionId };
  }

  /**
   * Requests a pairing code from WhatsApp using the existing socket.
   */
  public async getPairingCode(sessionId: string, phoneNumber: string) {
    const socket = sessionManager.getSocket(sessionId);
    if (!socket) {
      throw new AppError('SESSION_NOT_FOUND', 404, 'Active session socket not found.');
    }

    try {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const code = await socket.requestPairingCode(cleanPhone);
      return { code };
    } catch (err) {
      logger.error({ err, sessionId, phoneNumber }, 'Failed to request pairing code from Baileys');
      throw new AppError('SESSION_PAIRING_FAILED', 500, 'Unable to generate pairing code at this time.');
    }
  }

  /**
   * Gracefully deletes a session and cleans up all related resources.
   */
  public async deleteSession(sessionId: string) {
    // 1. Stop the socket and remove from manager
    await sessionManager.terminateSocket(sessionId);

    // 2. Wipe Redis auth and QR state
    const keys = await redis.keys(`session:${sessionId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    // 3. Delete the DB record
    await sessionRepository.deleteRecord(sessionId);
  }

  /**
   * Lists all user sessions enriched with live connection status.
   * Accepts optional pagination ({limit, offset}).
   */
  public async listSessions(userId: string, pagination?: Pagination) {
    const sessions = await sessionRepository.getByUserId(userId, pagination);

    return sessions.map(session => ({
      ...session,
      isOnline: sessionManager.isSocketActive(session.session_id)
    }));
  }

  /**
   * Fetches a single session by session_id, scoped to the owning userId.
   * Self-healing: if a session record exists in DB but the socket is not active,
   * re-attempts to ignite the socket for pending or authenticated sessions.
   */
  public async getSession(sessionId: string, userId: string) {
    const session = await sessionRepository.getBySessionId(sessionId);
    if (!session || session.user_id !== userId) {
      throw new AppError('SESSION_NOT_FOUND', 404, `Session not found: ${sessionId}`);
    }

    let isOnline = sessionManager.isSocketActive(sessionId);

    // Self-healing: if DB says it should be pending/authenticated but socket is dead
    if (!isOnline && (session.status === 'pending' || session.status === 'authenticated' || session.status === 'disconnected')) {
      logger.info({ sessionId }, '🛡️ Self-healing: Re-animating zombie session socket');
      try {
        // Reset reconnect attempts in Redis so it doesn't give up immediately
        await redis.del(`session:${sessionId}:reconnect_attempts`);
        await sessionManager.createSocket(sessionId, userId);
        isOnline = true;
      } catch (err) {
        logger.warn({ err, sessionId }, 'Failed to re-animate session during getSession');
      }
    }

    return {
      ...session,
      isOnline,
    };
  }

  /**
   * Fetches the latest QR code for an unauthenticated session.
   */
  public async getLatestQR(sessionId: string) {
    const qr = await redis.get(`session:${sessionId}:qr`);
    if (!qr) {
      const session = await sessionRepository.getBySessionId(sessionId);
      if (!session) throw new AppError('SESSION_NOT_FOUND', 404);
      if (session.status === 'authenticated') {
        throw new AppError('SESSION_ALREADY_EXISTS', 400, 'Session already logged in');
      }
      throw new AppError('SESSION_QR_EXPIRED', 404, 'QR code either not generated yet or expired. Please refresh.');
    }
    return qr;
  }
}

export const sessionService = new SessionService();