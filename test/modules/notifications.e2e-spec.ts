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

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  const uid = () => `${Math.random().toString(36).slice(2)}@notif.test`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  // Register a user and return their token + ids. Each test uses a fresh user so
  // unread counts are deterministic (the suite shares one database).
  async function registerUser() {
    const email = uid();
    const token = (
      await request(server)
        .post('/v1/auth/register')
        .send({ email, password: 'password123' })
    ).body.data.accessToken as string;
    const user = await prisma.user.findFirst({ where: { email } });
    return { token, id: user!.id, tenantId: user!.tenantId };
  }

  // Seed a notification directly via the plain client (explicit tenantId +
  // userId) — the app has no "create notification" endpoint by design.
  async function seed(
    tenantId: string,
    userId: string,
    over: { readAt?: Date; type?: string; title?: string } = {},
  ) {
    return prisma.notification.create({
      data: {
        tenantId,
        userId,
        type: over.type ?? 'audit.completed',
        title: over.title ?? 'Audit complete',
        body: 'Your audit is ready.',
        data: { auditId: 'seed' },
        readAt: over.readAt ?? null,
      },
    });
  }

  it('lists, counts, and marks a notification read', async () => {
    const u = await registerUser();
    const n = await seed(u.tenantId, u.id);

    const list = await request(server)
      .get('/v1/notifications')
      .set('Authorization', `Bearer ${u.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((i: { id: string }) => i.id)).toContain(
      n.id,
    );
    expect(list.body.data).toHaveProperty('nextCursor');

    const count1 = await request(server)
      .get('/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${u.token}`);
    expect(count1.body.data.count).toBe(1);

    const read = await request(server)
      .patch(`/v1/notifications/${n.id}/read`)
      .set('Authorization', `Bearer ${u.token}`);
    expect(read.status).toBe(200);
    expect(read.body.data.readAt).not.toBeNull();

    const count2 = await request(server)
      .get('/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${u.token}`);
    expect(count2.body.data.count).toBe(0);
  });

  it('filters to unread with ?unread=true', async () => {
    const u = await registerUser();
    await seed(u.tenantId, u.id, { readAt: new Date(), title: 'old read' });
    const unread = await seed(u.tenantId, u.id, { title: 'fresh unread' });

    const res = await request(server)
      .get('/v1/notifications?unread=true')
      .set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(unread.id);
    expect(
      res.body.data.items.every(
        (i: { readAt: string | null }) => i.readAt === null,
      ),
    ).toBe(true);
  });

  it('marks all unread as read', async () => {
    const u = await registerUser();
    await seed(u.tenantId, u.id);
    await seed(u.tenantId, u.id);

    const res = await request(server)
      .post('/v1/notifications/read-all')
      .set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);

    const count = await request(server)
      .get('/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${u.token}`);
    expect(count.body.data.count).toBe(0);
  });

  it('filters by title/body with ?search=', async () => {
    const u = await registerUser();
    const match = await seed(u.tenantId, u.id, {
      title: 'Special widget audit',
    });
    await seed(u.tenantId, u.id, { title: 'unrelated' });

    const res = await request(server)
      .get('/v1/notifications?search=widget')
      .set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(match.id);
    expect(ids.length).toBe(1);
  });

  it("does not leak another user's notifications within the same tenant", async () => {
    const u = await registerUser();
    // A notification owned by a different user but in the SAME tenant.
    const foreign = await seed(u.tenantId, randomUUID(), {
      title: 'not yours',
    });

    const list = await request(server)
      .get('/v1/notifications')
      .set('Authorization', `Bearer ${u.token}`);
    expect(list.body.data.items.map((i: { id: string }) => i.id)).not.toContain(
      foreign.id,
    );

    const count = await request(server)
      .get('/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${u.token}`);
    expect(count.body.data.count).toBe(0);

    const read = await request(server)
      .patch(`/v1/notifications/${foreign.id}/read`)
      .set('Authorization', `Bearer ${u.token}`);
    expect(read.status).toBe(404);
  });

  it('rejects unauthenticated access', async () => {
    const res = await request(server).get('/v1/notifications');
    expect(res.status).toBe(401);
  });
});
