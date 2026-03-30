import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { APIKeysRepository } from '@/repositories/api_keys.repository';

const router = Router();
const repo = new APIKeysRepository();

const apiKeySchema = z.object({
  body: z.object({
    key_name: z.string().min(1),
    ip_whitelist: z.array(z.string()).optional(),
    permissions: z.array(z.string()).optional(),
    expires_at: z.string().datetime({ message: 'expires_at must be a valid ISO 8601 datetime' }).optional(),
  })
});

/**
 * POST /v1/api-keys
 * Create a new API key.
 */
router.post('/', authMiddleware, validate(apiKeySchema), async (req, res, next) => {
  try {
    const { key_name, ip_whitelist, permissions, expires_at } = req.body;
    const userId = req.user!.id;

    // Standard high-entropy API key format: zap_8chars.secretPart
    const prefixString = `zap_${randomBytes(4).toString('hex')}`;
    const secretPart = randomBytes(24).toString('base64url');
    const fullApiKey = `${prefixString}.${secretPart}`;

    const hash = createHash('sha256').update(secretPart).digest('hex');
    const id = uuidv4();

    const createdKey = await repo.create({
      id,
      user_id: userId,
      key_name,
      key_hash: hash,
      key_prefix: prefixString,
      rate_limit: 1000,
      ip_whitelist: ip_whitelist || [],
      permissions: permissions || ['*'],
      expires_at: expires_at || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      data: {
        ...createdKey,
        apiKey: fullApiKey, // Only return the raw key once upon creation
        key_raw: fullApiKey,
        key_prefix: prefixString,
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/api-keys
 * List active API keys — returns user-specific keys.
 * Supports ?limit and ?offset for pagination.
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const keys = await repo.listByUser(userId, { limit, offset });

    res.json({
      success: true,
      data: keys
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /v1/api-keys/:id
 * Delete an API key for the current user.
 */
router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    await repo.delete(id, userId);

    res.json({
      success: true,
      message: 'API key deleted'
    });
  } catch (err) {
    next(err);
  }
});

export default router;