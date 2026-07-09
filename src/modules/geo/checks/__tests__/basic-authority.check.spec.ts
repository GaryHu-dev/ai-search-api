import { load } from 'cheerio';
import { PageContext } from '../../geo.types';
import { basicAuthorityCheck } from '../basic-authority.check';

function ctx(html: string): PageContext {
  return {
    url: 'https://x.com',
    html,
    $: load(html),
    robotsTxt: null,
    llmsTxt: null,
  };
}

describe('basicAuthorityCheck', () => {
  it('flags a page with no author or date signals', () => {
    expect(
      basicAuthorityCheck.run(ctx('<html><body>x</body></html>')).status,
    ).toBe('needs_work');
  });

  it('is ok when author and date signals exist', () => {
    const html =
      '<html><head><meta name="author" content="Jane"><meta property="article:published_time" content="2026-01-01"></head></html>';
    expect(basicAuthorityCheck.run(ctx(html)).status).toBe('ok');
  });
});
