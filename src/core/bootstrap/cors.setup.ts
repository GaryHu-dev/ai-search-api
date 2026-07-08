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
  app.enableCors({
    origin: origins ? origins.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });
}
