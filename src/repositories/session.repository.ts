import { supabase } from '@/lib/supabase';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export interface WhatsAppSession {
  id: string;
  user_id: string;
  session_id: string;
  status: string;
  qr_code?: string;
  created_at: string;
  updated_at: string;
}

export class SessionRepository {
  /**
   * Insert a new session record into the database.
   */
  public async createRecord(userId: string, sessionId: string): Promise<WhatsAppSession> {
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .insert({
        user_id: userId,
        session_id: sessionId,
        status: 'disconnected',
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new AppError('SESSION_ALREADY_EXISTS', 409, 'A session with this ID already exists');
      }
      logger.error({ error, userId, sessionId }, 'Failed to create session record');
      throw new AppError('DATABASE_ERROR', 500, 'Database error during session creation');
    }

    return data;
  }

  /**
   * Delete a session record from the database.
   */
  public async deleteRecord(sessionId: string): Promise<void> {
    const { error } = await supabase
      .from('whatsapp_sessions')
      .delete()
      .eq('session_id', sessionId);

    if (error) {
      logger.error({ error, sessionId }, 'Failed to delete session record');
      throw new AppError('DATABASE_ERROR', 500, 'Database error during session deletion');
    }
  }

  /**
   * Retrieve a session by its unique session ID.
   */
  public async getBySessionId(sessionId: string): Promise<WhatsAppSession | null> {
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      logger.error({ error, sessionId }, 'Failed to fetch session record');
      throw new AppError('DATABASE_ERROR', 500, 'Database error while fetching session');
    }

    return data;
  }

  /**
   * Retrieve all sessions for a specific user.
   */
  public async getByUserId(userId: string): Promise<WhatsAppSession[]> {
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      logger.error({ error, userId }, 'Failed to fetch user sessions');
      throw new AppError('DATABASE_ERROR', 500, 'Database error while listing sessions');
    }

    return data || [];
  }

  /**
   * Atomic session count for quota checks.
   */
  public async countUserSessions(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('whatsapp_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      logger.error({ error, userId }, 'Failed to count user sessions');
      throw new AppError('DATABASE_ERROR', 500, 'Database error during session count');
    }

    return count || 0;
  }

  /**
   * Fetch current plan and session limit for a user.
   */
  public async getUserLimit(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, plan_id, plans(session_limit)')
      .eq('id', userId)
      .single();

    if (error || !data) {
      logger.error({ error, userId }, 'Failed to fetch user session limit');
      throw new AppError('DATABASE_ERROR', 500, 'Database error while fetching session limit');
    }

    // Cast as per schema join for sessions
    const limit = (data.plans as any)?.session_limit || 0;
    return limit;
  }
}

export const sessionRepository = new SessionRepository();
