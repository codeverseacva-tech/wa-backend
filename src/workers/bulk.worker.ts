import { Worker, Job } from 'bullmq';
import { redis } from '@/lib/redis';
import { BulkCampaignJob } from '@/lib/queues';
import { messageService } from '@/services/message.service';
import { BulkCampaignsRepository } from '@/repositories/bulk_campaigns.repository';
import { logger } from '@/lib/logger';

const bulkCampaignsRepository = new BulkCampaignsRepository();

/**
 * Worker to process bulk WhatsApp campaigns.
 * Iterates through recipients with configurable delays to maintain delivery reputation.
 */
export const bulkWorker = new Worker<BulkCampaignJob>(
  'bulk-campaigns',
  async (job: Job<BulkCampaignJob>) => {
    const { campaignId, sessionId, recipients, messageTemplate, settings } = job.data;
    const delayMillis = settings.delay_between_messages || 5000;

    logger.info({ campaignId, recipientCount: recipients.length }, '🚀 Starting bulk campaign processor');

    let processedCount = 0;

    for (const to of recipients) {
      try {
        // Standard delivery through message service (handles idempotency and logging)
        await messageService.sendMessage(sessionId, to, messageTemplate);
        
        processedCount++;
        
        // Update DB progress atomically
        await bulkCampaignsRepository.updateProgress(campaignId, processedCount, 'processing');
        
        // Report progress back to BullBoard/Monitoring
        job.updateProgress((processedCount / recipients.length) * 100);

        // Throttle to avoid WhatsApp anti-spam bans
        if (processedCount < recipients.length) {
          await new Promise(res => setTimeout(res, delayMillis));
        }
      } catch (err: any) {
        logger.error({ err, campaignId, recipient: to }, 'Recipient processing failed - continuing campaign');
        // We don't throw hered because we want to attempt other recipients
      }
    }

    // Final status update
    await bulkCampaignsRepository.updateProgress(campaignId, processedCount, 'completed');
    logger.info({ campaignId }, '✅ Bulk campaign processing finished');
  },
  { 
    connection: redis,
    concurrency: 2, // Control parallel campaign processing
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  }
);

/**
 * Job failure handlers for alerting
 */
bulkWorker.on('failed', async (job, err) => {
  if (job) {
    const { campaignId } = job.data;
    logger.error({ campaignId, err: err.message }, '🚨 Bulk campaign worker CRITICAL failure');

    // Update DB status to paused so users can review
    try {
       await bulkCampaignsRepository.updateProgress(campaignId, 0, 'paused');
    } catch (dbErr) {
       logger.error({ dbErr }, 'Failed to update campaign status after worker crash');
    }

    // Implementation of Slack Alerts would occur here
    logger.warn(`[SLACK ALERT] Campaign ${campaignId} failed and was paused. Reason: ${err.message}`);
  }
});

bulkWorker.on('error', (err) => {
  logger.error({ err }, 'Bulk worker connection/redis error');
});
