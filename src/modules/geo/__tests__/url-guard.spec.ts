import { assertFetchableUrl, isBlockedAddress } from '../url-guard';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.5.4',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback (dotted)
    '::ffff:7f00:1', // ...as the URL parser serialises it (hex)
    '::ffff:a9fe:a9fe', // 169.254.169.254 mapped (hex) — cloud metadata
    '64:ff9b::7f00:1', // NAT64 of 127.0.0.1
    '198.18.0.5', // benchmarking /15
    '198.19.10.1', // benchmarking /15
    '192.0.0.1', // IETF protocol assignments /24
    '192.88.99.1', // 6to4 relay anycast /24
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it('blocks a mapped-IPv6 host as the URL parser actually serialises it', () => {
    const host = new URL('http://[::ffff:169.254.169.254]/').hostname.replace(
      /^\[|\]$/g,
      '',
    );
    expect(isBlockedAddress(host)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '198.20.0.1', '192.0.1.1'])(
    'allows public %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );
});

describe('assertFetchableUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(
      assertFetchableUrl('ftp://example.com', false),
    ).rejects.toThrow(/http/);
  });

  it('rejects an IP-literal in a private/link-local range', async () => {
    await expect(
      assertFetchableUrl('http://169.254.169.254/', false),
    ).rejects.toThrow(/disallowed/);
  });

  it('allows private hosts when allowPrivate is set (dev/test)', async () => {
    await expect(
      assertFetchableUrl('http://127.0.0.1:8080/', true),
    ).resolves.toBeUndefined();
  });
});
