import { load } from 'cheerio';
import { PageContext } from '../../geo.types';
import { crawlerAccessCheck } from '../crawler-access.check';

function ctx(robotsTxt: string | null): PageContext {
  return {
    url: 'https://x.com',
    html: '',
    $: load(''),
    robotsTxt,
    llmsTxt: null,
  };
}

describe('crawlerAccessCheck', () => {
  it('is ok when robots.txt does not block AI bots', () => {
    const f = crawlerAccessCheck.run(ctx('User-agent: *\nDisallow: /admin\n'));
    expect(f.status).toBe('ok');
  });

  it('flags when GPTBot is disallowed from the whole site', () => {
    const f = crawlerAccessCheck.run(ctx('User-agent: GPTBot\nDisallow: /\n'));
    expect(f.status).toBe('needs_work');
    expect(f.detail).toContain('GPTBot');
  });

  it('flags when a wildcard blocks everything (covers AI bots too)', () => {
    const f = crawlerAccessCheck.run(ctx('User-agent: *\nDisallow: /\n'));
    expect(f.status).toBe('needs_work');
  });

  it('flags a bot in a grouped (consecutive) user-agent block', () => {
    const f = crawlerAccessCheck.run(
      ctx('User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n'),
    );
    expect(f.status).toBe('needs_work');
    expect(f.detail).toContain('GPTBot');
  });

  it('respects a re-allowing Allow rule', () => {
    const f = crawlerAccessCheck.run(
      ctx('User-agent: GPTBot\nDisallow: /\nAllow: /\n'),
    );
    expect(f.status).toBe('ok');
  });

  it('is ok (nothing to block) when there is no robots.txt', () => {
    const f = crawlerAccessCheck.run(ctx(null));
    expect(f.status).toBe('ok');
  });
});
