import express from 'express';
import helmet from 'helmet';
import { config } from '@/config';
import { logger } from '@/lib/logger';

// Middleware imports
import { requestLogger } from '@/middleware/request-logger';
import { corsMiddleware } from '@/middleware/cors';
import { apiKeyMiddleware } from '@/middleware/apiKey';
import { rateLimitMiddleware } from '@/middleware/rateLimit';
import { idempotencyMiddleware } from '@/middleware/idempotency';
import { errorHandler } from '@/middleware/errorHandler';
import { authMiddleware } from '@/middleware/auth';
import { blockScanners } from '@/middleware/blockScanners';
import { serverAdapter } from '@/lib/queues';

import router from '@/routes';
import healthRouter from '@/routes/health';
import metricsRouter from '@/routes/metrics';
import supabaseMockRouter from '@/routes/supabase-mock';
import swaggerUi from 'swagger-ui-express';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';

const openApiSpec = yaml.load(fs.readFileSync(path.join(process.cwd(), 'openapi.yaml'), 'utf8'));

const app = express();

/**
 * Admin authorization middleware (internal)
 */
const adminAuth = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'super_admin') {
     return res.status(403).json({ error: 'Access denied. Super admin only.' });
  }
  next();
};

/**
 * Signal handling for graceful shutdown.
 */
const gracefulShutdown = () => {
  logger.info('🛑 Signal received, shutting down api service...');
  // Note: Database or Redis cleanup can occur here
  process.exit(0);
};

import { slack } from '@/lib/slack';

process.on('uncaughtException', async (err) => {
  logger.fatal({ err: err.message }, '💥 Uncaught Exception');
  await slack.sendAlert('critical', 'Uncaught Exception', err.message, { stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', async (reason: any) => {
  logger.fatal({ reason: reason?.message || reason }, '💥 Unhandled Rejection');
  await slack.sendAlert('critical', 'Unhandled Rejection', reason?.message || String(reason), { reason });
});

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

/**
 * Middleware Pipeline (Order Matters!)
 */

// 0. Scanner Protection: Block common crawler/scanner paths early
app.use(blockScanners);

// 1. Traceability: Initial logging and requestId generation
app.use(requestLogger);

// 2. Security: Strict CORS policy enforcement
app.use(corsMiddleware);

// 3. Security: Secure headers (CSP, HSTS, etc.)
app.use(helmet({
  contentSecurityPolicy: true,
  crossOriginEmbedderPolicy: true,
  frameguard: { action: 'deny' },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// 4. Parsing: standard JSON body parser with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4.5 Administrative Dashboards (BullBoard)
app.use('/admin/queues', authMiddleware, adminAuth, serverAdapter.getRouter());

// 5. Authentication: API Key check (Attaches context for downstream use)
app.use(apiKeyMiddleware);

// 6. Resilience: Idempotency check for write operations
app.use(idempotencyMiddleware);

// 7. Throttling: Sliding window Rate Limiting (Tiered)
app.use(rateLimitMiddleware);

// 8. Documentation, Metrics and Mocks
const docsMiddleware = config.docs.isPublic ? [] : [authMiddleware, adminAuth];
app.use('/docs', ...docsMiddleware, swaggerUi.serve, swaggerUi.setup(openApiSpec as any));
app.use('/metrics', metricsRouter);
app.use('/auth', supabaseMockRouter);

// 9. Routing: Main application routes
app.use('/health', healthRouter);
app.use('/v1', router);

// 9. Standardized Error Handling: Must be the final middleware
app.use(errorHandler);

export default app;
