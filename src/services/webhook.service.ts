import { WebhooksRepository } from '@/repositories/webhooks.repository';
import { webhookDispatchQueue } from '@/lib/queues';
import { logger } from '@/lib/logger';

const webhooksRepo = new WebhooksRepository();

/**
 * Service to handle multi-tenant webhook fan-outs.
 * Enqueues delivery tasks to BullMQ for background processing.
 */
export class WebhookService {
  /**
   * Dispatches an event to all active webhooks for a specific user.
   */
  public async dispatchEvent(eventType: string, payload: any, userId: string): Promise<void> {
    try {
      // 1. Fetch available webhooks for the user
      const webhooks = await webhooksRepo.listByUser(userId);
      
      // 2. Filter active webhooks subscribed to this eventType
      const activeHooks = webhooks.filter(w => w.is_active && w.events.includes(eventType));

      if (activeHooks.length === 0) {
        return;
      }

      // 3. Batch enqueue dispatch jobs for fan-out
      const jobs = activeHooks.map(w => ({
        name: 'webhook-dispatch',
        data: {
          webhookId: w.id,
          url: w.url,
          secret: w.secret,
          eventType,
          payload,
          userId
        }
      }));

      await webhookDispatchQueue.addBulk(jobs);
      
      logger.info({ userId, eventType, fanOutCount: activeHooks.length }, '🚀 Webhook fan-out enqueued');
    } catch (err: any) {
      logger.error({ err: err.message, userId, eventType }, 'Webhook dispatch failed to enqueue');
    }
  }
}

export const webhookService = new WebhookService();
