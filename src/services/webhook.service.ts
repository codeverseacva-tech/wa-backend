import { WebhooksRepository, Webhook } from '@/repositories/webhooks.repository';
import { webhookDispatchQueue } from '@/lib/queues';
import { redis } from '@/lib/redis';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

const webhooksRepo = new WebhooksRepository();

/**
 * Service to handle multi-tenant webhook fan-outs.
 * Enqueues delivery tasks to BullMQ for background processing.
 * Extended to support Partner-Tier sub-user routing.
 */
export class WebhookService {
  /**
   * Identifies if a session belongs to a sub-user and routes accordingly.
   * This is the entry point from the Baileys session manager.
   */
  public async dispatchContextualEvent(eventType: string, payload: any, sessionId: string, userId: string): Promise<void> {
    try {
      // Step 1: Hot-path lookup in Redis for sub-user metadata
      const metaStr = await redis.get(`session:${sessionId}:meta`);
      if (metaStr) {
        const meta = JSON.parse(metaStr);
        if (meta.sub_user_id) {
          return this.dispatchSubUserEvent(eventType, payload, meta.sub_user_id, meta.partner_id);
        }
      }

      // Step 2: Fallback to standard user fan-out
      return this.dispatchEvent(eventType, payload, userId);
    } catch (err: any) {
      logger.error({ err: err.message, sessionId, eventType }, 'Contextual webhook dispatch failed');
    }
  }

  /**
   * Dispatches an event to the partner backend for a specific sub-user.
   */
  public async dispatchSubUserEvent(eventType: string, payload: any, subUserId: string, partnerId: string): Promise<void> {
    try {
      // 1. Resolve routing info via cache (5-min TTL) to avoid DB pressure
      const cacheKey = `cache:routing:sub_user:${subUserId}`;
      let routingData = await redis.get(cacheKey);

      if (!routingData) {
        const { data, error } = await supabase
          .from('partner_sub_users')
          .select(`
            id,
            external_user_id,
            webhook_secret,
            webhook_url_suffix,
            partners!partner_id (base_webhook_url)
          `)
          .eq('id', subUserId)
          .single();

        if (error || !data) {
          logger.warn({ subUserId }, 'Routing data for sub-user not found, dropping event');
          return;
        }

        routingData = JSON.stringify({
          baseUrl: (data.partners as any).base_webhook_url,
          suffix: data.webhook_url_suffix,
          secret: data.webhook_secret,
          externalId: data.external_user_id
        });
        await redis.set(cacheKey, routingData, 'EX', 300);
      }

      const { baseUrl, suffix, secret, externalId } = JSON.parse(routingData);
      const url = `${baseUrl.replace(/\/$/, '')}/${suffix}`;

      // 2. Dispatch to BullMQ for resilient delivery
      await webhookDispatchQueue.add('webhook-dispatch', {
        dbSubUserId: subUserId,
        url,
        secret,
        eventType,
        payload,
        userId: partnerId,
        subUserId: externalId, // Pass the external ID for headers
        partnerId: partnerId,
      });

      logger.debug({ subUserId, url, eventType }, '🎯 Partner sub-user webhook enqueued');
    } catch (err: any) {
      logger.error({ err: err.message, subUserId, eventType }, 'Sub-user webhook dispatch failed');
    }
  }

  /**
   * Dispatches an event to all active webhooks for a specific user (Standard Fan-out).
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

  /**
   * Dispatches an event to a single specific webhook, bypassing fan-out.
   */
  public async dispatchToWebhook(webhook: Webhook, eventType: string, payload: any): Promise<void> {
    try {
      await webhookDispatchQueue.add('webhook-dispatch', {
        webhookId: webhook.id,
        url: webhook.url,
        secret: webhook.secret,
        eventType,
        payload,
        userId: webhook.user_id,
      });

      logger.info({ webhookId: webhook.id, url: webhook.url, eventType }, '🎯 Single webhook dispatch enqueued');
    } catch (err: any) {
      logger.error({ err: err.message, webhookId: webhook.id, eventType }, 'Single webhook dispatch failed to enqueue');
    }
  }
}

export const webhookService = new WebhookService();
