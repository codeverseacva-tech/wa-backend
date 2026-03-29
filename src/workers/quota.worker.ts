import { Worker, Job } from 'bullmq';
import { redis } from '@/lib/redis';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

/**
 * Worker to sync Redis quota usage to Supabase DB.
 * Runs asynchronously to prevent blocking real-time message flows.
 */
export const quotaWorker = new Worker(
  'quota-sync',
  async (job: Job<{ userId: string; month: string }>) => {
    const { userId, month } = job.data;
    const redisKey = `quota:${userId}:messages:${month}`;

    // 1. Get current count from Redis
    const count = await redis.get(redisKey);
    if (count === null) return;

    const messageCount = parseInt(count);

    // 2. Sync to DB using upsert on (user_id, month_year)
    const { error } = await supabase
      .from('usage_stats')
      .upsert({
        user_id: userId,
        month_year: month,
        message_count: messageCount,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,month_year'
      });

    if (error) {
      logger.error({ userId, month, error: error.message }, '❌ Failed to sync quota to DB');
      throw new Error(error.message);
    }

    logger.info({ userId, month, messageCount }, '✅ Quota usage synced to DB');
  },
  { 
    connection: redis,
    concurrency: 5,
  }
);

quotaWorker.on('error', (err) => {
  logger.error({ err }, 'Quota worker connection error');
});
