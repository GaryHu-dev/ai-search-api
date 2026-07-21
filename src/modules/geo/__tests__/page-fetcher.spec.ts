import { ConfigService } from '@nestjs/config';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Env } from '../../../core/config/env.validation';
import { PageFetcher } from '../page-fetcher';

// Config stub with the SSRF override on, so the 127.0.0.1 fixtures are allowed.
const config = { get: () => 'true' } as unknown as ConfigService<Env, true>;

describe('PageFetcher', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/robots.txt') return res.end('User-agent: *\nDisallow:');
      if (req.url === '/llms.txt') {
        res.statusCode = 404;
        return res.end('nope');
      }
      res.setHeader('content-type', 'text/html');
      res.end('<html><body>hello</body></html>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('returns homepage html + robots.txt, and null for a missing llms.txt', async () => {
    const result = await new PageFetcher(config).fetch(`${base}/`);
    expect(result.html).toContain('hello');
    expect(result.robotsTxt).toContain('User-agent');
    expect(result.llmsTxt).toBeNull();
  });

  it('throws when the homepage cannot be fetched', async () => {
    await expect(
      new PageFetcher(config).fetch('http://127.0.0.1:1/'),
    ).rejects.toThrow();
  });

  it('refuses a loopback URL when private hosts are not allowed (SSRF guard on)', async () => {
    const blocking = { get: () => undefined } as unknown as ConfigService<
      Env,
      true
    >;
    await expect(new PageFetcher(blocking).fetch(`${base}/`)).rejects.toThrow();
  });
});
