import { Router } from 'express';
import { generateMockJWT } from './supabase-mock';
import { AppError } from '@/lib/errors';
import { z } from 'zod';
import { validate } from '@/middleware/validate';

const router = Router();

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string(),
  })
});

/**
 * POST /v1/auth/signin
 * Mock login for local testing. In production, this would call Supabase auth.
 */
router.post('/signin', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // In local dev, accept any user for testing
    // For specific tests, we could check passwords
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

export default router;
