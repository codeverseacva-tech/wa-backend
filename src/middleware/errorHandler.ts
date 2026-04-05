import { Request, Response, NextFunction } from 'express';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/errors';

/**
 * Global error handler middleware.
 * Catches all AppError instances and maps them to a consistent JSON response.
 * Sanitizes messages in production to follow OWASP best practices.
 */
export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const requestId = (req as any).id || 'unknown';
  const userId = (req as any).user?.id;

  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';

  if (err instanceof AppError) {
    statusCode = err.status;
    code = err.code;
    message = err.message;
  }

  // Structured logging with Pino
  logger.error({
    errorCode: code,
    path: req.path,
    userId,
    requestId,
    err: {
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    },
  }, 'Request failed');

  // OWASP: Sanitise error messages. 
  // Never leak internal messages or stack traces in production.
  const responseMessage = (process.env.NODE_ENV === 'production' && statusCode === 500) 
    ? 'An unexpected error occurred. Please try again later.' 
    : message;

  res.status(statusCode).json({
    success: false,
    error: {
      code,
    },
  });
};
