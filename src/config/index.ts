import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_BASE_URL: z.string().min(1),
  API_VERSION: z.string().default('v1'),
  FRONTEND_URL: z.string().min(1),
  CORS_ALLOWED_ORIGINS: z.string().transform((val) => val.split(',')),
  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  SUPABASE_URL: z.string().min(1),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  DATABASE_URL: z.string(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SLACK_WEBHOOK_URL: z.string().min(1).optional(),
  METRICS_PORT: z.coerce.number().default(9090),
  METRICS_SECRET: z.string().optional(),
  IS_DOCS_PUBLIC: z.string().transform((v) => v === 'true').default('false'),
  TUMA_EMAIL: z.string().email(),
  TUMA_API_KEY: z.string(),
  TUMA_CALLBACK_URL: z.string().min(1),
  REHYDRATE_SESSIONS: z.string().transform((v) => v !== 'false').default('true'),
  AUTO_MIGRATE: z.string().transform((v) => v === 'true').default('false'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

const env = parsed.data;

export const config = {
  api: {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    baseUrl: env.API_BASE_URL,
    version: env.API_VERSION,
  },
  session: {
    rehydrateOnStart: env.REHYDRATE_SESSIONS,
  },
  database: {
    autoMigrate: env.AUTO_MIGRATE,
  },
  cors: {
    allowedOrigins: env.CORS_ALLOWED_ORIGINS,
    frontendUrl: env.FRONTEND_URL,
  },
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
  },
  supabase: {
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: env.SUPABASE_JWT_SECRET,
    databaseUrl: env.DATABASE_URL,
  },
  log: {
    level: env.LOG_LEVEL,
  },
  slack: {
    webhookUrl: env.SLACK_WEBHOOK_URL,
  },
  metrics: {
    port: env.METRICS_PORT,
    secret: env.METRICS_SECRET,
  },
  docs: {
    isPublic: env.IS_DOCS_PUBLIC,
  },
  tuma: {
    email: env.TUMA_EMAIL,
    apiKey: env.TUMA_API_KEY,
    callbackUrl: env.TUMA_CALLBACK_URL,
  },
} as const;

export type Config = typeof config;
