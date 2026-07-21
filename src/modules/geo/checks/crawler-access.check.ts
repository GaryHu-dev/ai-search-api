import { Finding, GeoCheck, PageContext } from '../geo.types';

const AI_BOTS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];

interface Rules {
  disallow: string[];
  allow: string[];
}

// Parse robots.txt into { userAgent(lowercased) -> rules }. Consecutive
// `User-agent:` lines with no rule between them share the following rules
// (per the robots spec), which a naive line-by-line parser gets wrong.
function parseGroups(robots: string): Map<string, Rules> {
  const groups = new Map<string, Rules>();
  const groupFor = (ua: string): Rules => {
    let r = groups.get(ua);
    if (!r) {
      r = { disallow: [], allow: [] };
      groups.set(ua, r);
    }
    return r;
  };

  let pendingAgents: string[] = [];
  let sawRuleSinceAgent = false;

  for (const raw of robots.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      // A user-agent line after a rule starts a fresh group.
      if (sawRuleSinceAgent) {
        pendingAgents = [];
        sawRuleSinceAgent = false;
      }
      pendingAgents.push(value.toLowerCase());
    } else if (key === 'disallow' || key === 'allow') {
      sawRuleSinceAgent = true;
      const agents = pendingAgents.length ? pendingAgents : ['*'];
      for (const ua of agents) {
        const rules = groupFor(ua);
        (key === 'disallow' ? rules.disallow : rules.allow).push(value);
      }
    }
  }
  return groups;
}

// A bot is blocked if its group (or the '*' fallback) disallows the root and
// doesn't re-allow it.
function isBlocked(groups: Map<string, Rules>, bot: string): boolean {
  const rules = groups.get(bot.toLowerCase()) ?? groups.get('*');
  if (!rules) return false;
  const blocksRoot = rules.disallow.some((p) => p === '/' || p === '/*');
  const reAllowsRoot = rules.allow.some((p) => p === '/' || p === '/*');
  return blocksRoot && !reAllowsRoot;
}

export const crawlerAccessCheck: GeoCheck = {
  dimension: 'ai-crawler-access',
  run(ctx: PageContext): Finding {
    const groups = ctx.robotsTxt
      ? parseGroups(ctx.robotsTxt)
      : new Map<string, Rules>();
    const blocked = AI_BOTS.filter((bot) => isBlocked(groups, bot));

    const base = {
      dimension: 'ai-crawler-access',
      title: 'AI crawler access',
      basis:
        'Vendor crawler docs: OpenAI GPTBot, Anthropic ClaudeBot, PerplexityBot, Google-Extended.',
      strength: 'hard' as const,
    };

    if (blocked.length === 0) {
      return {
        ...base,
        status: 'ok',
        summary: 'AI crawlers are allowed to read this site.',
        detail: 'No AI-specific user-agent is disallowed from the site root.',
        recommendation: 'No change needed.',
      };
    }

    return {
      ...base,
      status: 'needs_work',
      summary: `robots.txt blocks ${blocked.length} AI crawler(s).`,
      detail: `These are disallowed from the site: ${blocked.join(', ')}. Blocked crawlers cannot read your pages, so their engines cannot cite you.`,
      recommendation: `Remove the "Disallow: /" rule for: ${blocked.join(', ')} (or delete the AI-bot user-agent groups) in robots.txt.`,
    };
  },
};
