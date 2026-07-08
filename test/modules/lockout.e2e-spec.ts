import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/core/bootstrap/configure-app';
import { Env } from '../../src/core/config/env.validation';

// Verifies per-account lockout end to end against a real database. Its own suite
// gets a fresh in-memory throttler, so the five attempts don't trip rate limits.
describe('Login lockout (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  const email = `${randomUUID()}@lock.test`;
  const password = 'correct-horse-battery';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();
    server = app.getHttpServer() as Server;

    await request(server).post('/v1/auth/register').send({ email, password });
  });

  afterAll(async () => {
    await app.close();
  });

  it('locks the account after the max failed attempts (default 5)', async () => {
    for (let i = 0; i < 5; i += 1) {
      const attempt = await request(server)
        .post('/v1/auth/login')
        .send({ email, password: 'wrong-password' });
      expect(attempt.status).toBe(401);
    }

    // Now locked: even the correct password is rejected with 429.
    const locked = await request(server)
      .post('/v1/auth/login')
      .send({ email, password });
    expect(locked.status).toBe(429);
  });
});
