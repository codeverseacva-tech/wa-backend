import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '@/middleware/auth';
import { apiKeyMiddleware } from '@/middleware/apiKey';
import { WebhooksRepository } from '@/repositories/webhooks.repository';
import { WebhookLogsRepository } from '@/repositories/webhook_logs.repository';
import { webhookService } from '@/services/webhook.service';

const router = Router();
const webhooksRepo = new WebhooksRepository();
const logsRepo = new WebhookLogsRepository();

// Combined auth guard — accepts either a JWT Bearer token or an API key
const anyAuth = [apiKeyMiddleware, authMiddleware];

/**
 * GET /v1/webhooks/
 * Returns a list of all webhook configurations for the authenticated user.
 */
router.get('/', ...anyAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const webhooks = await webhooksRepo.listByUser(userId);
    res.json({
      success: true,
      data: webhooks
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/webhooks/logs
 * Returns paginated audit logs for all webhook delivery attempts by this user.
 * Declared before /:id so Express does not treat "logs" as an :id param.
 */
router.get('/logs', ...anyAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const logs = await logsRepo.listByUser(userId, { limit, offset });

    res.json({
      success: true,
      data: logs
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/webhooks/:id
 * Returns a single webhook configuration scoped to the authenticated user.
 */
router.get('/:id', ...anyAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const webhook = await webhooksRepo.getById(req.params.id, userId);
    res.json({
      success: true,
      data: webhook
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/webhooks/
 * Creates a new webhook configuration.
 * Auto-generates a signing secret if none is provided.
 */
router.post('/', ...anyAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { url, events, secret } = req.body;

    const webhook = await webhooksRepo.create({
      user_id: userId,
      url,
      events: events || [],
      secret: secret || 'whsec_' + uuidv4().replace(/-/g, ''),
      is_active: true
    });

    res.json({
      success: true,
      data: webhook
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /v1/webhooks/:id
 * Updates an existing webhook configuration (url, events, is_active, etc).
 */
router.patch('/:id', ...anyAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    // Verify ownership before allowing update
    await webhooksRepo.getById(id, userId);

    const updated = await webhooksRepo.update(id, req.body);
    res.json({
      success: true,
      data: updated
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /v1/webhooks/:id
 * Deletes a webhook configuration.
 */
router.delete('/:id', ...anyAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    await webhooksRepo.deleteById(id, userId);

    res.json({
      success: true,
      data: null
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/webhooks/:id/test
 * Sends a real test delivery through the BullMQ worker pipeline.
 * Validates ownership, then enqueues a webhook.test event for the registered URL.
 */
router.post('/:id/test', ...anyAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;

    // Verify the webhook exists and belongs to this user
    const webhook = await webhooksRepo.getById(req.params.id, userId);

    if (!webhook.is_active) {
      res.status(400).json({
        success: false,
        error: {
          code: 'WEBHOOK_INACTIVE',
          message: 'Cannot test an inactive webhook. Enable it first.'
        }
      });
      return;
    }

    // Dispatch a real test event scoped to THIS webhook only
    await webhookService.dispatchToWebhook(
      webhook,
      'webhook.test',
      {
        webhookId: webhook.id,
        message: 'This is a test delivery from Zaplink',
        timestamp: new Date().toISOString(),
      }
    );

    res.json({
      success: true,
      data: {
        delivered: true,
        message: 'Test event enqueued. Check your endpoint and webhook logs for delivery confirmation.'
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;