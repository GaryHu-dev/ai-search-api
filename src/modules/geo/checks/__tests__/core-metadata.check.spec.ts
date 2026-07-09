import { load } from 'cheerio';
import { PageContext } from '../../geo.types';
import { coreMetadataCheck } from '../core-metadata.check';

function ctx(html: string): PageContext {
  return {
    url: 'https://x.com',
    html,
    $: load(html),
    robotsTxt: null,
    llmsTxt: null,
  };
}

describe('coreMetadataCheck', () => {
  it('flags a page with no title or description', () => {
    expect(
      coreMetadataCheck.run(ctx('<html><body>x</body></html>')).status,
    ).toBe('needs_work');
  });

  it('is ok with a sensible title, description and OG tags', () => {
    const html = `<html><head>
      <title>Acme — AI widgets for teams</title>
      <meta name="description" content="Acme builds AI widgets that help teams ship faster. Trusted by thousands.">
      <meta property="og:title" content="Acme">
    </head></html>`;
    expect(coreMetadataCheck.run(ctx(html)).status).toBe('ok');
  });
});
