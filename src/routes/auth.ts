import { Router } from 'express';
import { generateMockJWT } from './supabase-mock';
import { z } from 'zod';
import { validate } from '@/middleware/validate';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string(),
  })
});

/**
 * POST /v1/auth/signin
 */
router.post('/signin', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const token = generateMockJWT({
      sub: '00000000-0000-0000-0000-000000000000',
      email,
      role: 'authenticated'
    });
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/auth/me
 * Returns the currently authenticated user based on their JWT.
 */
router.get('/me', authMiddleware, (req, res) => {
  res.json({ success: true, data: req.user });
});

export default router;
