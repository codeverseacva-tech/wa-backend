import { Queue, QueueOptions } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { redis } from './redis';

/**
 * BullMQ Job Interfaces
 */

export interface BaseJob {
  traceId?: string;
}

export interface BulkCampaignJob extends BaseJob {
  campaignId: string;
  userId: string;
  sessionId: string;
  recipients: string[];
  messageTemplate: any;
  settings: {
    delay_between_messages: number;
  };
}

export interface ScheduledMessageJob extends BaseJob {
  scheduledId: string;
  userId: string;
  sessionId: string;
  to: string;
  payload: any;
  scheduledAt: string;
}

export interface WebhookDispatchJob extends BaseJob {
  webhookId?: string;
  url: string;
  secret: string;
  eventType: string;
  payload: any;
  userId: string;
  subUserId?: string; // For Partner Sub-users
  dbSubUserId?: string; // Internal database UUID
  partnerId?: string; // For Partner Tier identification
}

/**
 * Shared Queue Configuration
 */

const defaultQueueOptions: QueueOptions = {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 30000, // 30s base backoff
    },
  },
};

export const bulkCampaignQueue = new Queue<BulkCampaignJob>('bulk-campaigns', defaultQueueOptions);
export const scheduledMessageQueue = new Queue<ScheduledMessageJob>('scheduled-messages', defaultQueueOptions);
export const webhookDispatchQueue = new Queue<WebhookDispatchJob>('webhook-dispatch', {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    attempts: 5, // Higher attempt count for webhooks
  }
});
export const quotaSyncQueue = new Queue<{ userId: string; month: string }>('quota-sync', {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    attempts: 3,
  }
});
export const observabilityQueue = new Queue('observability-check', {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    attempts: 1, // Single attempt for monitoring tasks
  }
});

/**
 * BullBoard Dashboard
 */

export const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(bulkCampaignQueue) as any,
    new BullMQAdapter(scheduledMessageQueue) as any,
    new BullMQAdapter(webhookDispatchQueue) as any,
  ],
  serverAdapter,
});
