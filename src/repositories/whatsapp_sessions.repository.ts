import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface WhatsappSession {
  id: string;
  user_id: string;
  session_id: string;
  status: string;
  qr_code?: string;
  created_at: string;
  updated_at: string;
}

export class WhatsappSessionsRepository extends BaseRepository {
  public async create(session: Partial<WhatsappSession>, tx?: TransactionalClient): Promise<WhatsappSession> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('whatsapp_sessions')
      .insert(session)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Create session failed');
    }

    return data as WhatsappSession;
  }

  public async findBySessionId(sessionId: string, tx?: TransactionalClient): Promise<WhatsappSession> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('whatsapp_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error || !data) {
      throw new AppError('SESSION_NOT_FOUND', 404, `Session ${sessionId} not found`);
    }

    return data as WhatsappSession;
  }

  public async updateStatus(id: string, status: string, tx?: TransactionalClient): Promise<WhatsappSession> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('whatsapp_sessions')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Update status failed');
    }

    return data as WhatsappSession;
  }

  public async listByUser(userId: string, pagination?: Pagination, tx?: TransactionalClient): Promise<WhatsappSession[]> {
    const client = this.getClient(tx);
    let query = client.from('whatsapp_sessions')
      .select('*')
      .eq('user_id', userId);
    
    query = this.applyPagination(query, pagination);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as WhatsappSession[];
  }
}
