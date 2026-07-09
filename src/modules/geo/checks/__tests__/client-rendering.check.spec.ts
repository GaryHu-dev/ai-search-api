import { load } from 'cheerio';
import { PageContext } from '../../geo.types';
import { clientRenderingCheck } from '../client-rendering.check';

function ctx(html: string): PageContext {
  return {
    url: 'https://x.com',
    html,
    $: load(html),
    robotsTxt: null,
    llmsTxt: null,
  };
}

describe('clientRenderingCheck', () => {
  it('flags an empty SPA shell (single mount div, little text)', () => {
    const html =
      '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
    expect(clientRenderingCheck.run(ctx(html)).status).toBe('needs_work');
  });

  it('is ok when the body has real server-rendered text', () => {
    const html = `<html><body><main>${'Acme builds AI widgets for teams. '.repeat(20)}</main></body></html>`;
    expect(clientRenderingCheck.run(ctx(html)).status).toBe('ok');
  });
});
