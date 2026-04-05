import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface Profile {
  id: string;
  role: 'user' | 'super_admin' | 'partner';
  plan_id: 'trial' | 'starter' | 'business' | 'custom';
  is_suspended: boolean;
  full_name?: string;
  created_at: string;
  updated_at: string;
}

export class ProfilesRepository extends BaseRepository {
  public async findById(id: string, tx?: TransactionalClient): Promise<Profile> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      // PGRST116 is "The result contains 0 rows"
      if (error?.code === 'PGRST116' || !data) {
        // Create a default profile if it doesn't exist (fallback for missing trigger)
        const { data: newData, error: insertError } = await client
          .from('profiles')
          .insert({
            id,
            role: 'user',
            plan_id: 'trial',
            full_name: 'User',
          })
          .select()
          .single();

        if (insertError) {
          throw new AppError('DATABASE_ERROR', 500, `Failed to create fallback profile: ${insertError.message}`);
        }
        return newData as Profile;
      }
      throw new AppError('NOT_FOUND', 404, `Profile with ID ${id} not found`);
    }

    return data as Profile;
  }

  public async update(id: string, updates: Partial<Profile>, tx?: TransactionalClient): Promise<Profile> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Update failed');
    }

    return data as Profile;
  }

  public async list(pagination?: Pagination, tx?: TransactionalClient): Promise<Profile[]> {
    const client = this.getClient(tx);
    let query = client.from('profiles').select('*');
    query = this.applyPagination(query, pagination);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as Profile[];
  }

  /**
   * Atomic plan upgrade via Supabase RPC.
   */
  public async upgradeUserPlan(
    userId: string, 
    planId: Profile['plan_id'], 
    expiresAt: string, 
    invoiceId?: string,
    tx?: TransactionalClient
  ): Promise<void> {
    const client = this.getClient(tx);
    const { error } = await client.rpc('upgrade_user_plan', {
      p_user_id: userId,
      p_plan_id: planId,
      p_expires_at: expiresAt,
      p_invoice_id: invoiceId
    });

    if (error) {
      throw new AppError('DATABASE_ERROR', 500, `RPC Error: ${error.message}`);
    }
  }
}
