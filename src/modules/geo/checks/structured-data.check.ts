import { Finding, GeoCheck, PageContext } from '../geo.types';
import { plainText } from '../text';

// Walks a JSON-LD value collecting @type names, including the very common
// `@graph` container shape (Yoast/WordPress and others put everything there).
function collectTypes(node: unknown, types: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, types);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') {
      types.add(t);
    } else if (Array.isArray(t)) {
      for (const x of t) if (typeof x === 'string') types.add(x);
    }
    if (Array.isArray(obj['@graph'])) collectTypes(obj['@graph'], types);
  }
}

function extractTypes($: PageContext['$']): string[] {
  const types = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      collectTypes(JSON.parse($(el).text()), types);
    } catch {
      // Malformed JSON-LD counts as "present but unusable"; ignored here.
    }
  });
  // Sanitise: @type comes off the fetched page, so treat it as untrusted text.
  return [...types].map((t) => plainText(t, 60));
}

export const structuredDataCheck: GeoCheck = {
  dimension: 'structured-data',
  run(ctx: PageContext): Finding {
    const types = extractTypes(ctx.$);
    const base = {
      dimension: 'structured-data',
      title: 'Structured data (schema.org)',
      basis: 'Schema.org vocabulary and Google structured-data guidelines.',
      strength: 'hard' as const,
    };

    if (types.length > 0) {
      return {
        ...base,
        status: 'ok',
        summary: `Found schema.org markup: ${types.join(', ')}.`,
        detail: `The homepage exposes JSON-LD of type(s): ${types.join(', ')}, which helps engines understand the entity unambiguously.`,
        recommendation:
          'No change needed; keep the markup accurate and current.',
      };
    }

    return {
      ...base,
      status: 'needs_work',
      summary: 'No schema.org structured data found.',
      detail:
        'The homepage has no JSON-LD, so engines must infer who you are from prose alone.',
      recommendation:
        'Add an Organization JSON-LD block in <head>, e.g.:\n' +
        '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"YOUR NAME","url":"YOUR URL","description":"WHAT YOU DO"}</script>\n' +
        'Add FAQ or Product types where relevant.',
    };
  },
};
