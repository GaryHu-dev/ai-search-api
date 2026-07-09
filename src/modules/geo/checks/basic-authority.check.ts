import { Finding, GeoCheck, PageContext } from '../geo.types';

export const basicAuthorityCheck: GeoCheck = {
  dimension: 'basic-authority',
  run(ctx: PageContext): Finding {
    const $ = ctx.$;
    const hasAuthor =
      $('meta[name="author"]').length > 0 || $('[rel="author"]').length > 0;
    const hasDate =
      $('meta[property="article:published_time"]').length > 0 ||
      $('time[datetime]').length > 0;

    const base = {
      dimension: 'basic-authority',
      title: 'Authority & freshness signals',
      basis: "Google's E-E-A-T guidance (authorship, freshness).",
      strength: 'advisory' as const,
    };

    if (hasAuthor && hasDate) {
      return {
        ...base,
        status: 'ok',
        summary: 'Author and date signals are present.',
        detail: 'The page exposes authorship and a publish/update date.',
        recommendation: 'Keep dates current and authorship attributable.',
      };
    }

    const missing = [
      !hasAuthor ? 'author' : null,
      !hasDate ? 'published/updated date' : null,
    ].filter(Boolean);

    return {
      ...base,
      status: 'needs_work',
      summary: `Missing ${missing.join(' and ')} signal(s).`,
      detail:
        'Engines prefer content that is attributable and fresh; these signals are weak or absent.',
      recommendation:
        'Add a <meta name="author"> and a visible/marked-up date (<time datetime> or article:published_time). Cite sources where you make claims.',
    };
  },
};
