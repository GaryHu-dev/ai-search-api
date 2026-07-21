import { Finding, GeoCheck, PageContext } from '../geo.types';

export const clientRenderingCheck: GeoCheck = {
  dimension: 'client-rendering',
  run(ctx: PageContext): Finding {
    const bodyText = ctx.$('body').text().replace(/\s+/g, ' ').trim();
    // Count only executable scripts. Data blocks like <script
    // type="application/ld+json"> (structured data) and other non-JS types don't
    // render content, so counting them would falsely flag a short server-rendered
    // page — and would penalise adding the JSON-LD the structured-data check asks
    // for.
    const scripts = ctx.$('script').filter((_, el) => {
      const type = (ctx.$(el).attr('type') ?? '').trim().toLowerCase();
      return (
        type === '' ||
        type === 'text/javascript' ||
        type === 'application/javascript' ||
        type === 'module'
      );
    }).length;
    // Flag either a near-empty page (nothing for engines to read at all) or the
    // classic SPA shell (little server text, but scripts that would render it).
    const looksClientSide =
      bodyText.length < 30 || (bodyText.length < 200 && scripts >= 1);

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
