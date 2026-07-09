import { load } from 'cheerio';
import { PageContext } from '../../geo.types';
import { llmsTxtCheck } from '../llms-txt.check';

function ctx(llmsTxt: string | null): PageContext {
  return {
    url: 'https://x.com',
    html: '',
    $: load(''),
    robotsTxt: null,
    llmsTxt,
  };
}

describe('llmsTxtCheck', () => {
  it('is advisory-needs_work when llms.txt is absent', () => {
    const f = llmsTxtCheck.run(ctx(null));
    expect(f.status).toBe('needs_work');
    expect(f.strength).toBe('advisory');
  });

  it('is ok when llms.txt is present', () => {
    expect(llmsTxtCheck.run(ctx('# Acme\n> AI widgets')).status).toBe('ok');
  });
});
