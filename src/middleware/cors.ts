import cors from 'cors';
import { config } from '@/config';
import { AuthError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const allowedOrigins = config.cors.allowedOrigins;

/**
 * Custom CORS configuration.
 * Enforces strict origin checking against the whitelist.
 */
export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Permit server-to-server or non-browser requests
    if (!origin) {
      return callback(null, true);
    }

    // Check against authorized origins
    const isAllowed = allowedOrigins.some((allowed) => {
      if (allowed === '*') return true;
      return allowed === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      logger.warn({ origin, allowedOrigins }, 'CORS_ORIGIN_NOT_ALLOWED');
      // Returning an error here causes the cors package to return 4xx/5xx depending on implementation
      // We wrap it in our custom AuthError for consistent handling by the global errorHandler
      callback(new AuthError('CORS_ORIGIN_NOT_ALLOWED', 403, `The origin ${origin} is not authorized for this API.`));
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-API-Key', 
    'Idempotency-Key'
  ],
  exposedHeaders: [
    'X-Request-Id', 
    'Retry-After', 
    'X-RateLimit-Remaining'
  ],
  credentials: true,
  // Preflight OPTIONS requests must return 204 immediately
  optionsSuccessStatus: 204,
});
