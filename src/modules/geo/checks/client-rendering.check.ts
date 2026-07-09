import { Finding, GeoCheck, PageContext } from '../geo.types';

export const clientRenderingCheck: GeoCheck = {
  dimension: 'client-rendering',
  run(ctx: PageContext): Finding {
    const bodyText = ctx.$('body').text().replace(/\s+/g, ' ').trim();
    const scripts = ctx.$('script').length;
    // Heuristic: very little server-rendered text but plenty of scripts => SPA shell.
    const looksClientSide = bodyText.length < 200 && scripts >= 1;

    const base = {
      dimension: 'client-rendering',
      title: 'Server-rendered content',
      basis: 'AI crawlers generally do not execute JavaScript.',
      strength: 'hard' as const,
    };

    if (!looksClientSide) {
      return {
        ...base,
        status: 'ok',
        summary: 'Main content is present in the server HTML.',
        detail: `Found ~${bodyText.length} characters of text in the initial HTML.`,
        recommendation: 'No change needed.',
      };
    }

    return {
      ...base,
      status: 'needs_work',
      summary: 'The page appears to render its content with JavaScript.',
      detail: `The initial HTML has only ~${bodyText.length} characters of text with ${scripts} script(s) — typical of a client-rendered app. Crawlers that skip JS see almost nothing.`,
      recommendation:
        'Server-render or pre-render the homepage so the main content is in the initial HTML (SSR/SSG, or a prerender step for crawlers).',
    };
  },
};
