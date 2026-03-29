import 'dotenv/config';
import { initTelemetry } from '@/lib/telemetry';
import { logger } from '@/lib/logger';
import { config } from '@/config';
import app from './app';
import { sessionManager } from '@/lib/baileys/sessionManager';
import '@/workers'; // Register BullMQ workers

const PORT = config.api.port;

const startServer = async () => {
  try {
    // 1. Initialise telemetry
    initTelemetry();

    // 2. Start Express app and re-hydrate sessions
    const server = app.listen(PORT, async () => {
      logger.info(`🚀 Server running on port ${PORT} (${config.api.nodeEnv})`);
      logger.info(`🔗 API Base URL: ${config.api.baseUrl}/${config.api.version}`);

      // Re-hydrate active WhatsApp sessions from DB
      try {
        await sessionManager.rehydrateSessions();
      } catch (err) {
        logger.error({ err }, 'Failed to rehydrate sessions during startup');
      }
    });

  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
};

void startServer();
