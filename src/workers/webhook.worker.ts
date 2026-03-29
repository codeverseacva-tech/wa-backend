import { Worker, Job } from 'bullmq';
import { redis } from '@/lib/redis';
import { WebhookDispatchJob } from '@/lib/queues';
import { WebhookLogsRepository } from '@/repositories/webhook_logs.repository';
import { logger } from '@/lib/logger';
import { createHmac } from 'crypto';
import axios from 'axios';

const logsRepo = new WebhookLogsRepository();

/**
 * Worker for resilient webhook delivery.
 * Signs payloads with HMAC-SHA256 and handles retries with exponential backoff.
 */
export const webhookWorker = new Worker<WebhookDispatchJob>(
  'webhook-dispatch',
  async (job: Job<WebhookDispatchJob>) => {
    const { webhookId, url, secret, eventType, payload } = job.data;

    // 1. Digital Signature: HMAC-SHA256 to ensure payload integrity at recipient
    const signature = createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    try {
      // 2. HTTP POST dispatch
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-WA-Signature': signature,
          'X-WA-Event': eventType,
        },
        timeout: 10000, // 10s wait time for subscriber response
      });

      // 3. Persist success log for auditing
      await logsRepo.create({
        webhook_id: webhookId,
        event_type: eventType,
        payload,
        response_status: response.status,
        response_body: JSON.stringify(response.data).substring(0, 1000), // Safety truncation
      });

      logger.info({ webhookId, url, status: response.status }, '✅ Webhook delivery successful');
    } catch (err: any) {
      const status = err.response?.status || 500;
      const respBody = err.response?.data ? JSON.stringify(err.response.data).substring(0, 500) : err.message;

      // Persist failure logs to help users debug their endpoints
      await logsRepo.create({
        webhook_id: webhookId,
        event_type: eventType,
        payload,
        response_status: status,
        response_body: respBody,
      });

      logger.warn({ webhookId, url, status, attempt: job.attemptsMade + 1 }, '⚠️ Webhook delivery attempt failed');
      
      // Trigger BullMQ exponential backoff retry mechanism
      throw err;
    }
  },
  { 
    connection: redis,
    concurrency: 20, // Support high throughput for mass fan-outs
  }
);

import { slack } from '@/lib/slack';

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
