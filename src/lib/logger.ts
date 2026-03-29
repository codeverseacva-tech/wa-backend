import pino from 'pino';
import { config } from '@/config';

const REDACT_PATHS = [
  'password', 'key_hash', 'secret', 'authorization', '["x-api-key"]', 'phone_number',
  'req.headers.authorization', 'req.headers["x-api-key"]',
];

export const logger = pino({
  level: config.log.level,
  redact: { paths: REDACT_PATHS, remove: true },
  base: { service: 'zaplink-api' },
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: config.api.nodeEnv === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'SYS:standard',
    },
  } : undefined,
});
