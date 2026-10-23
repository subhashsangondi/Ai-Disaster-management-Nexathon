const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const isTest = process.env.NODE_ENV === 'test';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_SSL: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),
  SOS_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  SOS_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  PUBLIC_TRACK_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  PUBLIC_TRACK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  DUPLICATE_LOOKBACK_HOURS: z.coerce.number().positive().default(24),
  DUPLICATE_RADIUS_KM: z.coerce.number().positive().default(10),
});

const parsed = envSchema.safeParse({
  ...process.env,
  JWT_SECRET: process.env.JWT_SECRET || (isTest ? 'test-only-jwt-secret-that-is-long-enough' : undefined),
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${issues}`);
}

const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
};

module.exports = env;
