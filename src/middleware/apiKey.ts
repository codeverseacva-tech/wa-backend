import { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import ipaddr from 'ipaddr.js';
import { supabase } from '@/lib/supabase';
import { AuthError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Handles API key authentication.
 * Supports constant-time comparison of hashed keys and IP whitelisting with CIDR.
 */
export const apiKeyMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const fullApiKey = req.headers['x-api-key'] as string;
  if (!fullApiKey) {
    return next(); // Let authMiddleware or other check if required
  }

  try {
    // Expected format: prefix.secret (e.g., zap_live_abcdef123...)
    // Note: Prefix is used for lookup, secret is hashed for comparison
    const parts = fullApiKey.split('.');
    if (parts.length !== 2) {
      return next(new AuthError('INVALID_TOKEN', 401));
    }
    const [prefix, secret] = parts;

    // Use SHA-256 as required
    const incomingHash = createHash('sha256').update(secret).digest('hex');

    // Fetch key data by prefix (indexable)
    const { data: keyData, error } = await supabase
      .from('api_keys')
      .select('*, profiles(role)')
      .eq('key_prefix', prefix)
      .single();

    if (error || !keyData) {
      return next(new AuthError('INVALID_TOKEN', 401));
    }

    // 0. Sub-User Status Check (Only if this is a sub-user key)
    if (keyData.sub_user_id) {
      const { data: subUser } = await supabase
        .from('partner_sub_users')
        .select('status')
        .eq('id', keyData.sub_user_id)
        .single();
      
      if (!subUser || subUser.status !== 'active') {
        return next(new AuthError('INVALID_TOKEN', 401, 'Sub-user account is deactivated'));
      }
    }

    // Constant-time comparison of hashes in Node.js
    const dbHashBuf = Buffer.from(keyData.key_hash, 'hex');
    const incomingHashBuf = Buffer.from(incomingHash, 'hex');

    if (dbHashBuf.length !== incomingHashBuf.length || !timingSafeEqual(dbHashBuf, incomingHashBuf)) {
      return next(new AuthError('INVALID_TOKEN', 401));
    }

    // 1. Expiry Check
    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
      return next(new AuthError('API_KEY_EXPIRED', 401));
    }

    // 2. IP Whitelist Check (CIDR support via ipaddr.js)
    if (keyData.ip_whitelist && keyData.ip_whitelist.length > 0) {
      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
      const cleanIp = clientIp.split(',')[0].trim();

      const isAllowed = keyData.ip_whitelist.some((cidr: string) => {
        try {
          const addr = ipaddr.parse(cleanIp);
          const [net, bits] = ipaddr.parseCIDR(cidr);
          return addr.match(net, bits);
        } catch {
          return false;
        }
      });

      if (!isAllowed) {
        return next(new AuthError('API_KEY_IP_BLOCKED', 403));
      }
    }

    // 3. Permissions Scope Check
    // Can be handled later via RBAC based on permissions attached to req.user

    // Non-blocking update of last_used_at (hot path optimization)
    // Fix: Supabase PostgrestBuilder does not expose .catch() — wrap in a void async IIFE instead
    void (async () => {
      const { error: updateError } = await supabase
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', keyData.id);

      if (updateError) {
        logger.error({ err: updateError, keyId: keyData.id }, 'Fire-and-forget last_used_at update failed');
      }
    })();

    // Attach user context
    req.user = {
      id: keyData.user_id,
      role: keyData.profiles?.role || 'user',
      rateLimit: keyData.rate_limit,
      apiKeyId: keyData.id,
      permissions: keyData.permissions || [],
      partnerId: keyData.partner_id,
      subUserId: keyData.sub_user_id,
    };

    next();
  } catch (err) {
    next(err);
  }
};