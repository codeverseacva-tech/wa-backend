import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const apiKeySchema = z.object({
  body: z.object({
    key_name: z.string().min(1),
    ip_whitelist: z.array(z.string()).optional(),
    permissions: z.array(z.string()).optional(),
  })
});

/**
 * POST /v1/api-keys
 * Create a new API key.
 */
router.post('/', authMiddleware, validate(apiKeySchema), async (req, res, next) => {
  try {
    const { key_name } = req.body;
    const id = uuidv4();
    const keyRaw = `zap_${uuidv4().replace(/-/g, '')}`;

    // Return the raw key once only
    res.status(201).json({
      id,
      key_name,
      key_raw: keyRaw,
      key_prefix: keyRaw.substring(0, 8),
      created_at: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/api-keys
 * List active keys. (Without raw key)
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    res.json({
      keys: [
        {
          id: 'existing-key-id',
          key_name: 'Production Key',
          key_prefix: 'zap_abc123',
          created_at: new Date().toISOString()
        }
      ]
    });
  } catch (err) {
    next(err);
  }
});

export default router;
