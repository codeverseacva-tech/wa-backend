import { Worker, Job } from 'bullmq';
import { redis } from '@/lib/redis';
import { ScheduledMessageJob } from '@/lib/queues';
import { messageService } from '@/services/message.service';
import { ScheduledMessagesRepository } from '@/repositories/scheduled_messages.repository';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const scheduledRepo = new ScheduledMessagesRepository();

/**
 * Worker to process scheduled WhatsApp messages.
 * Enforces staleness checks and handles exponential backoff retries.
 */
export const schedulerWorker = new Worker<ScheduledMessageJob>(
  'scheduled-messages',
  async (job: Job<ScheduledMessageJob>) => {
    const { scheduledId, sessionId, to, payload, scheduledAt } = job.data;

    // Staleness Policy: If execution is > 24h after scheduled time, expire it
    const scheduledTime = new Date(scheduledAt).getTime();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours

    if (Date.now() - scheduledTime > staleThreshold) {
      logger.warn({ scheduledId, scheduledAt }, '⏰ Scheduled message task stale - expiring job');
      await scheduledRepo.updateStatus(scheduledId, 'failed');
      throw new AppError('SCHEDULED_MESSAGE_EXPIRED', 410, 'Task delivery window (24h) exceeded.');
    }

    try {
      // Direct delivery through our core messaging service
      await messageService.sendMessage(sessionId, to, payload);
      
      // Update persistent DB status
      await scheduledRepo.updateStatus(scheduledId, 'sent');
      logger.info({ scheduledId }, '✅ Scheduled message successfully processed');
    } catch (err: any) {
      logger.error({ err: err.message, scheduledId, attempts: job.attemptsMade }, 'Scheduler worker attempt failed');
      
      // If final attempt has been made, mark as failed in Postgres
      if (job.attemptsMade >= (job.opts?.attempts || 1) - 1) {
         await scheduledRepo.updateStatus(scheduledId, 'failed');
      }
      
      // Throw error to trigger BullMQ retry backoff
      throw err;
    }
  },
  {
    connection: redis,
    concurrency: 10,
  }
);

schedulerWorker.on('error', (err) => {
  logger.error({ err }, 'Scheduler worker connection error');
});
