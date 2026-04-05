import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { redis } from '@/lib/redis';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Idempotency middleware for POST and PATCH requests.
 * Ensures that duplicate requests within 24h return the same response.
 * Uses SHA-256 for integrity checks on the request payload.
 */
export const idempotencyMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  // Only apply to state-changing operations
  if (!['POST', 'PATCH'].includes(req.method)) {
    return next();
  }

  const key = req.headers['idempotency-key'] as string;
  if (!key) {
    return next();
  }

  // Enforce UUID v4 as specified
  if (!UUID_V4_REGEX.test(key)) {
    return next(new AppError('VALIDATION_ERROR', 400, 'Idempotency-Key header must be a valid UUID v4'));
  }

  // Create hash of body to detect duplicate keys with different payloads
  const payloadStr = JSON.stringify({ body: req.body, params: req.params, query: req.query });
  const hash = createHash('sha256').update(payloadStr).digest('hex');

  const redisKey = `idempotency:${key}`;

  try {
    const cached = await redis.get(redisKey);
    if (cached) {
      const { hash: cachedHash, response } = JSON.parse(cached);

      // On duplicate key + different hash: return 422 IDEMPOTENCY_KEY_MISMATCH
      if (hash !== cachedHash) {
        throw new AppError('IDEMPOTENCY_KEY_MISMATCH', 422, 'Duplicate Idempotency-Key used with different payload content.');
      }

      logger.info({ key, method: req.method, path: req.path }, 'Idempotency hit - returning cached response');
      return res.status(response.status).json(response.body);
    }

    // Wrap res.send to intercept and store the response
    const originalSend = res.send;
    
    res.send = function(body: any) {
      try {
        // Re-attach original send to avoid recursion
        res.send = originalSend;

        // Only cache non-5xx responses typically
        if (res.statusCode < 500) {
          try {
            // If it's already a string, it's likely already JSON. 
            // If it's an object, we use it directly.
            const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
            const cacheData = JSON.stringify({
              hash,
              response: {
                status: res.statusCode,
                body: parsedBody
              }
            });

            redis.set(redisKey, cacheData, 'EX', EXPIRY_SECONDS)
              .catch(err => logger.error({ err, key }, 'Redis idempotency cache write failed'));
          } catch (e: any) {
               // Silently fail cache if parsing failed, but log why
               logger.debug({ err: e.message, key }, 'Skipping idempotency cache due to response format');
          }
        }

        return originalSend.apply(res, arguments as any);
      } catch (err) {
        logger.error({ err, key }, 'Error in idempotency middleware send interceptor');
        return originalSend.apply(res, arguments as any);
      }
    };

    next();
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }
    logger.error({ err, key }, 'Idempotency middleware error');
    next();
  }
};
