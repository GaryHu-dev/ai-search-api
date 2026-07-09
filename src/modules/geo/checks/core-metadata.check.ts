import { Finding, GeoCheck, PageContext } from '../geo.types';
import { plainText } from '../text';

export const coreMetadataCheck: GeoCheck = {
  dimension: 'core-metadata',
  run(ctx: PageContext): Finding {
    const $ = ctx.$;
    const title = $('title').first().text().trim();
    const description = (
      $('meta[name="description"]').attr('content') ?? ''
    ).trim();
    const hasOg = $('meta[property^="og:"]').length > 0;

    const problems: string[] = [];
    if (title.length < 10 || title.length > 70) {
      problems.push('title missing or an unusual length (aim ~10–70 chars)');
    }
    if (description.length < 50 || description.length > 160) {
      problems.push(
        'meta description missing or an unusual length (aim ~50–160 chars)',
      );
    }
    if (!hasOg) problems.push('no Open Graph tags');

    const base = {
      dimension: 'core-metadata',
      title: 'Core metadata',
      basis:
        'Standard HTML metadata and Open Graph, consumed by search and AI engines.',
      strength: 'hard' as const,
    };

    if (problems.length === 0) {
      return {
        ...base,
        status: 'ok',
        summary:
          'Title, description and Open Graph tags are present and sensible.',
        detail: `Title: "${plainText(title, 80)}". Description length: ${description.length} chars.`,
        recommendation: 'No change needed.',
      };
    }

    return {
      ...base,
      status: 'needs_work',
      summary: 'Core metadata needs attention.',
      detail: `Issues: ${problems.join('; ')}.`,
      recommendation:
        'Set a descriptive <title> (~10–70 chars), a <meta name="description"> (~50–160 chars) that says who you are and what you do, and Open Graph tags (og:title, og:description, og:url).',
    };
  },
};
