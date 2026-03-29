import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

/**
 * Global Prometheus Registry
 */
export const register = new Registry();

// Add default metrics (CPU, Memory, Event Loop, etc.)
collectDefaultMetrics({ register, prefix: 'zaplink_' });

/**
 * HTTP Metrics
 */
export const httpRequestsTotal = new Counter({
  name: 'zaplink_http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'path', 'status_code'],
  registers: [register],
});

export const httpRequestDurationMs = new Histogram({
  name: 'zaplink_http_request_duration_ms',
  help: 'Duration of HTTP requests in milliseconds',
  labelNames: ['method', 'path', 'status_code'],
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
  registers: [register],
});

/**
 * BullMQ Metrics
 */
export const bullmqJobsCompletedTotal = new Counter({
  name: 'zaplink_bullmq_jobs_completed_total',
  help: 'Total number of background jobs completed successfully',
  labelNames: ['queue_name'],
  registers: [register],
});

export const bullmqJobsFailedTotal = new Counter({
  name: 'zaplink_bullmq_jobs_failed_total',
  help: 'Total number of background jobs failed',
  labelNames: ['queue_name', 'error_code'],
  registers: [register],
});

/**
 * WhatsApp Specific Metrics
 */
export const baileysActiveSessions = new Gauge({
  name: 'zaplink_baileys_active_sessions',
  help: 'Number of active/connected WhatsApp sessions',
  registers: [register],
});

/**
 * Redis Connectivity Metric
 */
export const redisConnected = new Gauge({
  name: 'zaplink_redis_connected',
  help: 'State of Redis connection (1 = connected, 0 = disconnected)',
  registers: [register],
});
