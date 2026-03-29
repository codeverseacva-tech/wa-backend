import { Request, Response, NextFunction } from 'express';
import { redis } from '@/lib/redis';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Sliding window rate limiting middleware using Redis.
 * Tiers:
 * - Authenticated user: 200 req / 15 min
 * - API key: Configurable (defaults to 100 if missing from DB)
 * - Unauthenticated: 30 req / 15 min
 */
export const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const WINDOW_SECONDS = 15 * 60;
  const WINDOW_MS = WINDOW_SECONDS * 1000;
  
  let identifier: string = req.ip || 'unknown';
  let limit: number = 30;

  // Determine the rate limit tier based on the authenticated context
  if (req.user) {
    identifier = req.user.id;
    // req.user.rateLimit is attached by apiKeyMiddleware
    limit = (req.user as any).rateLimit || 200;
  }

  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  try {
    // Sliding window implementation using Redis Sorted Sets
    const multi = redis.multi();
    
    // Remove old requests outside the 15-minute window
    multi.zremrangebyscore(key, 0, windowStart);
    // Add unique entry for the current request
    multi.zadd(key, now, `${now}-${Math.random().toString(36).substring(2, 9)}`);
    // Count total requests in the window
    multi.zcard(key);
    // Set expiry to clean up inactive sets
    multi.expire(key, WINDOW_SECONDS);

    const pipelineResults = await multi.exec();
    if (!pipelineResults) {
      throw new Error('Redis pipeline execution failed');
    }

    // Pipeline index 2 corresponds to zcard result
    const count = pipelineResults[2][1] as number;

    // Expose rate limit status in headers
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));

    if (count > limit) {
      // Calculate Retry-After based on the oldest request in the window
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const oldestTs = oldest.length > 1 ? parseInt(oldest[1]) : now;
      const retryAfter = Math.ceil((oldestTs + WINDOW_MS - now) / 1000);

      res.setHeader('Retry-After', retryAfter.toString());
      
      throw new AppError('RATE_LIMIT_EXCEEDED', 429, 'Rate limit exceeded. Please check the Retry-After header.');
    }

    next();
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }
    
    logger.error({ err, identifier }, 'Rate limit middleware error - Failing open');
    // Fail-open: prevent blocking users due to Redis infrastructure issues
    next();
  }
};
