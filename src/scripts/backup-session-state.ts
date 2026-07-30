import { redis } from '@/lib/redis';
import { supabase } from '@/lib/supabase';
import { BufferJSON } from '@whiskeysockets/baileys';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const MAX_BACKUPS = 20;

async function run() {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });

    // 1. Fetch authenticated sessions from Supabase
    const { data: activeSessions, error } = await supabase
      .from('whatsapp_sessions')
      .select('session_id')
      .eq('status', 'authenticated');

    if (error) {
      throw new Error(`Failed to fetch sessions from Supabase: ${error.message}`);
    }

    const activeSessionIds = activeSessions?.map(s => s.session_id) || [];
    console.log(`[Backup] Found ${activeSessionIds.length} authenticated sessions in Supabase.`);

    // 2. Fetch all keys from Redis
    const credsKeys = await redis.keys('session:*:creds');
    const keysKeys = await redis.keys('session:*:keys:*');
    
    if (activeSessionIds.length > 0 && credsKeys.length === 0) {
      console.error(`[Backup] ERROR: Supabase shows ${activeSessionIds.length} active sessions, but 0 session keys found in Redis. Aborting.`);
      process.exit(1);
    }

    const allKeys = [...credsKeys, ...keysKeys];
    if (allKeys.length === 0) {
      console.log('[Backup] No session keys found in Redis. Nothing to backup.');
      process.exit(0);
    }

    // 3. Process and format keys
    // We expect values to be JSON strings serialized with BufferJSON.replacer
    // We will parse them, and then re-stringify the whole backup object with BufferJSON.replacer
    const backupData: any = {};
    const foundCredsSessions = new Set<string>();

    for (const key of allKeys) {
      const type = await redis.type(key);
      if (type === 'string') {
        const rawValue = await redis.get(key);
        if (rawValue) {
          try {
            backupData[key] = JSON.parse(rawValue, BufferJSON.reviver);
            
            // Track creds keys to cross-reference
            const match = key.match(/^session:([^:]+):creds$/);
            if (match) {
              foundCredsSessions.add(match[1]);
            }
          } catch (e) {
            console.error(`[Backup] Warning: Failed to parse JSON for key ${key}`, e);
            // Fallback: just store as raw string
            backupData[key] = rawValue;
          }
        }
      }
    }

    // 4. Cross-reference
    for (const sessionId of activeSessionIds) {
      if (!foundCredsSessions.has(sessionId)) {
        console.warn(`[Backup] WARNING: Supabase active session ${sessionId} is missing its Redis 'creds' key. Rehydration may fail!`);
      }
    }

    // 5. Save to file
    const gitSha = (() => {
      try {
        return execSync('git rev-parse --short HEAD').toString().trim();
      } catch (e) {
        return 'unknown';
      }
    })();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${gitSha}-${timestamp}.json`;
    const filepath = path.join(BACKUP_DIR, filename);

    // Re-serialize the entire object properly
    await fs.writeFile(filepath, JSON.stringify(backupData, BufferJSON.replacer, 2), 'utf-8');
    console.log(`[Backup] Completed successfully. Saved to ${filename}`);

    // 6. Rotate old backups
    const files = await fs.readdir(BACKUP_DIR);
    const backupFiles = files
      .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
      .map(f => ({ name: f, time: fs.stat(path.join(BACKUP_DIR, f)).then(s => s.mtime.getTime()) }));

    const resolvedFiles = await Promise.all(
      backupFiles.map(async f => ({ name: f.name, time: await f.time }))
    );
    resolvedFiles.sort((a, b) => b.time - a.time);

    if (resolvedFiles.length > MAX_BACKUPS) {
      const toDelete = resolvedFiles.slice(MAX_BACKUPS);
      for (const f of toDelete) {
        await fs.unlink(path.join(BACKUP_DIR, f.name));
        console.log(`[Backup] Rotated old backup: ${f.name}`);
      }
    }

  } catch (error) {
    console.error('[Backup] Fatal error:', error);
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

run();
