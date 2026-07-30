import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webhookWorker } from '@/workers/webhook.worker';
import { WebhookLogsRepository } from '@/repositories/webhook_logs.repository';
import axios from 'axios';

// Mock dependencies
vi.mock('axios');
vi.mock('@/lib/redis', () => ({
  redis: {
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
  }
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn(),
  }
}));
vi.mock('@/lib/slack', () => ({
  slack: {
    sendAlert: vi.fn(),
    sendJobFailureAlert: vi.fn(),
  }
}));

describe('Webhook Worker Regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps dbSubUserId to sub_user_id and leaves webhook_id undefined for partner sub-users', async () => {
    // Spy on the create method prototype to capture the call made by the worker's instance
    const createSpy = vi.spyOn(WebhookLogsRepository.prototype, 'create').mockResolvedValue({} as any);

    const mockDbSubUserId = '123e4567-e89b-12d3-a456-426614174000'; // valid UUID
    
    const job = {
      id: 'job-1',
      attemptsMade: 0,
      data: {
        url: 'https://partner.com/webhook',
        secret: 'test-secret',
        eventType: 'message.received',
        payload: { test: true },
        subUserId: 'external-123',
        dbSubUserId: mockDbSubUserId,
        partnerId: 'partner-123'
      }
    } as any;

    (axios.post as any).mockResolvedValueOnce({
      status: 200,
      data: { success: true }
    });

    // Execute worker logic manually for testing
    // In BullMQ v5, the processor is accessible via the processFn property
    const processor = (webhookWorker as any).processFn;
    
    await expect(processor(job)).resolves.not.toThrow();

    // Verify the logsRepo.create call
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook_id: undefined, // explicitly undefined, not 'sub_123...'
        sub_user_id: mockDbSubUserId,
        event_type: 'message.received',
        response_status: 200,
      })
    );
  });
});
