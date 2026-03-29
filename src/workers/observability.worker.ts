import { Worker, Job } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { slack } from '@/lib/slack';
import { observabilityQueue } from '@/lib/queues';

/**
 * Periodically calculates error rates and checks system health.
 * Triggers Slack alerts if thresholds are exceeded.
 */
export const observabilityWorker = new Worker(
  'observability-check',
  async (job: Job) => {
    logger.debug('📡 Running observability health check...');

    // 1. Calculate API Error Rate (5-min window)
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / 300); // current 5-min bucket
    const prevWindow = window - 1; // last 5-min bucket

    const [total, errors] = await Promise.all([
      redis.get(`monitoring:requests:total:${prevWindow}`),
      redis.get(`monitoring:requests:error:${prevWindow}`),
    ]);

    const totalCount = parseInt(total || '0');
    const errorCount = parseInt(errors || '0');

    if (totalCount >= 50) { // Significant volume threshold
      const errorRate = (errorCount / totalCount) * 100;
      if (errorRate > 10) {
        await slack.sendAlert(
          'critical',
          'High API Error Rate',
          `API error rate is ${errorRate.toFixed(2)}% over the last 5 minutes.`,
          { totalRequests: totalCount, errorRequests: errorCount }
        );
      }
    }

    // 2. Schedule next check in 5 minutes
    await observabilityQueue.add('check-health', {}, { delay: 300000 });
  },
  { connection: redis }
);

// Start the initial check if not already running
observabilityQueue.add('check-health', {}, { jobId: 'singleton-health-check' });
