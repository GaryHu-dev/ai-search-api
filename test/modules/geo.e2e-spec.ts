import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/core/bootstrap/configure-app';
import { Env } from '../../src/core/config/env.validation';
import { PageFetcher } from '../../src/modules/geo/page-fetcher';

// The e2e exercises the async orchestration (enqueue -> worker -> checks ->
// persist -> poll), tenant isolation, and the FAILED path. The real HTTP fetch
// is covered by page-fetcher.spec, so here PageFetcher is stubbed — which also
// avoids the SSRF guard blocking the loopback address a live fixture would use.
const FAIL_URL = 'https://unfetchable.test/';

const fetcherStub: Pick<PageFetcher, 'fetch'> = {
  fetch: (url: string) => {
    if (url === FAIL_URL) return Promise.reject(new Error('boom'));
    return Promise.resolve({
      url,
      html: '<html><head><title>Acme AI widgets for teams</title></head><body><main>Acme builds AI widgets for teams.</main></body></html>',
      robotsTxt: 'User-agent: *\nDisallow:',
      llmsTxt: null,
    });
  },
};

describe('GEO audits (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let tokenA = '';

  const uid = () => `${Math.random().toString(36).slice(2)}@geo.test`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PageFetcher)
      .useValue(fetcherStub)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();
    server = app.getHttpServer() as Server;

    tokenA = (
      await request(server)
        .post('/v1/auth/register')
        .send({ email: uid(), password: 'password123' })
    ).body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  async function poll(id: string, token: string) {
    for (let i = 0; i < 40; i++) {
      const res = await request(server)
        .get(`/v1/audits/${id}`)
        .set('Authorization', `Bearer ${token}`);
      if (['COMPLETED', 'FAILED'].includes(res.body.data.status)) {
        return res.body.data;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('audit did not complete in time');
  }

  async function submit(url: string) {
    return request(server)
      .post('/v1/audits')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ url });
  }

  it('runs an audit asynchronously and returns findings', async () => {
    const created = await submit('https://example.com/');
    expect(created.status).toBe(202);
    expect(created.body.data.status).toBe('PENDING');

    const done = await poll(created.body.data.id, tokenA);
    expect(done.status).toBe('COMPLETED');
    const dims = done.findings.map((f: { dimension: string }) => f.dimension);
    expect(dims).toContain('core-metadata');
    // No JSON-LD/llms.txt in the stubbed page, so at least one finding needs work.
    expect(
      done.findings.some((f: { status: string }) => f.status === 'needs_work'),
    ).toBe(true);
  });

  it('marks an audit FAILED when the page cannot be fetched', async () => {
    const created = await submit(FAIL_URL);
    const done = await poll(created.body.data.id, tokenA);
    expect(done.status).toBe('FAILED');
    expect(done.findings).toBeNull();
  });

  it("lists the caller's audits", async () => {
    const res = await request(server)
      .get('/v1/audits')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data).toHaveProperty('nextCursor');
  });

  it("isolates one tenant's audits from another", async () => {
    const created = await submit('https://example.com/');
    const id = created.body.data.id;

    const tokenB = (
      await request(server)
        .post('/v1/auth/register')
        .send({ email: uid(), password: 'password123' })
    ).body.data.accessToken;
    const asB = await request(server)
      .get(`/v1/audits/${id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(asB.status).toBe(404);
  });
});
