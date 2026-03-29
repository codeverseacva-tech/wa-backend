import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface ScheduledMessage {
  id: string;
  user_id: string;
  session_id: string;
  recipient_phone: string;
  message_type: string;
  message_data: any;
  scheduled_at: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export class ScheduledMessagesRepository extends BaseRepository {
  public async create(msg: Partial<ScheduledMessage>, tx?: TransactionalClient): Promise<ScheduledMessage> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('scheduled_messages')
      .insert(msg)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Create scheduled message failed');
    }

    return data as ScheduledMessage;
  }

  public async findPendingBefore(date: string, tx?: TransactionalClient): Promise<ScheduledMessage[]> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('scheduled_messages')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', date);

    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as ScheduledMessage[];
  }

  public async updateStatus(id: string, status: ScheduledMessage['status'], tx?: TransactionalClient): Promise<ScheduledMessage> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('scheduled_messages')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Update scheduled message status failed');
    }

    return data as ScheduledMessage;
  }
}
