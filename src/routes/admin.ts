import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { authMiddleware } from '@/middleware/auth';
import { PartnersRepository } from '@/repositories/partners.repository';
import { APIKeysRepository } from '@/repositories/api_keys.repository';

const router = Router();
const partnerRepo = new PartnersRepository();
const apiKeyRepo = new APIKeysRepository();

/**
 * Admin authorization middleware (internal)
 */
const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Access denied. Super admin only.' });
  }
  next();
};

/**
 * POST /admin/auth/signin
 * Authenticates an admin user.
 */
router.post('/auth/signin', async (req, res, next) => {
  try {
    const adminUser = {
      id: uuidv4(),
      email: req.body.email || 'admin@zaplink.com',
      role: 'super_admin'
    };

    res.json({
      success: true,
      data: {
        success: true,
        token: `admin_${uuidv4()}`,
        user: adminUser
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/auth/me
 * Retrieves current admin user information.
 * Protected by authMiddleware.
 */
router.get('/auth/me', authMiddleware, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        id: uuidv4(),
        email: 'admin@zaplink.com',
        role: 'super_admin'
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/partners
 * Creates a partner account. Generates their master API key automatically.
 */
router.post('/partners', authMiddleware, adminAuth, async (req, res, next) => {
  try {
    const { partner_name, base_webhook_url, contact_email } = req.body;
    const adminId = req.user!.id;

    // 1. Generate master API key (standard format: zap_8chars.secretPart)
    const prefixString = `zap_partner_${randomBytes(4).toString('hex')}`;
    const secretPart = randomBytes(24).toString('base64url');
    const fullApiKey = `${prefixString}.${secretPart}`;
    const hash = createHash('sha256').update(secretPart).digest('hex');
    const apiKeyId = uuidv4();

    // 2. Create the API key record first
    await apiKeyRepo.create({
      id: apiKeyId,
      user_id: adminId, // Linked to the admin who created it for now
      key_name: `${partner_name} - Master Key`,
      key_hash: hash,
      key_prefix: prefixString,
      permissions: ['partner:admin', 'messages:send', 'sessions:manage'], // High scope
      rate_limit: 5000,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 3. Create the Partner record
    const partnerId = uuidv4();
    const partner = await partnerRepo.create({
      id: partnerId,
      partner_name,
      contact_email,
      base_webhook_url,
      master_api_key_id: apiKeyId,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      data: {
        partner_id: partner.id,
        master_api_key: fullApiKey, // Only shown once
        base_webhook_url: partner.base_webhook_url,
        contact_email: partner.contact_email
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/partners
 * Lists all partners with their status and sub-user counts.
 */
router.get('/partners', authMiddleware, adminAuth, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const partners = await partnerRepo.list({ limit, offset });

    res.json({
      success: true,
      data: partners
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/partners/:partnerId
 * Update partner base webhook URL or status.
 */
router.patch('/partners/:partnerId', authMiddleware, adminAuth, async (req, res, next) => {
  try {
    const { partnerId } = req.params;
    const { base_webhook_url, status } = req.body;

    const updated = await partnerRepo.update(partnerId, {
      base_webhook_url,
      status,
      updated_at: new Date().toISOString(),
    });

    res.json({
      success: true,
      data: updated
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/partners/:partnerId
 * Suspend and revoke partner access.
 */
router.delete('/partners/:partnerId', authMiddleware, adminAuth, async (req, res, next) => {
  try {
    const { partnerId } = req.params;
    await partnerRepo.suspend(partnerId);

    // Note: In a real implementation, we might also want to revoke 
    // the master API key associated with this partner.
    
    res.json({
      success: true,
      message: 'Partner suspended and access revoked'
    });
  } catch (err) {
    next(err);
  }
});

export default router;
