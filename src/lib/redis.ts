import Redis from 'ioredis';
import { config } from '@/config';
import { logger } from './logger';

const redisConfig = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null, // Critical for BullMQ
};

import { slack } from './slack';

export const redis = new Redis(redisConfig);

redis.on('connect', () => logger.info('🚀 Redis connected'));
redis.on('error', (err) => {
  logger.error('❌ Redis error:', err);
  slack.sendAlert('critical', 'Redis Connection Lost', err.message);
});
