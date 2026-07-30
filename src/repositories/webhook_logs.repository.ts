import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface WebhookLog {
  id: string;
  webhook_id?: string;
  sub_user_id?: string;
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
  public async listByUser(userId: string, pagination?: Pagination, tx?: TransactionalClient): Promise<any[]> {
    const client = this.getClient(tx);
    let query = client.from('webhook_logs')
      .select('*, webhooks!inner(url)')
      .eq('webhooks.user_id', userId)
      .order('created_at', { ascending: false });

    query = this.applyPagination(query, pagination);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data;
  }

  public async listByPartner(partnerId: string, pagination?: Pagination, tx?: TransactionalClient): Promise<any[]> {
    const client = this.getClient(tx);
    // Join logs -> partner_sub_users (to check partner_id)
    let query = client
      .from('webhook_logs')
      .select('*, partner_sub_users!inner(partner_id, external_user_id, webhook_secret)')
      .eq('partner_sub_users.partner_id', partnerId)
      .order('created_at', { ascending: false });

    query = this.applyPagination(query, pagination);
    const { data, error } = await query;

    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data;
  }

  public async getStats(partnerId: string, days: number = 7, tx?: TransactionalClient) {
    const client = this.getClient(tx);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Fetch logs to aggregate stats by day
    const { data, error } = await client
      .from('webhook_logs')
      .select('created_at, response_status, partner_sub_users!inner(partner_id)')
      .eq('partner_sub_users.partner_id', partnerId)
      .gte('created_at', cutoff.toISOString());

    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);

    return data;
  }
}
