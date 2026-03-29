import express, { Router } from 'express';
import billingRouter from './billing';
import authRouter from './auth';
import sessionsRouter from './sessions';
import apikeysRouter from './apikeys';

const router = Router();

router.use('/billing', billingRouter);
router.use('/auth', authRouter);
router.use('/sessions', sessionsRouter);
router.use('/api-keys', apikeysRouter);

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// User to add more routes here...

export default router;
