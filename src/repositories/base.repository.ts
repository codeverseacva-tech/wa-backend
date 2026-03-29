import { SupabaseClient, PostgrestResponse, PostgrestSingleResponse } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type TransactionalClient = SupabaseClient; // Could be extended if using raw pg

export interface Pagination {
  limit: number;
  offset: number;
}

export abstract class BaseRepository {
  protected getClient(tx?: TransactionalClient): TransactionalClient {
    return tx || supabase;
  }

  protected async handleResponse<T>(response: PostgrestResponse<T> | PostgrestSingleResponse<T>): Promise<T> {
    if (response.error) {
      throw new AppError('DATABASE_ERROR', 500, response.error.message);
    }
    return response.data as T;
  }

  protected applyPagination<T>(query: any, pagination?: Pagination) {
    if (pagination) {
      const { limit, offset } = pagination;
      return query.range(offset, offset + limit - 1);
    }
    return query;
  }

  /**
   * For Supabase, ACID transactions across tables are typically handled via:
   * 1. Supabase RPC (Postgres functions)
   * 2. Sequential calls (Not atomic on server-side unless using a custom PG client)
   * 
   * This helper is a placeholder for how you might orchestrate complex operations.
   */
  public async runInTransaction<T>(fn: (tx: TransactionalClient) => Promise<T>): Promise<T> {
    // Note: Standard Supabase JS client doesn't support 'atomic' transactions 
    // across multiple await calls easily without RPC.
    // However, we follow the pattern to allow passing the client.
    return fn(supabase);
  }
}
