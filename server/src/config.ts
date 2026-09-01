import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().min(1).refine((value) => value.split(',').every((entry) => { try { new URL(entry.trim()); return true; } catch { return false; } }), 'Each APP_URL value must be a valid URL').default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  OTP_TTL_MINUTES: z.coerce.number().int().min(2).max(30).default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
  INBOUND_API_KEY: z.string().min(20).optional(),
  WEBHOOK_SECRET: z.string().min(20).optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  META_APP_SECRET: z.string().min(20).optional(),
  GOOGLE_ADS_WEBHOOK_SECRET: z.string().min(20).optional(),
  NETCORE_WEBHOOK_SECRET: z.string().min(20).optional(),
  SCHEDULER_ENABLED: z.string().transform((value) => value === 'true').default('true'),
  SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  SCHEDULER_STALE_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  GLOBAL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(10000).default(600),
  AUTH_RATE_LIMIT_PER_15_MINUTES: z.coerce.number().int().min(3).max(1000).default(20),
  PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(5000).default(120),
  PROCESS_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(5000).default(300),
  MAX_QUERY_ROWS: z.coerce.number().int().min(10).max(5000).default(500),
  MAX_FLEXIBLE_SCAN_ROWS: z.coerce.number().int().min(100).max(50000).default(5000),
  ALLOW_PRIVATE_PARTNER_URLS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  ALLOW_HTTP_PARTNER_URLS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  AI_MODE: z.enum(['rules', 'openai_compatible']).default('rules'),
  AI_API_URL: z.string().url().default('https://api.openai.com/v1'),
  AI_API_KEY: z.string().min(20).optional(),
  AI_MODEL: z.string().min(1).default('configure-model-name'),
  AI_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(120).default(30),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(1000).max(100000).default(20000),
  AWS_REGION: z.string().default('ap-south-1'),
  SES_FROM_EMAIL: z.string().email().optional(),
  STORAGE_PROVIDER: z.enum(['s3', 'r2']).default('s3'),
  STORAGE_BUCKET: z.string().default('crm-dc'),
  STORAGE_REGION: z.string().default('ap-south-1'),
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_PUBLIC_BASE_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
  throw new Error(`Invalid server environment: ${details}`);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === 'production';

if (isProduction) {
  const placeholder = /change-me|replace-me|example-secret|development|configure/i;
  const appUrls = config.APP_URL.split(',').map((value) => value.trim());
  if (appUrls.some((value) => new URL(value).protocol !== 'https:')) throw new Error('Invalid server environment: production APP_URL values must use HTTPS');
  if (config.JWT_SECRET.length < 48 || placeholder.test(config.JWT_SECRET)) throw new Error('Invalid server environment: production JWT_SECRET must be at least 48 characters and not a placeholder');
  if (!config.SES_FROM_EMAIL) throw new Error('Invalid server environment: SES_FROM_EMAIL is required in production');
  if (config.INBOUND_API_KEY && placeholder.test(config.INBOUND_API_KEY)) throw new Error('Invalid server environment: INBOUND_API_KEY cannot be a placeholder');
  if (config.STORAGE_PUBLIC_BASE_URL) throw new Error('Invalid server environment: public storage URLs are disabled for production assets');
}
