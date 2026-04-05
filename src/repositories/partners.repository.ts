import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface Partner {
  id: string;
  partner_name: string;
  contact_email?: string;
  master_api_key_id: string;
  base_webhook_url: string;
  status: 'active' | 'suspended';
  created_at: string;
  updated_at: string;
  sub_user_count?: number;
}

export class PartnersRepository extends BaseRepository {
  public async create(partner: Partial<Partner>, tx?: TransactionalClient): Promise<Partner> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('partners')
      .insert(partner)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Create partner failed');
    }

    return data as Partner;
  }

  public async list(pagination?: Pagination, tx?: TransactionalClient): Promise<Partner[]> {
    const client = this.getClient(tx);
    // Use an RPC or a complex query to get sub_user_count if needed, 
    // but for now, we'll fetch partners and their sub_user counts separately or join.
    // Supabase allows counting via .select('*, partner_sub_users(count)')
    let query = client
      .from('partners')
      .select(`
        *,
        partner_sub_users!partner_id (count)
      `);

    query = this.applyPagination(query, pagination);
    const { data, error } = await query;

    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);

    return data.map((p: any) => ({
      ...p,
      sub_user_count: p.partner_sub_users?.[0]?.count || 0
    })) as Partner[];
  }

  public async findById(id: string, tx?: TransactionalClient): Promise<Partner> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('partners')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new AppError('NOT_FOUND', 404, 'Partner not found');
    }

    return data as Partner;
  }

  public async update(id: string, updates: Partial<Partner>, tx?: TransactionalClient): Promise<Partner> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('partners')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Update partner failed');
    }

    return data as Partner;
  }

  public async suspend(id: string, tx?: TransactionalClient): Promise<void> {
    const client = this.getClient(tx);
    const { error } = await client
      .from('partners')
      .update({ status: 'suspended' })
      .eq('id', id);

    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
  }

  public async findByMasterKeyId(masterKeyId: string, tx?: TransactionalClient): Promise<Partner> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('partners')
      .select('*')
      .eq('master_api_key_id', masterKeyId)
      .single();

    if (error || !data) {
      throw new AppError('FORBIDDEN', 403, 'Partner context not found for this API Key');
    }

    return data as Partner;
  }

  public async findByUserId(userId: string, tx?: TransactionalClient): Promise<Partner | null> {
    const client = this.getClient(tx);
    // Join with api_keys to find which partner record is owned by this user
    const { data, error } = await client
      .from('partners')
      .select('*, api_keys!master_api_key_id!inner (*)')
      .eq('api_keys.user_id', userId)
      .maybeSingle();

    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    if (!data) return null;

    // Remove the joined api_keys from result object if necessary
    const { api_keys, ...partner } = data as any;
    return partner as Partner;
  }
}
