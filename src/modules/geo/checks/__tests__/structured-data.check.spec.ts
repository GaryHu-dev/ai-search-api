import { load } from 'cheerio';
import { PageContext } from '../../geo.types';
import { structuredDataCheck } from '../structured-data.check';

function ctx(html: string): PageContext {
  return {
    url: 'https://x.com',
    html,
    $: load(html),
    robotsTxt: null,
    llmsTxt: null,
  };
}

describe('structuredDataCheck', () => {
  it('flags when there is no JSON-LD', () => {
    expect(
      structuredDataCheck.run(ctx('<html><body>hi</body></html>')).status,
    ).toBe('needs_work');
  });

  it('is ok and lists types when JSON-LD is present', () => {
    const html =
      '<html><head><script type="application/ld+json">{"@type":"Organization","name":"X"}</script></head></html>';
    const f = structuredDataCheck.run(ctx(html));
    expect(f.status).toBe('ok');
    expect(f.detail).toContain('Organization');
  });

  it('finds types inside an @graph container (Yoast/WordPress shape)', () => {
    const html =
      '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},{"@type":"WebSite"}]}</script></head></html>';
    const f = structuredDataCheck.run(ctx(html));
    expect(f.status).toBe('ok');
    expect(f.detail).toContain('Organization');
  });
});
