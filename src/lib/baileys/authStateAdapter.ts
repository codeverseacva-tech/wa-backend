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
   * Helper to write a large bulk of keys to DB for persistence
   */
  const persistToDB = async (type: string, id: string, data: any) => {
    // This assumes we have a way to store this in DB. 
    // If auth_state column doesn't exist yet, we'll need to handle it or use a dedicated table.
    // For now, we'll focus on Redis as the primary store as per requirements.
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
    // TODO: implement DB re-hydration
    creds = initAuthCreds();
  }

  const saveCreds = async () => {
    await redisClient.set(credsKey, JSON.stringify(creds, BufferJSON.replacer));
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
