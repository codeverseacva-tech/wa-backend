import { Router } from 'express';
import { supabase } from '@/lib/supabase';
import { redis } from '@/lib/redis';
import { sessionManager } from '@/lib/baileys/sessionManager';
import { logger } from '@/lib/logger';

const router = Router();

/**
 * Liveness check: verifies process is running.
 * Used by Docker/K8s to determine if the container needs a restart.
 */
router.get('/live', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Readiness check: verifies all external dependencies are available.
 * Checks Supabase, Redis, and WhatsApp session manager state.
 */
router.get('/ready', async (_req, res) => {
  const checks: Record<string, any> = {
    supabase: false,
    redis: false,
    whatsapp: false,
  };

  try {
    // 1. Supabase check
    const { error: sbError } = await supabase.from('profiles').select('id').limit(1);
    checks.supabase = !sbError;

    // 2. Redis check
    const redisStatus = await redis.ping();
    checks.redis = redisStatus === 'PONG';

    // 3. WhatsApp Session check (Baileys Socket Count)
    const socketCount = sessionManager.getActiveSessionsCount();
    checks.whatsapp = {
      socketCount,
      status: 'ok',
    };

    const isReady = checks.supabase && checks.redis;

    if (isReady) {
      return res.status(200).json({ status: 'ok', checks });
    }

    logger.warn({ checks }, '⚠️ Readiness check failed');
    return res.status(503).json({ status: 'degraded', checks });
  } catch (err: any) {
    logger.error({ err: err.message }, '❌ Readiness check error');
    return res.status(503).json({
      status: 'error',
      message: err.message,
      checks,
    });
  }
});

export default router;
