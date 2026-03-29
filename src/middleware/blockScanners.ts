import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

const BLOCKED_PATHS = [
  '/wp-admin', 
  '/.env', 
  '/phpinfo.php',
  '/administrator', 
  '/.git', 
  '/config.php'
];

/**
 * Middleware to block common scanner paths.
 * Returns 404 for any match to discourage further scanning.
 */
export const blockScanners = (req: Request, res: Response, next: NextFunction) => {
  const isBlocked = BLOCKED_PATHS.some(path => req.path.startsWith(path));

  if (isBlocked) {
    logger.warn({ path: req.path, ip: req.ip }, 'Blocked scanner path detected');
    return res.status(404).end();
  }

  next();
};
