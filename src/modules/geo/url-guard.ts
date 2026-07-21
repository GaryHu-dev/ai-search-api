import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// SSRF guard. The audit fetches user-supplied URLs server-side, so we must refuse
// anything that resolves to a non-public address (cloud metadata, loopback,
// private/link-local ranges). Set GEO_ALLOW_PRIVATE_URLS=true to disable — dev
// and tests only, never production.

function isBlockedV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = p;
  return (
    a === 0 || // "this" network
    a === 127 || // loopback
    a === 10 || // private
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local (incl. 169.254.169.254 metadata)
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 IETF protocol assignments
    (a === 192 && b === 88 && c === 99) || // 192.88.99.0/24 6to4 relay anycast
    a >= 224 // multicast + reserved
  );
}

// Expand any IPv6 spelling (compressed, embedded IPv4) to its 8 hextets. The
// WHATWG URL parser serialises IPv4-mapped addresses to hex (::ffff:7f00:1), so
// we must work on the parsed bytes, not the textual shape.
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  // Fold a trailing dotted-IPv4 (::ffff:127.0.0.1) into two hextets.
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[2].split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return null;
    }
    s = `${v4[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const pad = Array<string>(Math.max(0, 8 - head.length - tail.length)).fill(
    '0',
  );
  const groups = halves.length === 2 ? [...head, ...pad, ...tail] : head;
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => parseInt(g || '0', 16));
  return nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : nums;
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true; // unparseable → block

  const embeddedV4 = () =>
    isBlockedV4(
      `${(g[6] >> 8) & 0xff}.${g[6] & 0xff}.${(g[7] >> 8) & 0xff}.${g[7] & 0xff}`,
    );

  // ::ffff:0:0/96 IPv4-mapped, ::/96 IPv4-compat (covers ::/::1), 64:ff9b::/96 NAT64.
  const topZero = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0;
  if (topZero && g[4] === 0 && (g[5] === 0xffff || g[5] === 0))
    return embeddedV4();
  if (g[0] === 0x64 && g[1] === 0xff9b) return embeddedV4();

  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

// True if the IP must not be fetched. Non-IP input is treated as blocked.
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  if (version === 6) return isBlockedV6(ip);
  return true;
}

// Throws if `target` is not safe to fetch server-side. Resolves the host and
// rejects if ANY resolved address is non-public (defeats round-robin DNS).
// `allowPrivate` (dev/test only) disables the private-range block.
//
// Residual: the subsequent fetch re-resolves the hostname, so a rebinding record
// (public here, private at connect time) is not fully closed. Pinning the
// validated IP via a custom undici dispatcher is the future hardening.
export async function assertFetchableUrl(
  target: string,
  allowPrivate: boolean,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs may be audited');
  }
  if (allowPrivate) return;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error('URL resolves to a disallowed address');
    }
  }
}
