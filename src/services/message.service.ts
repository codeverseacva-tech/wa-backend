import { sessionManager } from '@/lib/baileys/sessionManager';
import { MessagesRepository } from '@/repositories/messages.repository';
import { redis } from '@/lib/redis';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { createHash } from 'crypto';

const messagesRepository = new MessagesRepository();

/**
 * Service managing WhatsApp messaging operations including JID validation,
 * idempotency, and persistent logging.
 */
export class MessageService {
  /**
   * Sends a message through an active Baileys socket.
   * Includes a 10-minute idempotency window to prevent duplicate deliveries.
   */
  public async sendMessage(sessionId: string, to: string, payload: any) {
    // 1. JID Validation (@s.whatsapp.net for personal, @g.us for groups)
    if (!to.includes('@')) {
      throw new AppError('INVALID_JID', 400, 'Recipient JID format is invalid.');
    }

    // 2. Idempotency logic - prevent duplicate sends for the same payload
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const idempotencyKey = `msg_idemp:${sessionId}:${to}:${payloadHash}`;
    
    const cachedResponse = await redis.get(idempotencyKey);
    if (cachedResponse) {
      logger.info({ sessionId, to }, 'Idempotency hit: skipping duplicate message send');
      return JSON.parse(cachedResponse);
    }

    // 3. Retrieve Socket from Manager
    const socket = sessionManager.getSocket(sessionId);
    if (!socket || !sessionManager.isSocketActive(sessionId)) {
      throw new AppError('SESSION_NOT_AUTHENTICATED', 401, 'WhatsApp session is not authenticated or connected.');
    }

    try {
      // 4. Send with Baileys
      const result = await socket.sendMessage(to, payload);
      if (!result) throw new Error('Baileys socket returned null for sendMessage');

      // 5. Persist to Postgres via Repository
      const storedMessage = await messagesRepository.create({
        session_id: sessionId,
        from_jid: socket.user?.id.split(':')[0] + '@s.whatsapp.net', // Normalize JID
        to_jid: to,
        message_data: payload,
        key: result.key,
        status: 'sent',
        timestamp: Date.now(),
      });

      // 6. Cache the result for idempotency window (10 mins)
      await redis.set(idempotencyKey, JSON.stringify(storedMessage), 'EX', 600);

      return storedMessage;
    } catch (err) {
      logger.error({ err, sessionId, to }, 'High-level message sending failed');
      throw new AppError('MESSAGE_SEND_FAILED', 500, 'WhatsApp message delivery failed.');
    }
  }
}

export const messageService = new MessageService();
