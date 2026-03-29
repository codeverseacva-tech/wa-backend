import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { AuthError } from '@/lib/errors';
import { config } from '@/config';

const jwksClient = jwksRsa({
  jwksUri: `${config.supabase.url}/auth/v1/jwks`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000, // 10 minutes
});

/**
 * Gets the public key from the Supabase JWKS endpoint to verify the JWT.
 */
const getKey = (header: any, callback: any) => {
  jwksClient.getSigningKey(header.kid, (err, key: any) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
};

/**
 * Supabase JWT verification middleware.
 * Verifies the Bearer token and attaches req.user.
 */
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AuthError('INVALID_TOKEN', 401));
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(
    token,
    getKey,
    {
      audience: 'authenticated',
      issuer: `${config.supabase.url}/auth/v1`,
      algorithms: ['RS256'],
    },
    (err, decoded) => {
      if (err || !decoded) {
        return next(new AuthError('INVALID_TOKEN', 401));
      }

      const payload = decoded as JwtPayload;
      
      // Attach to req.user as specified: { id, email, role }
      req.user = {
        id: payload.sub!,
        email: payload.email as string,
        role: (payload.role as string) || 'user',
      };
      
      next();
    }
  );
};
