import 'dotenv/config';
import { runMigrations } from '../src/lib/migrationRunner';
import { logger } from '../src/lib/logger';

async function main() {
  try {
    await runMigrations();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Migration script failed');
    process.exit(1);
  }
}

main();
