import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { AuthError } from '../lib/errors';
import { config } from '../config/index.js';
import { createClient } from '@supabase/supabase-js';
import { ProfilesRepository } from '../repositories/profiles.repository';

export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // If apiKeyMiddleware already authenticated this request, skip JWT check
  if (req.user) return next();

  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AuthError('MISSING_TOKEN', 401));
  }

  const token = authHeader.split(' ')[1];

  try {
    // Use Supabase client to verify the token — handles both HS256 and RS256
    // automatically using the correct keys from Supabase
    const supabase = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return next(new AuthError('INVALID_TOKEN', 401));
    }

    // Fetch the role from the profiles table for consistency
    // We already have a Supabase client, but we'll use the repository for standard logic
    const profilesRepo = new ProfilesRepository();
    let profile;
    try {
      profile = await profilesRepo.findById(user.id);
    } catch (profileError) {
      // If profile not found, fallback to meta_data or default
      console.warn(`Profile not found for user ${user.id}, falling back to metadata`);
    }

    req.user = {
      id: user.id,
      email: user.email ?? '',
      role: profile?.role || 
        (user.user_metadata?.role as string) ||
        (user.app_metadata?.role as string) || 'user',
    };

    next();
  } catch (err) {
    next(new AuthError('INVALID_TOKEN', 401));
  }
};