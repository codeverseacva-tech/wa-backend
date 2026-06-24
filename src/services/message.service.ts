import { sessionManager } from '@/lib/baileys/sessionManager';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { sessionRepository } from '@/repositories/session.repository';
import { AnyMessageContent } from '@whiskeysockets/baileys';
import axios from 'axios';

/**
 * Normalizes a phone number to WhatsApp JID format.
 * e.g. "254712345678" -> "254712345678@s.whatsapp.net"
 */
const toJid = (to: string): string => {
  const clean = to.replace(/[^0-9]/g, '');
  return clean.includes('@') ? clean : `${clean}@s.whatsapp.net`;
};

/**
 * Fetches a remote URL and returns a Buffer.
 * Used for media messages sent via URL.
 */
const fetchBuffer = async (url: string): Promise<Buffer> => {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(res.data as ArrayBuffer);
  } catch (err: any) {
    logger.error({ err, url }, 'Failed to pre-fetch media from URL');
    throw new AppError('MEDIA_FETCH_FAILED', 400, `Failed to fetch media from URL: ${url}`);
  }
};

export class MessageService {

  /**
   * Core send dispatcher — routes to the correct Baileys sendMessage call
   * based on message type.
   */
  public async send(sessionId: string, payload: SendMessagePayload, userId?: string): Promise<SendMessageResult> {
    let socket = sessionManager.getSocket(sessionId);
    
    // 🛡️ Self-Healing logic for Zombie Sessions
    if (!socket) {
      const session = await sessionRepository.getBySessionId(sessionId);

      // Verify ownership if userId is provided
      if (userId && session && session.user_id !== userId) {
        throw new AppError('SESSION_NOT_FOUND', 404, `Session not found: ${sessionId}`);
      }

      if (session && (session.status === 'pending' || session.status === 'authenticated' || session.status === 'disconnected')) {
        logger.info({ sessionId }, '🛡️ Self-healing: Re-animating zombie session socket before sending message');
        try {
          await redis.del(`session:${sessionId}:reconnect_attempts`);
          socket = await sessionManager.createSocket(sessionId, session.user_id);
        } catch (err) {
          logger.warn({ err, sessionId }, 'Failed to re-animate session during send');
        }
      }

      if (!socket) {
        throw new AppError('SESSION_NOT_FOUND', 404, `No active socket for session: ${sessionId}`);
      }
    }

    const jid = toJid(payload.to);
    let content: AnyMessageContent;

    switch (payload.type) {

      // ─── TEXT ────────────────────────────────────────────────────────
      case 'text': {
        if (!payload.text) throw new AppError('VALIDATION_ERROR', 400, 'text is required for type=text');
        content = { text: payload.text };
        break;
      }

      // ─── IMAGE ───────────────────────────────────────────────────────
      case 'image': {
        if (!payload.url && !payload.base64) {
          throw new AppError('VALIDATION_ERROR', 400, 'url or base64 is required for type=image');
        }
        const imageData = payload.base64
          ? Buffer.from(payload.base64, 'base64')
          : { url: payload.url! };
        content = {
          image: imageData,
          caption: payload.caption,
          mimetype: payload.mimetype || 'image/jpeg',
        };
        break;
      }

      // ─── VIDEO ───────────────────────────────────────────────────────
      case 'video': {
        if (!payload.url && !payload.base64) {
          throw new AppError('VALIDATION_ERROR', 400, 'url or base64 is required for type=video');
        }
        const videoData = payload.base64
          ? Buffer.from(payload.base64, 'base64')
          : { url: payload.url! };
        content = {
          video: videoData,
          caption: payload.caption,
          mimetype: payload.mimetype || 'video/mp4',
          gifPlayback: payload.gif ?? false,
        };
        break;
      }

      // ─── AUDIO ───────────────────────────────────────────────────────
      case 'audio': {
        if (!payload.url && !payload.base64) {
          throw new AppError('VALIDATION_ERROR', 400, 'url or base64 is required for type=audio');
        }
        const audioData = payload.base64
          ? Buffer.from(payload.base64, 'base64')
          : { url: payload.url! };
        content = {
          audio: audioData,
          mimetype: payload.mimetype || 'audio/mpeg',
          ptt: payload.ptt ?? false,
        };
        break;
      }

      // ─── DOCUMENT ────────────────────────────────────────────────────
      case 'document': {
        if (!payload.url && !payload.base64) {
          throw new AppError('VALIDATION_ERROR', 400, 'url or base64 is required for type=document');
        }
        const docData = payload.base64
          ? Buffer.from(payload.base64, 'base64')
          : { url: payload.url! };
        content = {
          document: docData,
          mimetype: payload.mimetype || 'application/octet-stream',
          fileName: payload.filename || 'file',
          caption: payload.caption,
        };
        break;
      }

      // ─── STICKER ─────────────────────────────────────────────────────
      case 'sticker': {
        if (!payload.url && !payload.base64) {
          throw new AppError('VALIDATION_ERROR', 400, 'url or base64 is required for type=sticker');
        }
        const stickerData = payload.base64
          ? Buffer.from(payload.base64, 'base64')
          : { url: payload.url! };
        content = { sticker: stickerData };
        break;
      }

      // ─── LOCATION ────────────────────────────────────────────────────
      case 'location': {
        if (payload.latitude === undefined || payload.longitude === undefined) {
          throw new AppError('VALIDATION_ERROR', 400, 'latitude and longitude are required for type=location');
        }
        content = {
          location: {
            degreesLatitude: payload.latitude,
            degreesLongitude: payload.longitude,
            name: payload.location_name,
            address: payload.location_address,
          },
        };
        break;
      }

      // ─── CONTACT ─────────────────────────────────────────────────────
      case 'contact': {
        if (!payload.contact_name || !payload.contact_phone) {
          throw new AppError('VALIDATION_ERROR', 400, 'contact_name and contact_phone are required for type=contact');
        }
        const phone = payload.contact_phone.replace(/[^0-9]/g, '');
        const vcard = [
          'BEGIN:VCARD',
          'VERSION:3.0',
          `FN:${payload.contact_name}`,
          `TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}`,
          'END:VCARD',
        ].join('\n');
        content = {
          contacts: {
            displayName: payload.contact_name,
            contacts: [{ vcard }],
          },
        };
        break;
      }

      // ─── REACTION ────────────────────────────────────────────────────
      case 'reaction': {
        if (!payload.reaction_emoji || !payload.reaction_message_id) {
          throw new AppError('VALIDATION_ERROR', 400, 'reaction_emoji and reaction_message_id are required for type=reaction');
        }
        content = {
          react: {
            text: payload.reaction_emoji,
            key: {
              remoteJid: jid,
              id: payload.reaction_message_id,
              fromMe: payload.reaction_from_me ?? false,
            },
          },
        };
        break;
      }

      default:
        throw new AppError('VALIDATION_ERROR', 400, `Unsupported message type: ${(payload as any).type}`);
    }

    try {
      const sent = await socket.sendMessage(jid, content);
      logger.info({ sessionId, to: jid, type: payload.type }, '📤 Message sent');
      return {
        message_id: sent?.key?.id ?? null,
        to: jid,
        type: payload.type,
        status: 'sent',
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      logger.error({ err, sessionId, to: jid, type: payload.type }, '❌ Failed to send message');
      throw new AppError('MESSAGE_SEND_FAILED', 500, err.message || 'Failed to send message');
    }
  }

  /**
   * Alias used by bulk and scheduler workers.
   * Signature: sendMessage(sessionId, to, payload)
   */
  public async sendMessage(
    sessionId: string,
    to: string,
    payload: Omit<SendMessagePayload, 'to'>,
    userId?: string
  ): Promise<SendMessageResult> {
    return this.send(sessionId, { ...payload, to }, userId);
  }
}

export const messageService = new MessageService();

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface SendMessagePayload {
  to: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contact' | 'reaction';

  // text
  text?: string;

  // media (image/video/audio/document/sticker)
  url?: string;
  base64?: string;
  mimetype?: string;
  caption?: string;
  filename?: string;

  // video specific
  gif?: boolean;

  // audio specific
  ptt?: boolean; // voice note

  // location
  latitude?: number;
  longitude?: number;
  location_name?: string;
  location_address?: string;

  // contact
  contact_name?: string;
  contact_phone?: string;

  // reaction
  reaction_emoji?: string;
  reaction_message_id?: string;
  reaction_from_me?: boolean;
}

export interface SendMessageResult {
  message_id: string | null;
  to: string;
  type: string;
  status: 'sent' | 'failed';
  timestamp: string;
}