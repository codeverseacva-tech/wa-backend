import { Worker, Job } from 'bullmq';
import { redis } from '@/lib/redis';
import { WebhookDispatchJob } from '@/lib/queues';
import { WebhookLogsRepository } from '@/repositories/webhook_logs.repository';
import { logger } from '@/lib/logger';
import { createHmac } from 'crypto';
import axios from 'axios';
import { supabase } from '@/lib/supabase';
import { slack } from '@/lib/slack';

const logsRepo = new WebhookLogsRepository();

/**
 * Worker for resilient webhook delivery.
 * Signs payloads with HMAC-SHA256 and handles retries with exponential backoff.
 */
export const webhookWorker = new Worker<WebhookDispatchJob>(
  'webhook-dispatch',
  async (job: Job<WebhookDispatchJob>) => {
    const { webhookId, url, secret, eventType, payload, subUserId, dbSubUserId, partnerId } = job.data;

    // 1. Digital Signature: HMAC-SHA256
    const signature = createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    const headers: any = {
      'Content-Type': 'application/json',
      'X-Zaplink-Signature': signature,
      'X-Zaplink-Event': eventType,
      // Internal headers for easier debugging
      'X-WA-Signature': signature, 
      'X-WA-Event': eventType,
    };

    if (subUserId) headers['X-Zaplink-Sub-User-Id'] = subUserId;
    if (partnerId) headers['X-Zaplink-Partner-Id'] = partnerId;

    try {
      // 2. HTTP POST dispatch
      const response = await axios.post(url, payload, {
        headers,
        timeout: 10000,
      });

      // 3. Reset Circuit Breaker for sub-user on success
      if (subUserId) {
        await redis.del(`webhook:fail_count:${subUserId}`);
      }

      // 4. Persist success log
      await logsRepo.create({
        webhook_id: webhookId,
        sub_user_id: dbSubUserId,
        event_type: eventType,
        payload,
        response_status: response.status,
        response_body: JSON.stringify(response.data).substring(0, 1000),
      });

      logger.info({ webhookId, url, status: response.status }, '✅ Webhook delivery successful');
    } catch (err: any) {
      const status = err.response?.status || 500;
      const respBody = err.response?.data ? JSON.stringify(err.response.data).substring(0, 500) : err.message;

      // 5. Circuit Breaker Logic for Partners
      if (subUserId) {
        const failCount = await redis.incr(`webhook:fail_count:${subUserId}`);
        await redis.expire(`webhook:fail_count:${subUserId}`, 86400); // 24h window

        if (failCount === 3) {
          await slack.sendAlert(
            'warning',
            'Partner Webhook Failing',
            `Delivery for sub-user ${subUserId} has failed 3 consecutive times. (User is NOT suspended).`,
            { url, lastError: err.message }
          );
        }
      }

      await logsRepo.create({
        webhook_id: webhookId,
        sub_user_id: dbSubUserId,
        event_type: eventType,
        payload,
        response_status: status,
        response_body: respBody,
      });

      logger.warn({ webhookId, url, status, attempt: job.attemptsMade + 1 }, '⚠️ Webhook delivery attempt failed');
      throw err;
    }
  },
  { 
    connection: redis,
    concurrency: 20, // Support high throughput for mass fan-outs
  }
);


/**
 * Critical failure hook for permanent delivery drops
 */
webhookWorker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= (job.opts?.attempts || 5)) {
    const { webhookId, url } = job.data;
    logger.error({ webhookId, url, err: err.message }, '🚨 Webhook delivery DEAD after maximum retries');

    await slack.sendJobFailureAlert('webhook-dispatch', job.id || 'unknown', err.message);
    
    // Integration for external critical alerts (e.g., Slack)
    logger.warn(`[ALERT SENT] Webhook ${webhookId} at ${url} is dead. Permanent failure: ${err.message}`);
  }
});

webhookWorker.on('error', (err) => {
  logger.error({ err }, 'Webhook worker connection/redis error');
});
