import { Request, Response, NextFunction } from 'express';
import { PartnersRepository } from '@/repositories/partners.repository';
import { AuthError } from '@/lib/errors';

const repo = new PartnersRepository();

/**
 * Middleware that ensures the request is authenticated with a Partner Master Key.
 * Attaches 'partnerId' to the Request object.
 */
export const partnerAuth = async (req: any, res: Response, next: NextFunction) => {
  const permissions = req.user?.permissions || [];
  const isSuperAdmin = req.user?.role === 'super_admin';
  const isPartner = req.user?.role === 'partner';

  if (!permissions.includes('partner:admin') && !isSuperAdmin && !isPartner) {
    return next(new AuthError('FORBIDDEN', 403, 'Partner:admin scope required'));
  }

  // Identify the partner context
  const apiKeyId = req.user?.apiKeyId;
  const userId = req.user?.id;

  try {
    let partner;
    if (apiKeyId) {
      partner = await repo.findByMasterKeyId(apiKeyId);
    } else if (userId) {
      // Fallback: If no API key (e.g. Dashboard session), look up partner by user ID
      // This allows partners and super_admins to access these routes via browser
      try {
        partner = await repo.findByUserId(userId);
      } catch (e) {
        // If not found as partner, maybe they are super_admin managing someone else
        // or just don't have a partner profile. 
        if (!isSuperAdmin) throw e;
      }
    }

    if (!partner && !isSuperAdmin && !isPartner) {
      return next(new AuthError('FORBIDDEN', 403, 'Partner context not found. Please ensure you have the required role or API key.'));
    }

    if (partner && partner.status !== 'active') {
      return next(new AuthError('FORBIDDEN', 403, 'Partner account is suspended'));
    }
    
    // Attach partner context for route usage
    req.partner = partner;
    next();
  } catch (err) {
    console.error('[PartnerAuth] Error identifying partner context:', err);
    next(new AuthError('FORBIDDEN', 403, 'Partner access denied'));
  }
};
