import { Finding, GeoCheck, PageContext } from '../geo.types';

export const llmsTxtCheck: GeoCheck = {
  dimension: 'llms-txt',
  run(ctx: PageContext): Finding {
    const base = {
      dimension: 'llms-txt',
      title: 'llms.txt',
      basis:
        'The llmstxt.org proposal (emerging; not yet adopted by major engines).',
      strength: 'advisory' as const,
    };

    if (ctx.llmsTxt && ctx.llmsTxt.trim().length > 0) {
      return {
        ...base,
        status: 'ok',
        summary: 'An llms.txt file is present.',
        detail: 'The site publishes an llms.txt at its root.',
        recommendation: 'Keep it concise and current.',
      };
    }

    return {
      ...base,
      status: 'needs_work',
      summary: 'No llms.txt found (optional, emerging standard).',
      detail:
        'llms.txt is a proposed plain-text summary aimed at AI. Support is early, so this is a nice-to-have.',
      recommendation:
        'Optionally add /llms.txt, e.g.:\n# Your Brand\n> One-line description.\n## Key pages\n- https://you.com/about: what you do',
    };
  },
};
