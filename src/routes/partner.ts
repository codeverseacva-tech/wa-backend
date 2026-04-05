import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes, createHmac } from 'crypto';
import axios from 'axios';
import { SubUsersRepository } from '@/repositories/sub_users.repository';
import { APIKeysRepository } from '@/repositories/api_keys.repository';
import { PartnersRepository } from '@/repositories/partners.repository';
import { WebhookLogsRepository } from '@/repositories/webhook_logs.repository';
import { partnerAuth } from '@/middleware/partnerAuth';
import { authMiddleware } from '@/middleware/auth';
import { supabase } from '@/lib/supabase';

const router = Router();
const subUserRepo = new SubUsersRepository();
const apiKeyRepo = new APIKeysRepository();
const partnerRepo = new PartnersRepository();
const logsRepo = new WebhookLogsRepository();

/**
 * POST /v1/partner/sub-users
 * STEP 3 — Create a sub-user
 */
router.post('/sub-users', authMiddleware, partnerAuth, async (req: any, res, next) => {
  try {
    const { external_user_id, display_name } = req.body;
    const partner = req.partner;

    // 1. Generate Sub-User API Key (Scoped)
    const prefixString = `zap_${randomBytes(4).toString('hex')}`;
    const secretPart = randomBytes(24).toString('base64url');
    const fullApiKey = `${prefixString}.${secretPart}`;
    const hash = createHash('sha256').update(secretPart).digest('hex');
    const subUserRecordId = uuidv4();
    const apiKeyId = uuidv4();

    await apiKeyRepo.create({
      id: apiKeyId,
      user_id: req.user.id, 
      key_name: `${display_name || external_user_id} (Sub-user)`,
      key_hash: hash,
      key_prefix: prefixString,
      permissions: ['messages:send', 'messages:read', 'sessions:manage'], 
      rate_limit: 100,
      partner_id: partner.id,
      sub_user_id: subUserRecordId,
    });

    // 2. Create Sub-User Record
    const webhookSecret = `whsec_${randomBytes(24).toString('hex')}`;
    const urlSuffix = randomBytes(6).toString('hex');

    const subUser = await subUserRepo.create({
      id: subUserRecordId,
      partner_id: partner.id,
      external_user_id,
      display_name,
      api_key_id: apiKeyId,
      webhook_secret: webhookSecret,
      webhook_url_suffix: urlSuffix,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      data: {
        sub_user_id: subUser.id,
        api_key: fullApiKey,
        webhook_secret: subUser.webhook_secret,
        webhook_url: subUser.fullWebhookUrl
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/partner/sub-users
 * STEP 4 — List sub-users
 */
router.get('/sub-users', authMiddleware, partnerAuth, async (req: any, res, next) => {
  try {
    if (!req.partner) {
      return res.json({ success: true, data: { data: [], total: 0 } });
    }
    const partnerId = req.partner.id;
    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 1;
    const offset = parseInt(req.query.offset as string) || (page - 1) * limit;

    const subUsers = await subUserRepo.listByPartner(partnerId, { status: status as any, limit, offset });

    res.json({
      success: true,
      data: {
        data: subUsers.map(u => ({
          sub_user_id: u.id,
          external_user_id: u.external_user_id,
          display_name: u.display_name,
          webhook_url: u.fullWebhookUrl,
          key_prefix: u.apiKeyPrefix,
          status: u.status === 'active' ? 'active' : 'deactivated',
          session_status: u.whatsappStatus || null
        })),
        total: subUsers.length
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/partner/sub-users/:externalUserId
 * STEP 5 — Look up sub-user by external ID
 */
router.get('/sub-users/:externalUserId', authMiddleware, partnerAuth, async (req: any, res, next) => {
  try {
    const partnerId = req.partner.id;
    const { externalUserId } = req.params;

    const subUser = await subUserRepo.findByExternalId(partnerId, externalUserId);

    res.json({
      success: true,
      data: {
        external_user_id: subUser.external_user_id,
        webhook_url: subUser.fullWebhookUrl,
        session_status: subUser.whatsappStatus || null,
        status: subUser.status === 'active' ? 'active' : 'deactivated'
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/partner/sub-users/:externalUserId/rotate-secret
 * STEP 7 — Rotate webhook secret
 */
router.post('/sub-users/:externalUserId/rotate-secret', authMiddleware, partnerAuth, async (req: any, res, next) => {
  try {
    const partnerId = req.partner.id;
    const { externalUserId } = req.params;

    const subUser = await subUserRepo.findByExternalId(partnerId, externalUserId);
    const newSecret = `whsec_${randomBytes(24).toString('hex')}`;

    const updated = await subUserRepo.update(subUser.id, {
      webhook_secret: newSecret,
      updated_at: new Date().toISOString()
    });

    res.json({
      success: true,
      data: {
        webhook_secret: updated.webhook_secret
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/partner/test-webhook
 * STEP 8 — Simulate inbound webhook delivery
 */
router.post('/test-webhook', authMiddleware, partnerAuth, async (req: any, res, next) => {
    try {
      const { event, sub_user_id, payload } = req.body;
      const partner = req.partner;
  
      // 1. Fetch sub-user to get their secret and URL
      const { data: subUser, error } = await supabase
        .from('partner_sub_users')
        .select('*')
        .eq('id', sub_user_id)
        .eq('partner_id', partner.id)
        .single();
  
      if (error || !subUser) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
      }
  
      // 2. Generate full URL (need partner base_webhook_url)
      const fullUrl = `${partner.base_webhook_url.replace(/\/$/, '')}/${subUser.webhook_url_suffix}`;
  
      // 3. Dispatch webhook (asynchronous)
      const signature = createHmac('sha256', subUser.webhook_secret)
        .update(JSON.stringify(payload || {}))
        .digest('hex');
  
      void (async () => {
          try {
              await axios.post(fullUrl, payload || {}, {
                  headers: {
                      'Content-Type': 'application/json',
                      'X-Zaplink-Signature': `sha256=${signature}`,
                      'X-Zaplink-Sub-User-Id': subUser.id,
                      'X-Zaplink-Partner-Id': partner.id,
                      'User-Agent': 'Zaplink-Webhook-Tester/1.0'
                  },
                  timeout: 10000
              });
          } catch (e) {
              // Log failure silently as Step 8 is a fire-and-forget for the client
          }
      })();
  
      res.json({
        success: true,
        data: {
          job_id: uuidv4()
        }
      });
    } catch (err) {
      next(err);
    }
  });

/**
 * DELETE /v1/partner/sub-users/:externalUserId
 * STEP 9 — Deactivate sub-user
 */
router.delete('/sub-users/:externalUserId', authMiddleware, partnerAuth, async (req: any, res, next) => {
  try {
    if (!req.partner) {
        return res.status(403).json({ success: false, error: { code: 'PARTNER_CONTEXT_REQUIRED' } });
    }
    const partnerId = req.partner.id;
    const { externalUserId } = req.params;

    await subUserRepo.deactivate(partnerId, externalUserId);

    res.json({
      success: true,
      data: null
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/partner/overview
 */
router.get('/overview', authMiddleware, partnerAuth, async (req: any, res, next) => {
  try {
    if (!req.partner) {
      return res.json({
        success: true,
        data: {
          stats: {
            total_sub_users: 0,
            connected_sessions: 0,
            delivered_today: 0,
            failed_today: 0
          },
          recent_activity: [],
          delivery_health: []
        }
      });
    }

    const partnerId = req.partner.id;

    // 1. Stats
    const { count: totalSubUsers } = await supabase
      .from('partner_sub_users')
      .select('*', { count: 'exact', head: true })
      .eq('partner_id', partnerId);

    const { count: connectedSessions } = await supabase
      .from('whatsapp_sessions')
      .select('*, partner_sub_users!sub_user_id!inner(partner_id)', { count: 'exact', head: true })
      .eq('partner_sub_users.partner_id', partnerId)
      .eq('status', 'authenticated');

    // 2. Webhook Health (Aggregation)
    const rawLogs = await logsRepo.getStats(partnerId, 7);
    const deliveredToday = rawLogs.filter(l => l.response_status >= 200 && l.response_status < 300 && new Date(l.created_at).toDateString() === new Date().toDateString()).length;
    const failedToday = rawLogs.filter(l => (l.response_status < 200 || l.response_status >= 300) && new Date(l.created_at).toDateString() === new Date().toDateString()).length;

    // 3. Activity
    const recentActivity = await subUserRepo.listByPartner(partnerId, { limit: 5, offset: 0 });

    // Aggregate health by day for chart
    const healthMap = new Map<string, { delivered: number; failed: number }>();
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        healthMap.set(d.toISOString().split('T')[0], { delivered: 0, failed: 0 });
    }

    rawLogs.forEach(log => {
        const dateStr = log.created_at.split('T')[0];
        if (healthMap.has(dateStr)) {
            const entry = healthMap.get(dateStr)!;
            if (log.response_status >= 200 && log.response_status < 300) entry.delivered++;
            else entry.failed++;
        }
    });

    res.json({
      success: true,
      data: {
        stats: {
          total_sub_users: totalSubUsers || 0,
          connected_sessions: connectedSessions || 0,
          delivered_today: deliveredToday,
          failed_today: failedToday
        },
        recent_activity: recentActivity.map(u => ({
          sub_user_id: u.id,
          external_id: u.external_user_id,
          session_status: u.whatsappStatus?.toUpperCase() || 'DISCONNECTED',
          created_at: u.created_at
        })),
        delivery_health: Array.from(healthMap.entries()).map(([date, stats]) => ({
            date,
            ...stats
        }))
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/partner/webhook-logs
 */
router.get('/webhook-logs', authMiddleware, partnerAuth, async (req: any, res, next) => {
  try {
    if (!req.partner) {
      return res.json({ success: true, data: [] });
    }
    const partnerId = req.partner.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 1;
    const offset = parseInt(req.query.offset as string) || (page - 1) * limit;

    const logs = await logsRepo.listByPartner(partnerId, { limit, offset });

    res.json({
      success: true,
      data: logs.map(l => ({
        id: l.id,
        timestamp: l.created_at,
        external_id: l.partner_sub_users?.external_user_id,
        event_type: l.event_type,
        status: (l.response_status >= 200 && l.response_status < 300) ? 'delivered' : 'failed',
        status_code: l.response_status,
        request_payload: l.payload,
        response_body: l.response_body,
        attempts: 1, // Placeholder until retry table is implemented
        duration_ms: Math.floor(Math.random() * 200) + 50, // Placeholder
        retries: [], // Placeholder
        signature_header: `sha256=${createHmac('sha256', l.partner_sub_users?.webhook_secret || 'secret').update(JSON.stringify(l.payload)).digest('hex')}`
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/partner/settings
 */
router.get('/settings', authMiddleware, partnerAuth, async (req: any, res, next) => {
  try {
    const partner = req.partner;
    if (!partner) {
        return res.json({ 
          success: true, 
          data: { 
            base_webhook_url: '', 
            master_key_prefix: null,
            delivery_config: { retry_attempts: 3, retry_strategy: 'exponential', pause_threshold: 10 }
          } 
        });
    }
    const key = partner.master_api_key_id ? await apiKeyRepo.findById(partner.master_api_key_id) : null;

    res.json({
      success: true,
      data: {
        base_webhook_url: partner.base_webhook_url,
        master_key_prefix: key?.key_prefix || null,
        delivery_config: {
          retry_attempts: 3,
          retry_strategy: 'exponential',
          pause_threshold: 10
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /v1/partner/settings
 */
router.patch('/settings', authMiddleware, partnerAuth, async (req: any, res, next) => {
  try {
    if (!req.partner) {
        return res.status(403).json({ success: false, error: { code: 'PARTNER_CONTEXT_REQUIRED' } });
    }
    const partnerId = req.partner.id;
    const { base_webhook_url } = req.body;

    const updated = await partnerRepo.update(partnerId, { 
      base_webhook_url,
      updated_at: new Date().toISOString()
    });

    res.json({
      success: true,
      data: {
        base_webhook_url: updated.base_webhook_url
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/partner/settings/test-webhook
 */
router.post('/settings/test-webhook', authMiddleware, partnerAuth, async (req: any, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: { message: 'URL is required' } });
    }

    try {
      const resp = await axios.post(url, {
        event: 'ping',
        timestamp: new Date().toISOString(),
        payload: { message: 'This is a test webhook from Zaplink' }
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Zaplink-Webhook-Tester/1.0'
        },
        timeout: 10000,
        validateStatus: () => true 
      });

      res.json({
        success: true,
        data: {
          status: resp.status,
          body: typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data)
        }
      });
    } catch (error: any) {
      res.json({
        success: true,
        data: {
          status: error.response?.status || 504,
          body: error.message || 'Ping failed (network error or timeout)'
        }
      });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/partner/settings/regenerate-master-key
 * STEP 11 — Rotate or Provision Master API Key
 */
router.post('/settings/regenerate-master-key', authMiddleware, partnerAuth, async (req: any, res, next) => {
  try {
    let partner = req.partner;
    const userId = req.user.id;

    // 1. Generate New Key
    const prefixString = `zap_master_${randomBytes(4).toString('hex')}`;
    const secretPart = randomBytes(24).toString('base64url');
    const fullApiKey = `${prefixString}.${secretPart}`;
    const hash = createHash('sha256').update(secretPart).digest('hex');
    const newApiKeyId = uuidv4();

    // 2. Create the API key record
    // If partner doesn't exist yet, we'll link it back after creation
    await apiKeyRepo.create({
      id: newApiKeyId,
      user_id: userId,
      key_name: partner ? 'Master Partner Key (Rotated)' : 'Master Partner Key (Initial)',
      key_hash: hash,
      key_prefix: prefixString,
      permissions: ['partner:admin', 'messages:send', 'sessions:manage'], 
      rate_limit: 5000,
      partner_id: partner?.id || undefined
    });

    if (!partner) {
        // 3. Auto-Onboard: Create Partner Record
        const partnerId = uuidv4();
        partner = await partnerRepo.create({
            id: partnerId,
            partner_name: req.user.email?.split('@')[0] || 'Unknown Partner',
            contact_email: req.user.email,
            base_webhook_url: '',
            master_api_key_id: newApiKeyId,
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        // 4. Update the API key to link back to the new partner
        await apiKeyRepo.update(newApiKeyId, { partner_id: partnerId });
    } else {
        // 5. Update existing Partner to use the new key ID
        await partnerRepo.update(partner.id, {
            master_api_key_id: newApiKeyId,
            updated_at: new Date().toISOString()
        });

        // 6. Revoke the old key
        if (partner.master_api_key_id) {
            try {
                await apiKeyRepo.delete(partner.master_api_key_id, userId);
            } catch (e) {
                // Log error but continue as the new key is already set
                console.error('Failed to revoke old master key:', e);
            }
        }
    }

    res.json({
      success: true,
      data: {
        api_key: fullApiKey,
        key_prefix: prefixString
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
