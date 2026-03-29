import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface Plan {
  id: 'trial' | 'starter' | 'business' | 'custom';
  name: string;
  message_quota: number;
  session_limit: number;
  price_monthly: number;
  price_yearly: number;
  created_at: string;
  updated_at: string;
}

export class PlansRepository extends BaseRepository {
  public async findById(id: Plan['id'], tx?: TransactionalClient): Promise<Plan> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('plans')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new AppError('INVALID_PLAN', 400, `Plan ${id} not found`);
    }

    return data as Plan;
  }

  public async listAll(tx?: TransactionalClient): Promise<Plan[]> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('plans')
      .select('*')
      .order('price_monthly', { ascending: true });

    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as Plan[];
  }

  public async upsert(plan: Partial<Plan>, tx?: TransactionalClient): Promise<Plan> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('plans')
      .upsert(plan)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Upsert plan failed');
    }

    return data as Plan;
  }
}
