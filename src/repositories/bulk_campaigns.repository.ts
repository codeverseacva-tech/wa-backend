import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface BulkCampaign {
  id: string;
  user_id: string;
  session_id: string;
  name: string;
  status: 'draft' | 'pending' | 'processing' | 'completed' | 'failed' | 'paused' | 'cancelled';
  message_template: any;
  recipients: any;
  settings: any;
  processed_count: number;
  total_count: number;
  created_at: string;
  updated_at: string;
}

export class BulkCampaignsRepository extends BaseRepository {
  public async create(campaign: Partial<BulkCampaign>, tx?: TransactionalClient): Promise<BulkCampaign> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('bulk_campaigns')
      .insert(campaign)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Create campaign failed');
    }

    return data as BulkCampaign;
  }

  public async updateProgress(id: string, processedCount: number, status?: BulkCampaign['status'], tx?: TransactionalClient): Promise<BulkCampaign> {
    const client = this.getClient(tx);
    const updates: Partial<BulkCampaign> = { processed_count: processedCount };
    if (status) updates.status = status;

    const { data, error } = await client
      .from('bulk_campaigns')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Update campaign progress failed');
    }

    return data as BulkCampaign;
  }

  public async listByUser(userId: string, pagination?: Pagination, tx?: TransactionalClient): Promise<BulkCampaign[]> {
    const client = this.getClient(tx);
    let query = client.from('bulk_campaigns')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    query = this.applyPagination(query, pagination);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as BulkCampaign[];
  }
}
