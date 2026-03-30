import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * GET /bulk/campaigns
 * Lists all bulk messaging campaigns.
 */
router.get('/campaigns', authMiddleware, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        success: true,
        campaigns: []
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /bulk/campaigns
 * Creates a new bulk campaign.
 */
router.post('/campaigns', authMiddleware, async (req, res, next) => {
  try {
    const body = req.body;
    const campaignId = uuidv4();
    res.json({
      success: true,
      data: {
        success: true,
        id: campaignId,
        campaign_id: campaignId,
        status: 'draft',
        ...body
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /bulk/campaigns/:id/start
 * Starts a bulk campaign.
 */
router.post('/campaigns/:id/start', authMiddleware, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        success: true,
        started: true
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
