import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface Webhook {
  id: string;
  user_id: string;
  url: string;
  events: string[];
  secret: string;
  is_active: boolean;
  created_at: string;
}

export class WebhooksRepository extends BaseRepository {
  public async create(webhook: Partial<Webhook>, tx?: TransactionalClient): Promise<Webhook> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('webhooks')
      .insert(webhook)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Create webhook failed');
    }

    return data as Webhook;
  }

  public async listByUser(userId: string, pagination?: Pagination, tx?: TransactionalClient): Promise<Webhook[]> {
    const client = this.getClient(tx);
    let query = client.from('webhooks')
      .select('*')
      .eq('user_id', userId);

    query = this.applyPagination(query, pagination);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as Webhook[];
  }

  public async update(id: string, updates: Partial<Webhook>, tx?: TransactionalClient): Promise<Webhook> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('webhooks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Update webhook failed');
    }

    return data as Webhook;
  }
}
