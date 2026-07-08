import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { configureCors } from './cors.setup';
import { configureSecurity } from './security.setup';
import { configureValidation } from './validation.setup';
import { configureVersioning } from './versioning.setup';

// The request-handling setup shared by the running server (main.ts) and the
// e2e tests, so tests exercise the exact same pipeline as production. Swagger
// and listen() stay in main.ts — they aren't relevant to tests.
export function configureApp(
  app: INestApplication,
  config: ConfigService<Env, true>,
): void {
  configureSecurity(app, config);
  configureCors(app, config);
  configureVersioning(app);
  configureValidation(app);
}
