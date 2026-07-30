import { redis } from '@/lib/redis';
import { BufferJSON } from '@whiskeysockets/baileys';
import * as fs from 'fs/promises';
import * as path from 'path';

const BACKUP_DIR = path.join(process.cwd(), 'backups');

async function run() {
  const filename = process.argv[2];
  if (!filename) {
    console.error('Usage: tsx restore-session-state.ts <backup-filename.json> [sessionId]');
    process.exit(1);
  }

  const targetSessionId = process.argv[3]; // optional
  const filepath = path.join(BACKUP_DIR, filename);

  try {
    const rawData = await fs.readFile(filepath, 'utf-8');
    const backupData = JSON.parse(rawData, BufferJSON.reviver);
    
    let restoredCount = 0;
    
    for (const [key, value] of Object.entries(backupData)) {
      if (targetSessionId && !key.includes(`session:${targetSessionId}:`)) {
        continue;
      }

      // value is a JS object (thanks to reviver). 
      // authStateAdapter expects it to be stringified with replacer in Redis
      const stringifiedValue = JSON.stringify(value, BufferJSON.replacer);
      await redis.set(key, stringifiedValue);
      restoredCount++;
    }

    console.log(`[Restore] Successfully restored ${restoredCount} keys from ${filename}.`);
  } catch (error) {
    console.error('[Restore] Fatal error:', error);
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

run();
