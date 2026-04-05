import pino from 'pino';
import { config } from '@/config';

const REDACT_PATHS = [
  'password', 'key_hash', 'secret', 'authorization', '["x-api-key"]', 'phone_number',
  'req.headers.authorization', 'req.headers["x-api-key"]',
];

export const logger = pino({
  level: config.log.level,
  redact: { paths: REDACT_PATHS, remove: true },
  base: undefined, // Remove service, pid, hostname from being added to every log
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: false, // Disable JSON timestamp for cleaner output
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname,time', // Hide pid, hostname, and time for the requested simple look
      levelFirst: true,
    },
  },
});
