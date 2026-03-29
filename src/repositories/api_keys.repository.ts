import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface APIKey {
  id: string;
  user_id: string;
  key_name: string;
  key_hash: string;
  key_prefix: string;
  permissions: string[];
  rate_limit: number;
  expires_at?: string;
  ip_whitelist: string[];
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

export class APIKeysRepository extends BaseRepository {
  public async create(apiKey: Partial<APIKey>, tx?: TransactionalClient): Promise<APIKey> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('api_keys')
      .insert(apiKey)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Create api key failed');
    }

    return data as APIKey;
  }

  public async findByHash(hash: string, tx?: TransactionalClient): Promise<APIKey> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('api_keys')
      .select('*')
      .eq('key_hash', hash)
      .single();

    if (error || !data) {
      throw new AppError('UNAUTHORIZED', 401, 'Invalid API key');
    }

    return data as APIKey;
  }

  public async listByUser(userId: string, pagination?: Pagination, tx?: TransactionalClient): Promise<APIKey[]> {
    const client = this.getClient(tx);
    let query = client.from('api_keys')
      .select('*')
      .eq('user_id', userId);

    query = this.applyPagination(query, pagination);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as APIKey[];
  }
  
  public async updateLastUsed(id: string, tx?: TransactionalClient): Promise<void> {
    const client = this.getClient(tx);
    const { error } = await client
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
  }
}
