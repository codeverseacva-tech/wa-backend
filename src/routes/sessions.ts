import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { apiKeyMiddleware } from '@/middleware/apiKey';
import { validate } from '@/middleware/validate';
import { sessionService } from '@/services/session.service';
import { redis } from '@/lib/redis';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const router = Router();

// Combined auth guard — accepts either a JWT Bearer token or an API key
const anyAuth = [apiKeyMiddleware, authMiddleware];

const sessionSchema = z.object({
  body: z.object({
    name: z.string(),
  })
});

/**
 * POST /v1/sessions
 * Create a new WhatsApp session and start Baileys socket.
 */
router.post('/', ...anyAuth, validate(sessionSchema), async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const apiKeyId = req.user?.apiKeyId;
    const { sessionId } = await sessionService.createSession(userId, apiKeyId);

    res.status(201).json({
      success: true,
      data: {
        session_id: sessionId,
        status: 'pending',
        created_at: new Date().toISOString(),
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/sessions
 * List all sessions for the authenticated user, with optional pagination.
 * Query params: limit (default 50), offset (default 0)
 */
router.get('/', ...anyAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const sessions = await sessionService.listSessions(userId, { limit, offset });
    res.json({ success: true, data: sessions });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/sessions/:id/status
 * Lightweight status poll — returns the DB status and live socket state.
 * Useful for polling without opening an SSE stream.
 */
router.get('/:id/status', ...anyAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const session = await sessionService.getSession(req.params.id, userId);
    res.json({
      success: true,
      data: {
        session_id: session.session_id,
        status: session.status,
        isOnline: session.isOnline,
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/sessions/:id/qr
 * SSE stream — subscribes to Redis pub/sub for real Baileys QR and status events.
 * EventSource cannot send custom headers, so JWT is passed as ?token= query param.
 */
router.get('/:id/qr', async (req, res) => {
  const token = req.query.token as string;
  if (!token) {
    res.status(401).json({ success: false, error: 'Missing token' });
    return;
  }

  const sessionId = req.params.id;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Critical for Caddy not to buffer
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // 1. Send the latest QR immediately if already in Redis (handles page refresh)
  try {
    const existingQr = await redis.get(`session:${sessionId}:qr`);
    if (existingQr) {
      send({ status: 'qr', qr_code: existingQr });
    }
  } catch (err) {
    logger.warn({ err, sessionId }, 'Could not fetch existing QR from Redis');
  }

  // 2. Subscribe to Redis pub/sub for live Baileys events
  // Must use a separate Redis connection for subscribe mode
  const subscriber = redis.duplicate();

  try {
    await subscriber.subscribe(`session:${sessionId}:events`);
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to subscribe to session events');
    res.end();
    return;
  }

  subscriber.on('message', (_channel: string, message: string) => {
    try {
      const event = JSON.parse(message);

      if (event.type === 'qr') {
        send({ status: 'qr', qr_code: event.data });
      } else if (event.type === 'connected') {
        send({ status: 'authenticated' });
        cleanup();
      } else if (event.type === 'disconnected') {
        send({ status: 'failed', error: 'Session disconnected' });
        cleanup();
      }
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to parse session event from Redis');
    }
  });

  // 3. Keepalive ping every 20s to prevent connection timeout
  const keepalive = setInterval(() => {
    res.write(': ping\n\n');
  }, 20000);

  // 4. Cleanup helper
  const cleanup = () => {
    clearInterval(keepalive);
    subscriber.unsubscribe().catch(() => { });
    subscriber.quit().catch(() => { });
    res.end();
  };

  // 5. Clean up when client disconnects
  req.on('close', cleanup);
});

/**
 * GET /v1/sessions/:id
 * Retrieve a single session by its session_id, scoped to the authenticated user.
 */
router.get('/:id', ...anyAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const session = await sessionService.getSession(req.params.id, userId);
    res.json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/sessions/:id/pairing-code
 * Request a WhatsApp pairing code for phone number linking.
 */
router.post('/:id/pairing-code', ...anyAuth, async (req, res, next) => {
  try {
    const { phone_number } = req.body;
    if (!phone_number) {
      throw new AppError('VALIDATION_ERROR', 400, 'phone_number is required');
    }
    const result = await sessionService.getPairingCode(req.params.id, phone_number);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /v1/sessions/:id
 * Terminate and delete a session.
 */
router.delete('/:id', ...anyAuth, async (req, res, next) => {
  try {
    await sessionService.deleteSession(req.params.id);
    res.json({ success: true, data: null });
  } catch (err) {
    next(err);
  }
});

export default router;