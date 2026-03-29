import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface Group {
  id: string;
  user_id: string;
  session_id: string;
  group_jid: string;
  name: string;
  participant_count: number;
  description?: string;
  created_at: string;
  updated_at: string;
}

export class GroupsRepository extends BaseRepository {
  public async upsert(group: Partial<Group>, tx?: TransactionalClient): Promise<Group> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('groups')
      .upsert(group, { onConflict: 'group_jid' })
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Upsert group failed');
    }

    return data as Group;
  }

  public async findByJid(jid: string, tx?: TransactionalClient): Promise<Group> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('groups')
      .select('*')
      .eq('group_jid', jid)
      .single();

    if (error || !data) {
      throw new AppError('NOT_FOUND', 404, `Group ${jid} not found`);
    }

    return data as Group;
  }

  public async listBySession(sessionId: string, pagination?: Pagination, tx?: TransactionalClient): Promise<Group[]> {
    const client = this.getClient(tx);
    let query = client.from('groups')
      .select('*')
      .eq('session_id', sessionId);

    query = this.applyPagination(query, pagination);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as Group[];
  }
}
