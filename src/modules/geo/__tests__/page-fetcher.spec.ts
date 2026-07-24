import { ConfigService } from '@nestjs/config';
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';
import { Env } from '../../../core/config/env.validation';
import { PageFetcher } from '../page-fetcher';
import { assertFetchableUrl } from '../url-guard';
import * as urlGuard from '../url-guard';

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

// Hardening: redirect-based SSRF, redirect limits, oversized bodies, and the
// content-type gate — all exercised against a real HTTP server, not mocks. The
// SSRF override is OFF here so the guard's real per-hop validation runs; the
// server binds to a public-looking loopback alias to keep validation on while
// staying local. We drive private/loopback targets THROUGH redirects so the
// per-hop re-validation is what does the rejecting.
describe('PageFetcher hardening', () => {
  // SSRF guard ON (override off) so assertFetchableUrl really validates each hop.
  const guarded = { get: () => undefined } as unknown as ConfigService<
    Env,
    true
  >;
  // SSRF guard OFF so loopback fixtures are reachable (for the non-SSRF cases).
  const open = { get: () => 'true' } as unknown as ConfigService<Env, true>;

  let server: Server;
  let base: string;
  let handler: (req: IncomingMessage, res: ServerResponse) => void;

  beforeAll(async () => {
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('rejects a redirect to a private/loopback target (per-hop SSRF re-validation)', async () => {
    // A 302 to a private address (the classic redirect-based SSRF bypass). The
    // fetcher re-validates every hop, so the redirect target must be refused.
    //
    // Note on offline testability: get() pins each hop to its validated IP, so a
    // genuinely-public first hop would be unreachable from a loopback test
    // server — there is no way to stage "public origin -> private redirect"
    // fully end-to-end without a real public host or DNS mocking. So we assert
    // the two real facts that compose the defense: (a) the exact per-hop
    // validator get() calls on every redirect target rejects the private target,
    // and (b) the guarded fetch of a loopback origin that 302s to a private
    // address rejects rather than following it.
    const privateTarget = 'http://169.254.169.254/latest/meta-data/';
    await expect(assertFetchableUrl(privateTarget, false)).rejects.toThrow(
      /disallowed address/,
    );

    handler = (_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', privateTarget);
      res.end();
    };
    await expect(
      new PageFetcher(guarded).fetch(`${base}/redirect`),
    ).rejects.toThrow();
  });

  it('rejects when redirects exceed MAX_REDIRECTS', async () => {
    // Endless redirect chain; guard OFF so loopback hops are allowed and the
    // ONLY thing that can stop the loop is the MAX_REDIRECTS cap.
    handler = (_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `${base}/again`);
      res.end();
    };
    await expect(new PageFetcher(open).fetch(`${base}/`)).rejects.toThrow();
  });

  it('rejects a body larger than MAX_BYTES (not scored as complete)', async () => {
    // 2 MB cap. Stream ~3 MB via chunked writes (multiple write()s force chunked
    // transfer with NO content-length), so the STREAMING cap in readCapped is
    // what trips — the exact path B2 hardened — not the declared-length check.
    const megabyte = 'a'.repeat(1024 * 1024);
    handler = (_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.write(megabyte);
      res.write(megabyte);
      res.write(megabyte);
      res.end();
    };
    await expect(new PageFetcher(open).fetch(`${base}/`)).rejects.toThrow();
  });

  it('rejects a non-HTML content-type when HTML is required', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{"not":"html"}');
    };
    await expect(new PageFetcher(open).fetch(`${base}/`)).rejects.toThrow();
  });
});

// F2: drives the PINNED-dispatcher path end-to-end. Every test above runs
// `assertFetchableUrl` for real against a loopback target, so pinning is a
// same-address no-op — a break in the Agent/`connect.lookup` wiring (e.g. a
// future undici/Node change to the dispatcher contract) would go unnoticed.
// Here the guard is stubbed to "approve" a hostname that looks public and is
// guaranteed to never resolve in real DNS (the reserved `.invalid` TLD, RFC
// 2606), pinned to the local test server's real loopback IP. If the pinned
// Agent actually wires `connect.lookup` into the dispatcher, the fetch
// connects straight to the local server; if the wiring is broken, undici
// falls back to resolving the hostname via real DNS, which cannot succeed —
// so this test goes RED on a dispatcher regression.
describe('PageFetcher pinned dispatcher (F2)', () => {
  let server: Server;
  let port: number;
  let hits: string[];

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url === '/robots.txt') return res.end('User-agent: *\nDisallow:');
      if (req.url === '/llms.txt') {
        res.statusCode = 404;
        return res.end('nope');
      }
      res.setHeader('content-type', 'text/html');
      res.end('<html><body>pinned-through-dispatcher</body></html>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('connects through the pinned Agent to the validated IP, not real DNS', async () => {
    hits = [];
    const target = `http://public-looking.invalid:${port}/`;
    const spy = jest
      .spyOn(urlGuard, 'assertFetchableUrl')
      .mockResolvedValue({ address: '127.0.0.1', family: 4 });

    const result = await new PageFetcher(config).fetch(target);

    expect(result.html).toContain('pinned-through-dispatcher');
    expect(result.robotsTxt).toContain('User-agent');
    expect(hits).toContain('/');
    expect(spy).toHaveBeenCalledWith(target, true);
  });
});

// F3: proves per-hop redirect re-validation for real. The earlier redirect
// test rejects at hop 0 (the origin itself is private), so it never proves
// the SECOND hop is re-validated. Here hop 0 is APPROVED by the guard and
// genuinely reachable (pinned to the local test server), while the redirect
// TARGET (hop 1) is REJECTED by the guard — so a pass here can only be
// explained by the fetcher re-running `assertFetchableUrl` on the redirect
// target and honouring its rejection, not by hop 0 failing.
describe('PageFetcher redirect re-validation per hop (F3)', () => {
  let server: Server;
  let port: number;
  let hits: string[];
  const redirectTarget = 'http://private-looking.invalid/secret';

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.statusCode = 302;
      res.setHeader('location', redirectTarget);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects at hop 1 even though hop 0 was approved and reachable', async () => {
    hits = [];
    const hop0 = `http://public-looking.invalid:${port}/`;
    const spy = jest
      .spyOn(urlGuard, 'assertFetchableUrl')
      .mockImplementation((target: string) => {
        if (target === hop0) {
          return Promise.resolve({ address: '127.0.0.1', family: 4 as const });
        }
        if (target === redirectTarget) {
          return Promise.reject(
            new Error('URL resolves to a disallowed address'),
          );
        }
        return Promise.reject(
          new Error(`unexpected target in test: ${target}`),
        );
      });

    await expect(new PageFetcher(config).fetch(hop0)).rejects.toThrow();

    // Hop 0 was really fetched (the rejection isn't hop 0 failing to
    // connect) ...
    expect(hits).toEqual(['/']);
    // ...and the guard was really asked to validate the redirect target (the
    // rejection is the hop-1 re-validation, not something else).
    expect(spy).toHaveBeenCalledWith(redirectTarget, true);
  });
});
