import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  OTP_TTL_MINUTES: z.coerce.number().int().min(2).max(30).default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
  INBOUND_API_KEY: z.string().min(20).optional(),
  WEBHOOK_SECRET: z.string().min(20).optional(),
  META_VERIFY_TOKEN: z.string().optional(),
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
