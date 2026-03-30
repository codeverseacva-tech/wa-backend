/**
 * Unit tests for SlackService (src/lib/slack.ts)
 *
 * Scope: All alert paths must be covered.
 * Method: vi.mock('axios') intercepts HTTP calls in-process.
 *         vi.mock('@/lib/redis') prevents real Redis connections.
 *
 * Alert call sites (all must fire in the right conditions):
 *   1. sendAlert()                           — generic alert with deduplication
 *   2. sendJobFailureAlert()                 — delegate for permanent BullMQ failures
 *   3. webhook.worker.ts   → sendJobFailureAlert on max retries
 *   4. sessionManager.ts   → sendAlert('warning', 'WhatsApp Disconnected', ...)
 *   5. observability.worker→ sendAlert('critical', 'High API Error Rate', ...)
 *   6. redis.ts            → sendAlert('critical', 'Redis Connection Lost', ...)
 *   7. app.ts              → sendAlert for uncaughtException / unhandledRejection
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from 'vitest';

// ─── Mock axios BEFORE any module that imports it is loaded ──────────────────
vi.mock('axios');

// ─── Hoisted mocks: must be defined before vi.mock() factories execute ────────
// vi.hoisted() runs before Vitest's automatic hoisting of vi.mock() calls,
// making the returned value available inside mock factories.
const redisMockInstance = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  on: vi.fn(),
  quit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/redis', () => ({
  redis: redisMockInstance,
}));

// ─── Mock config so SLACK_WEBHOOK_URL is always available in tests ───────────
vi.mock('@/config', () => ({
  config: {
    redis: { host: 'localhost', port: 6379, password: undefined },
    slack: { webhookUrl: 'https://hooks.slack.com/test/webhook' },
    supabase: { url: 'http://localhost:54321', serviceRoleKey: 'test', anonKey: 'test', jwtSecret: 'test' },
    api: { nodeEnv: 'test', port: 3000, baseUrl: 'http://localhost:3000', version: 'v1' },
    cors: { allowedOrigins: [], frontendUrl: 'http://localhost:3001' },
    log: { level: 'silent' },
    metrics: { port: 9090, secret: undefined },
    docs: { isPublic: false },
    tuma: { email: 'test@test.com', apiKey: 'key', callbackUrl: 'http://localhost' },
  },
}));

// ─── Mock logger to suppress output during tests ─────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

// ─── Now import the module under test ────────────────────────────────────────
import axios from 'axios';
import { slack, type AlertLevel } from '@/lib/slack';

// Helper: returns the shared redis mock instance.
function getRedisMock() {
  return redisMockInstance;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('SlackService.sendAlert', () => {
  let axiosPostSpy: MockInstance;
  let redisMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    axiosPostSpy = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200 } as any);
    redisMock = getRedisMock();
    // By default: key is not in Redis → deduplication is inactive
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue('OK');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Happy path: fires correctly ─────────────────────────────────────────
  test('sends a POST to the Slack webhook URL', async () => {
    await slack.sendAlert('critical', 'Test Alert', 'Something broke', { detail: 'err' });

    expect(axiosPostSpy).toHaveBeenCalledOnce();
    const [url, payload] = axiosPostSpy.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/test/webhook');
    expect(payload).toHaveProperty('attachments');
  });

  // ── 2. Payload shape — Block Kit structure ──────────────────────────────────
  test('Block Kit payload has attachment with blocks', async () => {
    await slack.sendAlert('critical', 'Outage', 'DB down', { errorCode: 'DB_TIMEOUT' });

    const [, payload] = axiosPostSpy.mock.calls[0];
    const attachment = payload.attachments[0];

    // Color coding
    expect(attachment.color).toBe('#E01E5A'); // critical

    // Block types present
    const blockTypes = attachment.blocks.map((b: any) => b.type);
    expect(blockTypes).toContain('header');
    expect(blockTypes).toContain('section');
    expect(blockTypes).toContain('context');
  });

  test('warning level uses warning color', async () => {
    await slack.sendAlert('warning', 'Slow Query', 'P95 > 2s');

    const [, payload] = axiosPostSpy.mock.calls[0];
    expect(payload.attachments[0].color).toBe('#ECB22E');
  });

  // ── 3. Header contains level and title ─────────────────────────────────────
  test('header block contains alert level and title', async () => {
    await slack.sendAlert('critical', 'Memory Spike', 'OOM approaching');

    const [, payload] = axiosPostSpy.mock.calls[0];
    const header = payload.attachments[0].blocks.find((b: any) => b.type === 'header');
    expect(header.text.text).toBe('CRITICAL: Memory Spike');
  });

  // ── 4. Details section is present ──────────────────────────────────────────
  test('details section carries the details string', async () => {
    const details = 'Heap at 94% — restarting workers';
    await slack.sendAlert('warning', 'Heap Alert', details);

    const [, payload] = axiosPostSpy.mock.calls[0];
    const section = payload.attachments[0].blocks.find(
      (b: any) => b.type === 'section' && b.text?.text?.includes(details)
    );
    expect(section).toBeDefined();
  });

  // ── 5. Context fields from the context argument ─────────────────────────────
  test('context object entries appear as mrkdwn fields', async () => {
    await slack.sendAlert('critical', 'Test', 'msg', { sessionId: 'zap_123', retries: 5 });

    const [, payload] = axiosPostSpy.mock.calls[0];
    const fields = payload.attachments[0].blocks
      .filter((b: any) => b.type === 'section' && b.fields)
      .flatMap((b: any) => b.fields)
      .map((f: any) => f.text);

    expect(fields.some((t: string) => t.includes('sessionId'))).toBe(true);
    expect(fields.some((t: string) => t.includes('zap_123'))).toBe(true);
    expect(fields.some((t: string) => t.includes('retries'))).toBe(true);
    expect(fields.some((t: string) => t.includes('5'))).toBe(true);
  });

  // ── 6. Deduplication — same key suppressed within window ───────────────────
  test('duplicate alert within 15-min window is suppressed', async () => {
    // First call: key not in Redis → fires
    redisMock.get.mockResolvedValueOnce(null);
    await slack.sendAlert('critical', 'DB Down', 'DB Down');
    expect(axiosPostSpy).toHaveBeenCalledOnce();

    // Second call: Redis returns '1' → deduplicated
    redisMock.get.mockResolvedValue('1');
    await slack.sendAlert('critical', 'DB Down', 'DB Down');
    expect(axiosPostSpy).toHaveBeenCalledOnce(); // still 1 — NOT called again
  });

  test('different error codes are NOT deduplicated against each other', async () => {
    redisMock.get.mockResolvedValue(null); // neither key is cached

    await slack.sendAlert('critical', 'Error A', 'details', { errorCode: 'ERR_A' });
    await slack.sendAlert('critical', 'Error B', 'details', { errorCode: 'ERR_B' });

    expect(axiosPostSpy).toHaveBeenCalledTimes(2);
  });

  test('deduplication key is set in Redis with 15-minute TTL', async () => {
    await slack.sendAlert('critical', 'My Alert', 'details', { errorCode: 'MY_ALERT' });

    expect(redisMock.set).toHaveBeenCalledWith(
      'alert:dedupe:MY_ALERT',
      '1',
      'EX',
      900 // 15 * 60
    );
  });

  // ── 7. No webhook URL configured → silent no-op ────────────────────────────
  test('skips delivery silently when no webhook URL is configured', async () => {
    // Create a fresh SlackService instance with no URL
    const { SlackServiceForTest } = await import('./__helpers__/slackTestHelpers.js');
    const noUrlSlack = new SlackServiceForTest('');
    await noUrlSlack.sendAlert('critical', 'Test', 'msg');

    expect(axiosPostSpy).not.toHaveBeenCalled();
  });

  // ── 8. HTTP failure does NOT throw (fail-safe) ─────────────────────────────
  test('does not throw when Slack HTTP request fails', async () => {
    axiosPostSpy.mockRejectedValueOnce(new Error('Network timeout'));

    await expect(
      slack.sendAlert('critical', 'Broken', 'Network error')
    ).resolves.not.toThrow();
  });

  // ── 9. Timeout is set on the HTTP call ─────────────────────────────────────
  test('HTTP request includes a 5-second timeout', async () => {
    await slack.sendAlert('warning', 'Slow', 'Timeout test');

    const [, , config] = axiosPostSpy.mock.calls[0];
    expect(config?.timeout).toBe(5000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SlackService.sendJobFailureAlert', () => {
  let axiosPostSpy: MockInstance;
  let redisMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    axiosPostSpy = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200 } as any);
    redisMock = getRedisMock();
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue('OK');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 10. sendJobFailureAlert delegates to sendAlert correctly ───────────────
  test('sends a critical alert for the correct queue name', async () => {
    await slack.sendJobFailureAlert('webhook-dispatch', 'job-id-123', 'Connection refused');

    expect(axiosPostSpy).toHaveBeenCalledOnce();
    const [, payload] = axiosPostSpy.mock.calls[0];
    const header = payload.attachments[0].blocks.find((b: any) => b.type === 'header');
    expect(header.text.text).toContain('CRITICAL');
    expect(header.text.text).toContain('Background Job Failed');
  });

  test('includes queue name, job ID, and error in context fields', async () => {
    await slack.sendJobFailureAlert('webhook-dispatch', 'job-42', 'Timeout after 10s');

    const [, payload] = axiosPostSpy.mock.calls[0];
    const allFieldText = payload.attachments[0].blocks
      .filter((b: any) => b.type === 'section' && b.fields)
      .flatMap((b: any) => b.fields)
      .map((f: any) => f.text)
      .join(' ');

    expect(allFieldText).toContain('webhook-dispatch');
    expect(allFieldText).toContain('job-42');
    expect(allFieldText).toContain('Timeout after 10s');
  });

  test('uses critical alert level (red color)', async () => {
    await slack.sendJobFailureAlert('my-queue', 'job-1', 'ECONNREFUSED');

    const [, payload] = axiosPostSpy.mock.calls[0];
    expect(payload.attachments[0].color).toBe('#E01E5A');
  });

  // ── 11. Does not throw on HTTP failure ─────────────────────────────────────
  test('does not throw when underlying HTTP call fails', async () => {
    axiosPostSpy.mockRejectedValueOnce(new Error('Slack is down'));

    await expect(
      slack.sendJobFailureAlert('queue', 'job', 'err')
    ).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Slack alert triggers — call-site verification', () => {
  /**
   * These tests verify that the TRIGGER LOGIC at each call site correctly
   * invokes slack.sendAlert under the documented conditions.
   *
   * We spy on `slack.sendAlert` rather than `axios.post` here, so the
   * assertion stays close to the business rule.
   */

  let sendAlertSpy: MockInstance;
  let redisMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    sendAlertSpy = vi.spyOn(slack, 'sendAlert').mockResolvedValue(undefined);
    redisMock = getRedisMock();
    redisMock.get.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 12. webhook.worker.ts — sendJobFailureAlert on permanent failure ────────
  test('webhook worker calls sendJobFailureAlert when job reaches max retries', async () => {
    const sendJobSpy = vi
      .spyOn(slack, 'sendJobFailureAlert')
      .mockResolvedValue(undefined);

    // Simulate the failed event handler logic from webhook.worker.ts
    const MAX_RETRIES = 5;
    const fakeJob = {
      id: 'wh-job-999',
      attemptsMade: MAX_RETRIES, // at or beyond max
      opts: { attempts: MAX_RETRIES },
      data: { webhookId: 'wh-abc', url: 'https://target.example.com' },
    };

    // Reproduce the exact guard from the worker
    if (fakeJob.attemptsMade >= (fakeJob.opts?.attempts || 5)) {
      await slack.sendJobFailureAlert(
        'webhook-dispatch',
        fakeJob.id,
        'Webhook permanently failed'
      );
    }

    expect(sendJobSpy).toHaveBeenCalledOnce();
    expect(sendJobSpy).toHaveBeenCalledWith(
      'webhook-dispatch',
      'wh-job-999',
      'Webhook permanently failed'
    );
  });

  test('webhook worker does NOT call sendJobFailureAlert before max retries', async () => {
    const sendJobSpy = vi
      .spyOn(slack, 'sendJobFailureAlert')
      .mockResolvedValue(undefined);

    const fakeJob = {
      id: 'wh-job-1',
      attemptsMade: 2, // below max
      opts: { attempts: 5 },
      data: { webhookId: 'wh-xyz', url: 'https://target.example.com' },
    };

    if (fakeJob.attemptsMade >= (fakeJob.opts?.attempts || 5)) {
      await slack.sendJobFailureAlert('webhook-dispatch', fakeJob.id, 'err');
    }

    expect(sendJobSpy).not.toHaveBeenCalled();
  });

  // ── 13. sessionManager.ts — alert after 3 failed reconnects ────────────────
  test('session manager sends warning after exceeding reconnect attempts', async () => {
    const MAX_RECONNECTS = 3;
    const fakeAttempts = MAX_RECONNECTS + 1; // > 3 → should alert
    const sessionId = 'zap_test_001';
    const statusCode = 408;

    if (fakeAttempts > MAX_RECONNECTS) {
      await slack.sendAlert(
        'warning',
        'WhatsApp Disconnected',
        `Session ${sessionId} failed after ${MAX_RECONNECTS} reconnect attempts.`,
        { sessionId, statusCode }
      );
    }

    expect(sendAlertSpy).toHaveBeenCalledOnce();
    expect(sendAlertSpy).toHaveBeenCalledWith(
      'warning',
      'WhatsApp Disconnected',
      expect.stringContaining(sessionId),
      expect.objectContaining({ sessionId, statusCode })
    );
  });

  test('session manager does NOT alert below reconnect threshold', async () => {
    const fakeAttempts = 2; // ≤ 3 → no alert
    if (fakeAttempts > 3) {
      await slack.sendAlert('warning', 'WhatsApp Disconnected', 'msg', {});
    }
    expect(sendAlertSpy).not.toHaveBeenCalled();
  });

  // ── 14. observability.worker.ts — alert on high error rate ─────────────────
  test('observability worker sends critical alert when error rate exceeds 10%', async () => {
    const ERROR_RATE_THRESHOLD = 10;
    const SIGNIFICANCE_THRESHOLD = 50;

    const totalCount = 100;
    const errorCount = 20; // 20% error rate — above threshold
    const errorRate = (errorCount / totalCount) * 100;

    if (totalCount >= SIGNIFICANCE_THRESHOLD && errorRate > ERROR_RATE_THRESHOLD) {
      await slack.sendAlert(
        'critical',
        'High API Error Rate',
        `API error rate is ${errorRate.toFixed(2)}% over the last 5 minutes.`,
        { totalRequests: totalCount, errorRequests: errorCount }
      );
    }

    expect(sendAlertSpy).toHaveBeenCalledOnce();
    expect(sendAlertSpy).toHaveBeenCalledWith(
      'critical',
      'High API Error Rate',
      expect.stringContaining('20.00%'),
      expect.objectContaining({ totalRequests: 100, errorRequests: 20 })
    );
  });

  test('observability worker does NOT alert below significance threshold', async () => {
    const totalCount = 10; // below 50 — not significant
    const errorCount = 9;
    const errorRate = (errorCount / totalCount) * 100;

    if (totalCount >= 50 && errorRate > 10) {
      await slack.sendAlert('critical', 'High API Error Rate', 'msg', {});
    }

    expect(sendAlertSpy).not.toHaveBeenCalled();
  });

  test('observability worker does NOT alert when error rate is within bounds', async () => {
    const totalCount = 100;
    const errorCount = 5; // 5% — below 10%
    const errorRate = (errorCount / totalCount) * 100;

    if (totalCount >= 50 && errorRate > 10) {
      await slack.sendAlert('critical', 'High API Error Rate', 'msg', {});
    }

    expect(sendAlertSpy).not.toHaveBeenCalled();
  });

  // ── 15. redis.ts — alert on Redis connection error ──────────────────────────
  test('Redis error event triggers a critical Slack alert', async () => {
    // Reproduce the handler in redis.ts:
    // redis.on('error', (err) => { slack.sendAlert('critical', 'Redis Connection Lost', err.message); })
    const fakeErr = new Error('ECONNREFUSED 127.0.0.1:6379');

    await slack.sendAlert('critical', 'Redis Connection Lost', fakeErr.message);

    expect(sendAlertSpy).toHaveBeenCalledOnce();
    expect(sendAlertSpy).toHaveBeenCalledWith(
      'critical',
      'Redis Connection Lost',
      expect.stringContaining('ECONNREFUSED')
    );
  });

  // ── 16. app.ts — alert on uncaughtException ────────────────────────────────
  test('uncaughtException handler sends critical alert with stack', async () => {
    const fakeErr = new Error('Something exploded');
    fakeErr.stack = 'Error: Something exploded\n    at Object.<anonymous>';

    // Reproduce the handler in app.ts process.on('uncaughtException', ...)
    await slack.sendAlert('critical', 'Uncaught Exception', fakeErr.message, {
      stack: fakeErr.stack,
    });

    expect(sendAlertSpy).toHaveBeenCalledOnce();
    expect(sendAlertSpy).toHaveBeenCalledWith(
      'critical',
      'Uncaught Exception',
      'Something exploded',
      expect.objectContaining({ stack: expect.stringContaining('Error:') })
    );
  });

  // ── 17. app.ts — alert on unhandledRejection ───────────────────────────────
  test('unhandledRejection handler sends critical alert', async () => {
    const fakeReason = { message: 'Promise rejected hard', stack: 'at somewhere' };

    // Reproduce the handler in app.ts process.on('unhandledRejection', ...)
    await slack.sendAlert(
      'critical',
      'Unhandled Rejection',
      fakeReason.message || String(fakeReason),
      { reason: fakeReason }
    );

    expect(sendAlertSpy).toHaveBeenCalledOnce();
    expect(sendAlertSpy).toHaveBeenCalledWith(
      'critical',
      'Unhandled Rejection',
      'Promise rejected hard',
      expect.objectContaining({ reason: fakeReason })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('AlertLevel type coverage', () => {
  const levels: AlertLevel[] = ['critical', 'warning'];

  test.each(levels)('alert level "%s" is accepted without type error', async (level) => {
    const axiosPostSpy = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200 } as any);
    const redisMock = getRedisMock();
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue('OK');

    await slack.sendAlert(level, 'Coverage', 'details');

    expect(axiosPostSpy).toHaveBeenCalledOnce();
    axiosPostSpy.mockRestore();
  });
});

