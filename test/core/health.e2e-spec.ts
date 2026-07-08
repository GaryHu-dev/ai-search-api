import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { HealthCheckResult } from '@nestjs/terminus';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/core/bootstrap/configure-app';
import { Env } from '../../src/core/config/env.validation';

// Exercises the real HTTP stack end to end. Requires the database to be up
// (`pnpm db:up`), since bootstrapping the app opens a Prisma connection and the
// readiness probe pings it.
describe('Health (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live reports the process is up', async () => {
    const response = await request(server).get('/health/live');
    const body = response.body as HealthCheckResult;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('GET /health/ready reports the database is reachable', async () => {
    const response = await request(server).get('/health/ready');
    const body = response.body as HealthCheckResult;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.info).toHaveProperty('database');
  });
});
