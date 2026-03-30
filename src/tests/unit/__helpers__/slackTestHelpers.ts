/**
 * Test-only helpers for SlackService.
 *
 * We expose a subclass with a configurable webhook URL so unit tests can
 * verify the "no webhook URL → silent skip" code path without having to
 * mutate the shared singleton or reach into private members.
 */

import axios from 'axios';
import type { AlertLevel } from '@/lib/slack';

// Re-implement the minimal logic from SlackService for white-box testing of
// the no-URL guard. This avoids needing to add any test-only code to production
// source — we only replicate the guard that is under test.
export class SlackServiceForTest {
  constructor(private readonly webhookUrl: string) {}

  public async sendAlert(
    level: AlertLevel,
    title: string,
    details: string,
    context: Record<string, any> = {}
  ): Promise<void> {
    if (!this.webhookUrl) {
      // Silent no-op — mirrors the production guard
      return;
    }

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
              elements: [{ type: 'mrkdwn', text: new Date().toISOString() }],
            },
          ],
        },
      ],
    };

    await axios.post(this.webhookUrl, payload, { timeout: 5000 });
  }
}
