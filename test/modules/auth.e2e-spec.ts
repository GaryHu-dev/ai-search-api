import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/core/bootstrap/configure-app';
import { Env } from '../../src/core/config/env.validation';
import { PrismaService } from '../../src/core/prisma/prisma.service';

// Full password auth + account lifecycle against the real HTTP stack and a real
// database (`pnpm db:up`). A unique email per run keeps it repeatable.
describe('Auth & Users (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const email = `${randomUUID()}@e2e.test`;
  const password = 'sup3r-secret-pw';
  let accessToken = '';
  let refreshToken = '';
  let userId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Same setup as the running server, so tests and production can't drift.
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a new account and returns a token pair', async () => {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password, displayName: 'E2E' });

    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));

    accessToken = res.body.data.accessToken;
    refreshToken = res.body.data.refreshToken;
  });

  it('rejects registering the same email twice', async () => {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email, password });

    expect(res.status).toBe(409);
  });

  it('rejects malformed input with a 400', async () => {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
  });

  it('returns the profile for an authenticated request', async () => {
    const res = await request(server)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(email);
    userId = res.body.data.id;
  });

  it('rejects an unauthenticated request with a 401', async () => {
    const res = await request(server).get('/v1/users/me');
    expect(res.status).toBe(401);
  });

  it('rotates refresh tokens and rejects reuse of a spent one', async () => {
    const rotated = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(refreshToken);

    const reused = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken });
    expect(reused.status).toBe(401);
  });

  it('logs in with the correct password and rejects a wrong one', async () => {
    const ok = await request(server)
      .post('/v1/auth/login')
      .send({ email, password });
    expect(ok.status).toBe(200);

    const bad = await request(server)
      .post('/v1/auth/login')
      .send({ email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
  });

  it('updates the display name', async () => {
    const res = await request(server)
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Renamed');
  });

  it('soft-deletes the account and blocks further login', async () => {
    const removed = await request(server)
      .delete('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(removed.status).toBe(204);

    const login = await request(server)
      .post('/v1/auth/login')
      .send({ email, password });
    expect(login.status).toBe(401);
  });

  it('recorded audit entries for the account lifecycle', async () => {
    const actions = await prisma.auditLog.findMany({
      where: { actorUserId: userId },
      select: { action: true },
    });
    const names = actions.map((a) => a.action);

    expect(names).toContain('auth.register');
    expect(names).toContain('auth.login');
    expect(names).toContain('user.updated');
    expect(names).toContain('user.deleted');
  });
});
