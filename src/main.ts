// Must be first: starts OpenTelemetry before any instrumented library loads.
import './otel';
import './sentry';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './core/bootstrap/configure-app';
import { configureSwagger } from './core/bootstrap/swagger.setup';
import { Env } from './core/config/env.validation';

async function bootstrap(): Promise<void> {
  // bufferLogs holds early framework logs until Pino is ready to emit them.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Route all application logging through Pino so app and request logs share
  // one structured format.
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService<Env, true>);

  // Security, CORS, versioning, validation — the same setup the e2e tests apply.
  configureApp(app, config);
  configureSwagger(app, config);

  // Let Nest run onModuleDestroy hooks on SIGTERM so Prisma closes its pool.
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
