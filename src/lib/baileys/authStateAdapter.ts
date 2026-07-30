import { 
  AuthenticationCreds, 
  AuthenticationState, 
  SignalDataTypeMap, 
  initAuthCreds, 
  BufferJSON 
} from '@whiskeysockets/baileys';
import { Redis } from 'ioredis';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

/**
 * Custom Baileys Auth State Adapter using Redis for hot data 
 * and Supabase as a persistent fallback/re-hydration layer.
 */
export const useBaileysAuthState = async (sessionId: string, redisClient: Redis): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
  
  const credsKey = `session:${sessionId}:creds`;
  const keysKeyPrefix = `session:${sessionId}:keys:`;

  /**
   * Helper to write creds to DB for persistence.
   * We only persist creds synchronously as they are critical for session survival.
   */
  const persistCredsToDB = async (credsData: AuthenticationCreds) => {
    try {
      const value = JSON.parse(JSON.stringify(credsData, BufferJSON.replacer));
      const { error } = await supabase.from('baileys_auth_state').upsert({
        session_id: sessionId,
        key_type: 'creds',
        key_id: 'creds',
        value,
        updated_at: new Date().toISOString()
      }, { onConflict: 'session_id, key_type, key_id' });
      
      if (error) {
        logger.error(`[Baileys Auth] Supabase creds persistence error for session ${sessionId}: ${error.message}`);
      }
    } catch (e: any) {
      logger.error(`[Baileys Auth] Failed to persist creds to Supabase for session ${sessionId}: ${e.message}`);
    }
  };

  /**
   * Load data from Redis with fallback to DB
   */
  const readData = async (type: string, id: string) => {
    const key = `${keysKeyPrefix}${type}:${id}`;
    let data = await redisClient.get(key);
    
    if (!data) {
       // Fallback logic here if needed (e.g. query DB)
       return null;
    }

    return JSON.parse(data, BufferJSON.reviver);
  };

  const writeData = async (data: any, type: string, id: string) => {
    const key = `${keysKeyPrefix}${type}:${id}`;
    const value = JSON.stringify(data, BufferJSON.replacer);
    await redisClient.set(key, value);
  };

  const removeData = async (type: string, id: string) => {
    const key = `${keysKeyPrefix}${type}:${id}`;
    await redisClient.del(key);
  };

  // 1. Initial Creds Loading
  let creds: AuthenticationCreds;
  const existingCreds = await redisClient.get(credsKey);
  
  if (existingCreds) {
    creds = JSON.parse(existingCreds, BufferJSON.reviver);
  } else {
    // Try re-hydrating from DB here if Redis was flushed
    try {
      const { data: dbState, error } = await supabase
        .from('baileys_auth_state')
        .select('value')
        .eq('session_id', sessionId)
        .eq('key_type', 'creds')
        .eq('key_id', 'creds')
        .single();
        
      if (!error && dbState?.value) {
        logger.info(`[Baileys Auth] Re-hydrating creds from DB for session ${sessionId}`);
        // DB returns a JS object from jsonb, we need to stringify it to pass it through reviver
        creds = JSON.parse(JSON.stringify(dbState.value), BufferJSON.reviver);
        await redisClient.set(credsKey, JSON.stringify(creds, BufferJSON.replacer));
      } else {
        creds = initAuthCreds();
      }
    } catch (e: any) {
      logger.error(`[Baileys Auth] DB re-hydration failed for session ${sessionId}, starting fresh: ${e.message}`);
      creds = initAuthCreds();
    }
  }

  const saveCreds = async () => {
    await redisClient.set(credsKey, JSON.stringify(creds, BufferJSON.replacer));
    await persistCredsToDB(creds);
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(type, id);
              if (type === 'app-state-sync-key' && value) {
                value = BufferJSON.reviver(type, value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data: any) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in (data as any)[category]) {
              const value = (data as any)[category][id];
              if (value) {
                tasks.push(writeData(value, category, id));
              } else {
                tasks.push(removeData(category, id));
              }
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds
  };
};
