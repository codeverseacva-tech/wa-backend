import { Request, Response, NextFunction } from 'express';
import { logger } from '@/lib/logger';

export class HealthController {
  public static async check(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version,
      });
    } catch (err) {
      next(err);
    }
  }
}
