import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface Message {
  id: string;
  session_id: string;
  from_jid: string;
  to_jid: string;
  message_data: any;
  key: any;
  status: string;
  timestamp: number;
  created_at: string;
}

export class MessagesRepository extends BaseRepository {
  public async create(message: Partial<Message>, tx?: TransactionalClient): Promise<Message> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('messages')
      .insert(message)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Create message failed');
    }

    return data as Message;
  }

  public async listBySession(sessionId: string, pagination?: Pagination, tx?: TransactionalClient): Promise<Message[]> {
    const client = this.getClient(tx);
    let query = client.from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: false });

    query = this.applyPagination(query, pagination);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as Message[];
  }
}
