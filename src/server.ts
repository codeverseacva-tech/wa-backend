import 'dotenv/config';
import { initTelemetry } from '@/lib/telemetry';
import { logger } from '@/lib/logger';
import { config } from '@/config';
import app from './app';
import { sessionManager } from '@/lib/baileys/sessionManager';
import { runMigrations } from '@/lib/migrationRunner';
import '@/workers'; // Register BullMQ workers

const PORT = config.api.port;

// 1. Initialise telemetry immediately
initTelemetry();

const startServer = async () => {
  try {
    // 2. Auto-run migrations in development
    if (config.api.nodeEnv !== 'production') {
      try {
        await runMigrations();
      } catch (err) {
        logger.error({ err }, 'Failed to run migrations during startup');
      }
    }

    // 3. Start Express app and re-hydrate sessions
    app.listen(PORT, async () => {
      logger.info(`🚀 Server running on port ${PORT} (${config.api.nodeEnv})`);

      // Re-hydrate active WhatsApp sessions from DB if allowed
      if (config.session.rehydrateOnStart) {
        try {
          await sessionManager.rehydrateSessions();
        } catch (err) {
          logger.error({ err }, 'Failed to rehydrate sessions during startup');
        }
      }
    });

  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
};

void startServer();
