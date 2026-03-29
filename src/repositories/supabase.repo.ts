import { supabase } from '@/lib/supabase';
import { PostgrestResponse } from '@supabase/supabase-js';

export class AuthRepository {
  public static async findUserByEmail(email: string): Promise<PostgrestResponse<any>> {
    return supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .single();
  }

  // Add more Supabase repository methods here...
}
