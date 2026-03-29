import axios from 'axios';
import { config } from '@/config';
import { redis } from './redis';
import { logger } from './logger';

export type AlertLevel = 'critical' | 'warning';

/**
 * Service to send Slack notifications with Block Kit formatting.
 * Implements deduplication to avoid alert fatigue.
 */
class SlackService {
  private readonly webhookUrl = config.slack.webhookUrl;

  /**
   * Sends a structured alert to Slack.
   * Features: deduplication (15m window) and sidebar color coding.
   */
  public async sendAlert(
    level: AlertLevel,
    title: string,
    details: string,
    context: Record<string, any> = {}
  ): Promise<void> {
    if (!this.webhookUrl) {
      logger.debug('⏭️ Slack alert skipped: No webhook URL configured');
      return;
    }

    try {
      const errorCode = context.errorCode || title;
      const dedupeKey = `alert:dedupe:${errorCode}`;

      // 1. Deduplication check: Avoid multiple alerts for same error within 15min
      const isRecent = await redis.get(dedupeKey);
      if (isRecent) {
        logger.trace({ title, errorCode }, '⏭️ Duplicate alert suppressed');
        return;
      }

      // 2. Set dedupe flag in Redis
      await redis.set(dedupeKey, '1', 'EX', 15 * 60);

      // 3. Format payload using Block Kit
      const color = level === 'critical' ? '#E01E5A' : '#ECB22E';
      const payload = {
        attachments: [
          {
            color,
            blocks: [
              {
                type: 'header',
                text: { type: 'plain_text', text: `${level.toUpperCase()}: ${title}` },
              },
              {
                type: 'section',
                text: { type: 'mrkdwn', text: `*Details:* ${details}` },
              },
              {
                type: 'section',
                fields: Object.entries(context).map(([k, v]) => ({
                  type: 'mrkdwn',
                  text: `*${k}:* ${typeof v === 'object' ? JSON.stringify(v) : v}`,
                })),
              },
              {
                type: 'context',
                elements: [{ type: 'mrkdwn', text: `<!date^${Math.floor(Date.now() / 1000)}^{date_num} {time_secs}|${new Date().toISOString()}>` }],
              },
            ],
          },
        ],
      };

      // 4. Send to Slack (Never throw — handled internally)
      await axios.post(this.webhookUrl, payload, { timeout: 5000 });
      logger.info({ title, level }, '🔔 Slack alert sent');
    } catch (err: any) {
      // Per requirements: sendAlert must NEVER throw, log to stderr only.
      process.stderr.write(`❌ Slack Alert Failed: ${err.message}\n`);
    }
  }

  /**
   * Specifically for permanent BullMQ job failures.
   */
  public async sendJobFailureAlert(queueName: string, jobId: string, error: string): Promise<void> {
    await this.sendAlert('critical', 'Background Job Failed', `A job in the '${queueName}' queue has permanently failed.`, {
      queueName,
      jobId,
      error,
    });
  }
}

export const slack = new SlackService();
