import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetch, Agent, type Response } from 'undici';
import { Env } from '../../core/config/env.validation';
import { assertFetchableUrl, ValidatedAddress } from './url-guard';

export interface FetchedPage {
  url: string; // final URL after any redirects
  html: string;
  robotsTxt: string | null;
  llmsTxt: string | null;
}

const USER_AGENT = 'GEO-Audit-Bot/1.0 (+https://example.com/bot)';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

interface FetchResult {
  finalUrl: string;
  body: string;
}

@Injectable()
export class PageFetcher {
  private readonly allowPrivate: boolean;

  constructor(config: ConfigService<Env, true>) {
    // Captured at boot from the validated config (not read raw at request time).
    this.allowPrivate =
      config.get('GEO_ALLOW_PRIVATE_URLS', { infer: true }) === 'true';
  }

  async fetch(url: string): Promise<FetchedPage> {
    const homepage = await this.get(url, true);
    if (homepage === null) {
      throw new Error(`Could not fetch ${url} as an HTML page`);
    }
    // Fetch robots/llms from the FINAL origin (after redirects).
    const origin = new URL(homepage.finalUrl).origin;
    const [robots, llms] = await Promise.all([
      this.get(`${origin}/robots.txt`, false),
      this.get(`${origin}/llms.txt`, false),
    ]);
    return {
      url: homepage.finalUrl,
      html: homepage.body,
      robotsTxt: robots?.body ?? null,
      llmsTxt: llms?.body ?? null,
    };
  }

  // Fetch with the SSRF guard applied to every hop, manual redirect handling
  // (each target re-validated), a content-type gate, a byte cap, and a timeout
  // that also covers the body read. Returns null on any failure.
  private async get(
    target: string,
    requireHtml: boolean,
  ): Promise<FetchResult | null> {
    let current = target;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      // Per-hop dispatcher pinned to the IP this hop's validation approved, so
      // DNS cannot be re-resolved to a different address between validation and
      // connect (closes the rebinding TOCTOU). Closed in finally to free sockets.
      let dispatcher: Agent | undefined;
      try {
        const pinned = await assertFetchableUrl(current, this.allowPrivate);
        dispatcher = pinned ? pinnedDispatcher(pinned) : undefined;
        // Both `fetch` and `Agent` are imported from the same `undici` package
        // (not Node's global fetch), so `dispatcher` is a native RequestInit
        // field — no type-widening workaround needed, and the dispatcher is
        // guaranteed to be the exact implementation `fetch` expects.
        const res = await fetch(current, {
          headers: { 'user-agent': USER_AGENT },
          redirect: 'manual',
          signal: controller.signal,
          dispatcher,
        });

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) return null;
          current = new URL(location, current).toString();
          continue; // re-validated at the top of the next iteration
        }
        if (!res.ok) return null;
        if (
          requireHtml &&
          !(res.headers.get('content-type') ?? '').includes('text/html')
        ) {
          return null;
        }
        const body = await this.readCapped(res);
        return body === null ? null : { finalUrl: current, body };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        // Fire-and-forget: the request is done (or aborted); just release sockets.
        void dispatcher?.close().catch(() => undefined);
      }
    }
    return null; // too many redirects
  }

  // Streams the body and stops once MAX_BYTES is reached, so an oversized (or
  // malicious) response can't buffer unbounded memory. Returns null when the
  // body exceeds the cap: a truncated page would be scored as if complete,
  // producing bogus "missing content" findings, so an oversized page is treated
  // as unfetchable (same as any other failure) rather than audited.
  private async readCapped(res: Response): Promise<string | null> {
    const declared = Number(res.headers.get('content-length'));
    if (declared && declared > MAX_BYTES) return null;
    if (!res.body) return null;

    // undici's `Response.body` is a `node:stream/web` `ReadableStream` typed
    // with a default (`any`) generic, so the reader is annotated explicitly —
    // the chunks are Uint8Array at runtime, same as under the global fetch.
    const reader: ReadableStreamDefaultReader<Uint8Array> =
      res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value }: ReadableStreamReadResult<Uint8Array> =
        await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return null; // oversized → unfetchable, do not score truncated HTML
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

// Builds a one-request undici dispatcher whose DNS lookup always returns the
// already-validated IP, so the socket connects to exactly that address. The
// hostname is left untouched, so undici still uses it for TLS SNI/servername and
// the Host header — certificate validation runs against the hostname (not the
// pinned IP) and is NOT weakened.
function pinnedDispatcher(pinned: ValidatedAddress): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, [{ address: pinned.address, family: pinned.family }]);
      },
    },
  });
}
