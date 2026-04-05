import { Request, Response, NextFunction } from 'express';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';
import { redis } from '@/lib/redis';
import { httpRequestsTotal, httpRequestDurationMs } from '@/lib/metrics';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const start = Date.now();
  
  res.on('finish', async () => {
    const durationMs = Date.now() - start;
    
    // 1. Update Metrics
    httpRequestsTotal.inc({ method: req.method, path: req.path, status_code: res.statusCode });
    httpRequestDurationMs.observe({ method: req.method, path: req.path, status_code: res.statusCode }, durationMs);

    // 2. Monitoring stats for error rate calculation (5min rolling bucket)
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / 300); // 5-minute bucket
    const totalKey = `monitoring:requests:total:${window}`;
    const errorKey = `monitoring:requests:error:${window}`;

    await redis.multi()
      .incr(totalKey)
      .expire(totalKey, 600) // Keep for 10 min
      .exec();

    if (res.statusCode >= 500) {
      await redis.multi()
        .incr(errorKey)
        .expire(errorKey, 600)
        .exec();
    }

    // 3. Compact log
    logger.info(`${req.method} ${req.path} ${res.statusCode} (${durationMs}ms)`);
  });
  
  next();
};
