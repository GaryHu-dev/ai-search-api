import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/core/bootstrap/configure-app';
import { Env } from '../../src/core/config/env.validation';

// Requires object storage (MinIO) to be running and configured. When it isn't
// (e.g. a CI job without STORAGE_* set), the whole suite is skipped rather than
// failing — the feature is exercised locally via `pnpm db:up` + MinIO.
const storageConfigured = Boolean(
  process.env.STORAGE_BUCKET && process.env.STORAGE_ENDPOINT,
);
const describeStorage = storageConfigured ? describe : describe.skip;

describeStorage('Files (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let accessToken = '';

  const email = `${randomUUID()}@files.test`;
  const password = 'files-secret-pw';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();
    server = app.getHttpServer() as Server;

    const registered = await request(server)
      .post('/v1/auth/register')
      .send({ email, password });
    accessToken = registered.body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('uploads, lists, downloads, and deletes a file (round-trip through storage)', async () => {
    const contents = 'hello storage world';

    const uploaded = await request(server)
      .post('/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from(contents), {
        filename: 'note.txt',
        contentType: 'text/plain',
      });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.filename).toBe('note.txt');
    const fileId = uploaded.body.data.id;

    const listed = await request(server)
      .get('/v1/files')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items.map((f: { id: string }) => f.id)).toContain(
      fileId,
    );
    expect(listed.body.data).toHaveProperty('nextCursor');

    const downloaded = await request(server)
      .get(`/v1/files/${fileId}/download`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(downloaded.status).toBe(200);
    const body =
      downloaded.text ||
      (Buffer.isBuffer(downloaded.body) ? downloaded.body.toString() : '');
    expect(body).toContain(contents);

    const removed = await request(server)
      .delete(`/v1/files/${fileId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(removed.status).toBe(204);

    const missing = await request(server)
      .get(`/v1/files/${fileId}/download`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(missing.status).toBe(404);
  });

  it('filters the list by search (filename)', async () => {
    const marker = randomUUID().slice(0, 8);
    await request(server)
      .post('/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('x'), { filename: `report-${marker}.txt` });
    await request(server)
      .post('/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('y'), { filename: 'unrelated.txt' });

    const res = await request(server)
      .get(`/v1/files?search=report-${marker}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const names = res.body.data.items.map(
      (f: { filename: string }) => f.filename,
    );
    expect(names).toContain(`report-${marker}.txt`);
    expect(names).not.toContain('unrelated.txt');
  });

  it('rejects an upload larger than the size limit with 413', async () => {
    const oversize = Buffer.alloc(11 * 1024 * 1024); // > 10 MB default limit
    const res = await request(server)
      .post('/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', oversize, { filename: 'big.bin' });
    expect(res.status).toBe(413);
  });

  it('sets a safe Content-Disposition on download (sanitised, RFC 5987)', async () => {
    const uploaded = await request(server)
      .post('/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('x'), { filename: 'report.txt' });
    expect(uploaded.status).toBe(201);

    const res = await request(server)
      .get(`/v1/files/${uploaded.body.data.id}/download`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    // The header is built by attachmentDisposition (quote/newline handling is
    // unit-tested); here we just confirm the RFC 5987 form reaches the client.
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''");
  });

  it('rejects an unauthenticated upload', async () => {
    const res = await request(server)
      .post('/v1/files')
      .attach('file', Buffer.from('x'), { filename: 'x.txt' });
    expect(res.status).toBe(401);
  });

  // The core promise of automatic tenant isolation: one tenant can never see or
  // touch another tenant's files, even when it knows the exact id.
  it("isolates one tenant's files from another", async () => {
    // Tenant A (from beforeAll) uploads a file.
    const uploaded = await request(server)
      .post('/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('tenant A secret'), {
        filename: 'secret.txt',
        contentType: 'text/plain',
      });
    expect(uploaded.status).toBe(201);
    const fileId = uploaded.body.data.id;

    // Tenant B is a brand-new account (separate tenant).
    const tokenB = (
      await request(server)
        .post('/v1/auth/register')
        .send({ email: `${randomUUID()}@files.test`, password })
    ).body.data.accessToken;

    // B's listing must not contain A's file...
    const listedByB = await request(server)
      .get('/v1/files')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(
      listedByB.body.data.items.map((f: { id: string }) => f.id),
    ).not.toContain(fileId);

    // ...and B cannot reach it by id, for download or delete.
    const downloadByB = await request(server)
      .get(`/v1/files/${fileId}/download`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(downloadByB.status).toBe(404);

    const deleteByB = await request(server)
      .delete(`/v1/files/${fileId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(deleteByB.status).toBe(404);

    // A still sees and can fetch its own file.
    const downloadByA = await request(server)
      .get(`/v1/files/${fileId}/download`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(downloadByA.status).toBe(200);
  });
});
