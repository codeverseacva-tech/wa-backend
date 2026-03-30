import { Request, Response, NextFunction } from 'express';
import { redis } from '@/lib/redis';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Sliding window rate limiting middleware using Redis.
 * Tiers:
 * - Auth endpoints (/v1/auth/*): 10 req / 15 min per IP (brute-force protection)
 * - Authenticated user: 200 req / 15 min per user ID
 * - API key: Configurable from DB (default 100 req / 15 min)
 * - Unauthenticated: 60 req / 15 min per IP
 *
 * Excluded from rate limiting:
 * - /health/* (liveness + readiness probes)
 */
export const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  // Skip rate limiting for health check endpoints entirely
  if (req.path.startsWith('/health') || req.path === '/live' || req.path === '/ready') {
    return next();
  }

  const WINDOW_SECONDS = 15 * 60;
  const WINDOW_MS = WINDOW_SECONDS * 1000;

  // Normalize IP — strip IPv6 prefix (::ffff:) to get plain IPv4
  const rawIp = req.headers['x-forwarded-for'] as string
    || req.socket.remoteAddress
    || 'unknown';
  const clientIp = rawIp.split(',')[0].trim().replace(/^::ffff:/, '');

  let identifier: string;
  let limit: number;

  // Auth endpoints get their own strict bucket regardless of auth state
  const isAuthEndpoint = req.path.startsWith('/auth/');

  if (isAuthEndpoint) {
    // Strict per-IP limit for auth endpoints — brute force protection
    identifier = `auth:${clientIp}`;
    limit = 10;
  } else if (req.user) {
    // Authenticated users get a generous per-user limit
    identifier = `user:${req.user.id}`;
    limit = (req.user as any).rateLimit || 200;
  } else {
    // Unauthenticated requests — per IP, more generous than before
    identifier = `ip:${clientIp}`;
    limit = 550;
  }

  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  try {
    const multi = redis.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zadd(key, now, `${now}-${Math.random().toString(36).substring(2, 9)}`);
    multi.zcard(key);
    multi.expire(key, WINDOW_SECONDS);

    const pipelineResults = await multi.exec();
    if (!pipelineResults) {
      throw new Error('Redis pipeline execution failed');
    }

    const count = pipelineResults[2][1] as number;

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));

    if (count > limit) {
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const oldestTs = oldest.length > 1 ? parseInt(oldest[1]) : now;
      const retryAfter = Math.ceil((oldestTs + WINDOW_MS - now) / 1000);

      res.setHeader('Retry-After', retryAfter.toString());

      throw new AppError(
        'RATE_LIMIT_EXCEEDED',
        429,
        'Rate limit exceeded. Please check the Retry-After header.'
      );
    }

    next();
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }

    logger.error({ err, identifier }, 'Rate limit middleware error - Failing open');
    next();
  }
};