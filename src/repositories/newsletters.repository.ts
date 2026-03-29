import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface Newsletter {
  id: string;
  user_id: string;
  session_id: string;
  newsletter_jid: string;
  name: string;
  description?: string;
  subscriber_count: number;
  is_owner: boolean;
  created_at: string;
  updated_at: string;
}

export class NewslettersRepository extends BaseRepository {
  public async upsert(newsletter: Partial<Newsletter>, tx?: TransactionalClient): Promise<Newsletter> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('newsletters')
      .upsert(newsletter, { onConflict: 'newsletter_jid' })
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Upsert newsletter failed');
    }

    return data as Newsletter;
  }

  public async findByJid(jid: string, tx?: TransactionalClient): Promise<Newsletter> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('newsletters')
      .select('*')
      .eq('newsletter_jid', jid)
      .single();

    if (error || !data) {
      throw new AppError('NOT_FOUND', 404, `Newsletter ${jid} not found`);
    }

    return data as Newsletter;
  }

  public async listBySession(sessionId: string, pagination?: Pagination, tx?: TransactionalClient): Promise<Newsletter[]> {
    const client = this.getClient(tx);
    let query = client.from('newsletters')
      .select('*')
      .eq('session_id', sessionId);

    query = this.applyPagination(query, pagination);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as Newsletter[];
  }
}
