import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';

// Restrict browsers to configured origins; unset reflects the caller's origin
// (handy in development, should be locked down in production).
export function configureCors(
  app: INestApplication,
  config: ConfigService<Env, true>,
): void {
  const origins = config.get('CORS_ORIGINS', { infer: true });

  // Reflecting any origin with credentials is a development-only convenience;
  // in production an explicit allowlist is required rather than defaulting open.
  if (!origins && config.get('NODE_ENV', { infer: true }) === 'production') {
    throw new Error('CORS_ORIGINS must be set in production');
  }

  app.enableCors({
    origin: origins ? origins.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });
}
