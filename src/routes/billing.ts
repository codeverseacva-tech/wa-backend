import { Router } from 'express';
import { billingService } from '@/services/billing.service';
import { authMiddleware } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { z } from 'zod';

const router = Router();

const stkPushSchema = z.object({
  body: z.object({
    phoneNumber: z.string().min(10).max(15),
    amount: z.number().positive(),
    planId: z.enum(['trial', 'starter', 'business', 'custom']).default('starter'),
    billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  })
});

/**
 * GET /v1/billing/plan
 * Returns the current user's active plan.
 */
router.get('/plan', authMiddleware, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        plan: 'trial',
        status: 'active',
        sessionsUsed: 0,
        sessionsLimit: 1,
        billingCycle: 'monthly',
        renewsAt: null,
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/billing/stk-push
 */
router.post('/stk-push', authMiddleware, validate(stkPushSchema), async (req, res, next) => {
  try {
    const { phoneNumber, amount, planId, billingCycle } = req.body;
    const result = await billingService.initiateStkPush(
      (req as any).user.id,
      planId,
      billingCycle,
      phoneNumber
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/billing/payment/:id/status
 */
router.get('/payment/:id/status', authMiddleware, async (req, res, next) => {
  try {
    const result = await billingService.pollPaymentStatus(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/billing/tuma/callback
 */
router.post('/tuma/callback', async (req, res, next) => {
  try {
    await billingService.handleWebhook(req.body);
    res.status(200).json({ success: true, data: null });
  } catch (err) {
    next(err);
  }
});

export default router;