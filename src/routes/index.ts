import { Router } from 'express';
import billingRouter from './billing';
import authRouter from './auth';
import sessionsRouter from './sessions';
import apikeysRouter from './apikeys';
import analyticsRouter from './analytics';
import templatesRouter from './templates';
import webhooksRouter from './webhooks';
import groupsRouter from './groups';
import newslettersRouter from './newsletters';
import bulkRouter from './bulk';
import schedulerRouter from './scheduler';
import validationRouter from './validation';
import adminRouter from './admin';
import stubsRouter from './stubs';
import messagesRouter from './messages';


const router = Router();

// Route registrations
router.use('/billing', billingRouter);
router.use('/auth', authRouter);
router.use('/sessions', messagesRouter);
router.use('/sessions', sessionsRouter);
router.use('/api-keys', apikeysRouter);
router.use('/analytics', analyticsRouter);
router.use('/templates', templatesRouter);
router.use('/webhooks', webhooksRouter);
router.use('/groups', groupsRouter);
router.use('/newsletters', newslettersRouter);
router.use('/bulk', bulkRouter);
router.use('/scheduler', schedulerRouter);
router.use('/validation', validationRouter);
router.use('/admin', adminRouter);
router.use('/sessions', messagesRouter);


// Catch-all stubs last
router.use('/', stubsRouter);

/**
 * Health check endpoint.
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;