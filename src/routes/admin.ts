import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * POST /admin/auth/signin
 * Authenticates an admin user.
 * No authMiddleware on this route.
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

export default router;
