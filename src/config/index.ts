import { z } from 'zod';

const configSchema = z.object({
  BOT_TOKEN: z.string({ required_error: 'Missing required environment variable: BOT_TOKEN' })
    .min(1, 'Missing required environment variable: BOT_TOKEN'),
  REDIS_URL: z.string({ required_error: 'Missing required environment variable: REDIS_URL' })
    .url('Invalid REDIS_URL format'),
  DATABASE_URL: z.string({ required_error: 'Missing required environment variable: DATABASE_URL' })
    .min(1, 'Missing required environment variable: DATABASE_URL'),
  PREDIQUE_MASTER_KEY: z.string({ required_error: 'Missing required environment variable: PREDIQUE_MASTER_KEY' })
    .length(64, 'PREDIQUE_MASTER_KEY must be a 64-character hex string'),
  PREDIQUE_MASTER_KEY_PREVIOUS: z.string().length(64, 'PREDIQUE_MASTER_KEY_PREVIOUS must be a 64-character hex string').optional(),
  TELEGRAM_ADMIN_IDS: z.string().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  ALLOW_DEMO_AUTH: z.enum(['true', 'false']).optional(),
  CORS_ORIGINS: z.string().optional(),
  ADMIN_TOKEN: z.string().min(32, 'ADMIN_TOKEN must be at least 32 characters').optional()
});

export function requireJwtSecret(value: string | undefined): string {
  if (!value || value.length < 32) {
    throw new Error('Missing or weak JWT_SECRET: set a >=32 character JWT_SECRET env variable (no fallback)');
  }
  return value;
}

export function requireMasterKey(value: string | undefined, nodeEnv?: string): string {
  if (!value || value.length !== 64) {
    throw new Error('Missing PREDIQUE_MASTER_KEY: set a 64-character hex string (openssl rand -hex 32)');
  }
  if (nodeEnv === 'production' && value.toLowerCase() === '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef') {
    throw new Error('Refusing to start with example PREDIQUE_MASTER_KEY in production');
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined>) {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(result.error.errors.map(e => e.message).join(', '));
  }
  const corsOrigins = (result.data.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const telegramAdminIds = (result.data.TELEGRAM_ADMIN_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return {
    botToken: result.data.BOT_TOKEN,
    redisUrl: result.data.REDIS_URL,
    databaseUrl: result.data.DATABASE_URL,
    masterKeyHex: result.data.PREDIQUE_MASTER_KEY,
    previousMasterKeyHex: result.data.PREDIQUE_MASTER_KEY_PREVIOUS,
    telegramAdminIds,
    jwtSecret: result.data.JWT_SECRET,
    allowDemoAuth: result.data.ALLOW_DEMO_AUTH === 'true',
    corsOrigins,
    adminToken: result.data.ADMIN_TOKEN
  };
}
