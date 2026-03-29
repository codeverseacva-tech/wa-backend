import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface WebhookLog {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: any;
  response_status?: number;
  response_body?: string;
  created_at: string;
}

export class WebhookLogsRepository extends BaseRepository {
  public async create(log: Partial<WebhookLog>, tx?: TransactionalClient): Promise<WebhookLog> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('webhook_logs')
      .insert(log)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Create webhook log failed');
    }

    return data as WebhookLog;
  }

  public async listByWebhook(webhookId: string, pagination?: Pagination, tx?: TransactionalClient): Promise<WebhookLog[]> {
    const client = this.getClient(tx);
    let query = client.from('webhook_logs')
      .select('*')
      .eq('webhook_id', webhookId)
      .order('created_at', { ascending: false });

    query = this.applyPagination(query, pagination);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as WebhookLog[];
  }
}
