import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { z } from 'zod';

const router = Router();

const sessionSchema = z.object({
  body: z.object({
    name: z.string(),
  })
});

/**
 * POST /v1/sessions
 * Create a new WhatsApp session.
 */
router.post('/', authMiddleware, validate(sessionSchema), async (req, res, next) => {
  try {
    // In local dev, just return success
    res.status(201).json({
      id: 'session-1234',
      status: 'disconnected',
      qr: 'data:image/png;base64,...',
      created_at: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/sessions
 * List active sessions.
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    res.json({ sessions: [] });
  } catch (err) {
    next(err);
  }
});

export default router;
