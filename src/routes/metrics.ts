import { Router } from 'express';
import { register } from '@/lib/metrics';
import { config } from '@/config';
import { logger } from '@/lib/logger';

const router = Router();

/**
 * Metrics Authorization Middleware
 * Only allows requests with the correct secret header as requested.
 */
const metricsAuth = (req: any, res: any, next: any) => {
  const secret = req.headers['x-metrics-secret'];
  if (config.metrics.secret && secret !== config.metrics.secret) {
     logger.warn('🚫 Unauthorized metrics access attempt');
     return res.status(403).json({ error: 'Access denied. Valid metrics secret required.' });
  }
  next();
};

/**
 * GET /metrics: Exports Prometheus metrics.
 */
router.get('/', metricsAuth, async (_req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err: any) {
    logger.error({ err: err.message }, '❌ Metrics export failed');
    res.status(500).send(err.message);
  }
});

export default router;
