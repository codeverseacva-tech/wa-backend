import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface SubUser {
  id: string;
  partner_id: string;
  external_user_id: string;
  display_name?: string;
  api_key_id: string;
  webhook_secret: string;
  webhook_url_suffix: string;
  session_id?: string;
  status: 'active' | 'suspended';
  created_at: string;
  updated_at: string;
  // Join fields
  apiKeyPrefix?: string;
  whatsappStatus?: string;
  fullWebhookUrl?: string;
}

export class SubUsersRepository extends BaseRepository {
  public async create(subUser: Partial<SubUser>, tx?: TransactionalClient): Promise<SubUser> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('partner_sub_users')
      .insert(subUser)
      .select(`
        *,
        partners!partner_id (base_webhook_url)
      `)
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Create sub-user failed');
    }

    return this.enrichSubUser(data);
  }

  public async listByPartner(partnerId: string, options?: { status?: string } & Pagination, tx?: TransactionalClient): Promise<SubUser[]> {
    const client = this.getClient(tx);
    let query = client
      .from('partner_sub_users')
      .select(`
        *,
        api_keys!api_key_id (key_prefix),
        whatsapp_sessions!session_id (status),
        partners!partner_id (base_webhook_url)
      `)
      .eq('partner_id', partnerId);

    if (options?.status && options.status !== 'all') {
      query = query.eq('status', options.status);
    }

    query = this.applyPagination(query, options);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);

    return data.map(d => this.enrichSubUser(d));
  }

  public async findByExternalId(partnerId: string, externalUserId: string, tx?: TransactionalClient): Promise<SubUser> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('partner_sub_users')
      .select(`
        *,
        api_keys!api_key_id (key_prefix),
        whatsapp_sessions!session_id (status),
        partners!partner_id (base_webhook_url)
      `)
      .eq('partner_id', partnerId)
      .eq('external_user_id', externalUserId)
      .maybeSingle();

    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    if (!data) throw new AppError('NOT_FOUND', 404, 'Sub-user not found');

    return this.enrichSubUser(data);
  }

  public async update(id: string, updates: Partial<SubUser>, tx?: TransactionalClient): Promise<SubUser> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('partner_sub_users')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        partners!partner_id (base_webhook_url)
      `)
      .single();

    if (error || !data) throw new AppError('DATABASE_ERROR', 500, error?.message || 'Update failed');

    return this.enrichSubUser(data);
  }

  public async deactivate(partnerId: string, externalUserId: string, tx?: TransactionalClient): Promise<void> {
    const client = this.getClient(tx);
    const { error } = await client
      .from('partner_sub_users')
      .update({ status: 'suspended' })
      .eq('partner_id', partnerId)
      .eq('external_user_id', externalUserId);

    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
  }

  public async reactivate(partnerId: string, externalUserId: string, tx?: TransactionalClient): Promise<void> {
    const client = this.getClient(tx);
    const { error } = await client
      .from('partner_sub_users')
      .update({ status: 'active' })
      .eq('partner_id', partnerId)
      .eq('external_user_id', externalUserId);

    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
  }

  private enrichSubUser(data: any): SubUser {
    const base = data.partners?.base_webhook_url || '';
    const suffix = data.webhook_url_suffix || '';
    
    return {
      ...data,
      id: data.id, 
      display_name: data.display_name,
      apiKeyPrefix: data.api_keys?.key_prefix,
      whatsappStatus: data.whatsapp_sessions?.status || null,
      fullWebhookUrl: base ? `${base.replace(/\/$/, '')}/${suffix}` : suffix
    };
  }
}
