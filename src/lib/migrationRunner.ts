import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from '@/config';
import { logger } from '@/lib/logger';

export async function runMigrations() {
  const client = new Client({
    connectionString: config.supabase.databaseUrl,
    ssl: config.api.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    logger.info('Connected to database for migrations');

    // 1. Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Read migration files
    const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
    if (!fs.existsSync(migrationsDir)) {
      logger.warn('Migrations directory not found, skipping...');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // 3. Apply migrations in order
    for (const file of files) {
      const { rows } = await client.query('SELECT id FROM _migrations WHERE name = $1', [file]);
      
      if (rows.length > 0) {
        logger.debug(`Skipping already applied migration: ${file}`);
        continue;
      }

      logger.info(`Applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info(`✅ Successfully applied: ${file}`);
      } catch (err: any) {
        await client.query('ROLLBACK');
        
        // 42710: Duplicate Object (e.g. Policy already exists)
        // 42P07: Duplicate Table (e.g. Table already exists)
        if (err.code === '42710' || err.code === '42P07') {
          logger.warn({ code: err.code, file }, 'Migration contains objects that already exist. Marking as applied.');
          await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
          continue;
        }

        logger.error({ err, file }, '❌ Migration failed');
        throw err;
      }
    }

    logger.info('All migrations processed successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to run migrations');
    throw err;
  } finally {
    await client.end();
  }
}
