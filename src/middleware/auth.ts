import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { AuthError } from '../lib/errors';
import { config } from '../config/index.js';

/**
 * Supabase JWT verification middleware (HS256).
 * Verifies the Bearer token using the Supabase JWT secret and attaches req.user.
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AuthError('INVALID_TOKEN', 401));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.supabase.jwtSecret, {
      audience: 'authenticated',
      issuer: `${config.supabase.url}/auth/v1`,
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;

    req.user = {
      id: decoded.sub!,
      email: decoded.email,
      role: decoded.role || 'user',
    };

    next();
  } catch (err) {
    next(new AuthError('INVALID_TOKEN', 401));
  }
};
