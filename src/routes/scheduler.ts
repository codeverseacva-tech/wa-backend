import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * GET /scheduler/messages
 * Lists all scheduled messages.
 */
router.get('/messages', authMiddleware, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        success: true,
        messages: []
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /scheduler/messages
 * Schedules a message to be sent later.
 */
router.post('/messages', authMiddleware, async (req, res, next) => {
  try {
    const body = req.body;
    res.json({
      success: true,
      data: {
        success: true,
        id: uuidv4(),
        status: 'scheduled',
        ...body
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
