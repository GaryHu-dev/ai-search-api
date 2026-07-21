# GEO Audit MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user submits a website URL and, after an async background run, gets a GEO (Generative Engine Optimization) audit of the homepage — a list of evidence-backed findings, each with a fix.

**Architecture:** A new `src/modules/geo/` feature owns an `audits` resource. `POST /v1/audits` creates a `PENDING` audit and enqueues a pg-boss job, returning `202` immediately; a worker fetches the homepage + `robots.txt` + `llms.txt`, runs a set of pure, pluggable `GeoCheck` functions, and writes the findings back. Clients poll `GET /v1/audits/:id`. Adding a dimension later (including AI-backed ones) is just another `GeoCheck`.

**Tech Stack:** NestJS 11, Prisma 6 (PostgreSQL), pg-boss, `cheerio` (HTML parsing), Node 24 global `fetch`, Jest.

**Spec:** `docs/superpowers/specs/2026-07-09-geo-audit-mvp-design.md`

**Scope:** This plan covers the **backend** (this repo). The React results/history page from the spec's Frontend section is built in the separate frontend project against these endpoints — Task 11 documents them for it.

## Global Constraints

- **No AI / no external API** in this MVP — every check is deterministic code.
- **No Redis** — background work runs on the existing pg-boss (Postgres).
- **Tenant isolation**: the `audits` table is tenant-scoped. `Audit` MUST be added to `TENANT_MODELS`. The tenant-scope extension fails **closed**, so any DB access to `Audit` from the worker MUST run inside `TenantContext.run(tenantId, …)`.
- **Conventional Commits** (commitlint enforces; body lines ≤100 chars). Author is Gary Hu only — never add `Co-Authored-By`.
- **Git is gated**: the user (Gary) approves every commit. Do NOT auto-commit. Each "Commit" step below is a *proposed* commit point — run it only after Gary says go.
- **Verify by running**: after code changes run `pnpm build && pnpm lint:check && pnpm test`; for worker/DB changes also `pnpm test:e2e`.
- New deps must clear the pnpm minimum-release-age policy (use stable, long-published versions; `cheerio` qualifies).

## File Structure

```
prisma/schema.prisma                                  Modify: add Audit model + AuditStatus enum
prisma/migrations/<ts>_add_audits/migration.sql       Create: generated migration
src/core/prisma/tenant-scope.extension.ts             Modify: add 'Audit' to TENANT_MODELS
src/modules/geo/
  geo.constants.ts            Create: queue name + job payload type
  geo.types.ts                Create: Finding, PageContext, GeoCheck, EvidenceStrength, FindingStatus
  page-fetcher.ts             Create: PageFetcher (homepage + robots.txt + llms.txt)
  audit-runner.ts             Create: AuditRunner.run(url) -> Finding[]
  audits.service.ts           Create: create/enqueue, findOne, list
  audits.controller.ts        Create: POST /v1/audits, GET /v1/audits, GET /v1/audits/:id
  geo-audit.worker.ts         Create: pg-boss worker (status transitions + TenantContext.run)
  geo.module.ts               Create: module wiring
  dto/create-audit.dto.ts     Create: { url }
  dto/audit.response.ts       Create: response mapper
  checks/
    crawler-access.check.ts   Create + spec
    client-rendering.check.ts Create + spec
    structured-data.check.ts  Create + spec
    core-metadata.check.ts    Create + spec
    llms-txt.check.ts         Create + spec
    basic-authority.check.ts  Create + spec
    index.ts                  Create: ALL_CHECKS
src/app.module.ts             Modify: import GeoModule
test/modules/geo.e2e-spec.ts  Create: submit -> poll -> assert + tenant isolation
docs/frontend-integration.md  Modify: document the audits endpoints
```

---

### Task 1: Core types + queue constants

**Files:**
- Create: `src/modules/geo/geo.types.ts`
- Create: `src/modules/geo/geo.constants.ts`

**Interfaces:**
- Produces:
  - `type FindingStatus = 'ok' | 'needs_work'`
  - `type EvidenceStrength = 'hard' | 'advisory'`
  - `interface Finding { dimension: string; title: string; status: FindingStatus; summary: string; detail: string; recommendation: string; basis: string; strength: EvidenceStrength }`
  - `interface PageContext { url: string; html: string; $: CheerioAPI; robotsTxt: string | null; llmsTxt: string | null }`
  - `interface GeoCheck { readonly dimension: string; run(ctx: PageContext): Finding }`
  - `const GEO_AUDIT_QUEUE = 'geo.audit'`
  - `interface GeoAuditJobData { auditId: string; tenantId: string }`

- [ ] **Step 1: Add cheerio**

Run: `pnpm add cheerio`
Expected: `cheerio` appears in `package.json` dependencies; lockfile updates.

- [ ] **Step 2: Write the types file**

Create `src/modules/geo/geo.types.ts`:

```ts
import type { CheerioAPI } from 'cheerio';

export type FindingStatus = 'ok' | 'needs_work';

// 'hard' = a first-party fact or established standard; 'advisory' = best practice.
export type EvidenceStrength = 'hard' | 'advisory';

// One audited dimension's result. `basis` is the citable source behind the call.
export interface Finding {
  dimension: string;
  title: string;
  status: FindingStatus;
  summary: string;
  detail: string;
  recommendation: string;
  basis: string;
  strength: EvidenceStrength;
}

// Everything a check needs about the fetched homepage, parsed once.
export interface PageContext {
  url: string;
  html: string;
  $: CheerioAPI;
  robotsTxt: string | null;
  llmsTxt: string | null;
}

// A pluggable audit dimension. Pure: no I/O, no state — just context in, finding out.
export interface GeoCheck {
  readonly dimension: string;
  run(ctx: PageContext): Finding;
}
```

- [ ] **Step 3: Write the constants file**

Create `src/modules/geo/geo.constants.ts`:

```ts
// pg-boss queue for GEO audits, and the payload the worker receives.
export const GEO_AUDIT_QUEUE = 'geo.audit';

export interface GeoAuditJobData {
  auditId: string;
  tenantId: string;
}
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm build`
Expected: PASS (no type errors).

- [ ] **Step 5: Propose commit**

```bash
git add package.json pnpm-lock.yaml src/modules/geo/geo.types.ts src/modules/geo/geo.constants.ts
git commit -m "feat(geo): add audit core types and cheerio"
```

---

### Task 2: `crawler-access` check

Detects whether AI crawlers are blocked in `robots.txt`.

**Files:**
- Create: `src/modules/geo/checks/crawler-access.check.ts`
- Test: `src/modules/geo/checks/crawler-access.check.spec.ts`

**Interfaces:**
- Consumes: `GeoCheck`, `Finding`, `PageContext` (Task 1).
- Produces: `export const crawlerAccessCheck: GeoCheck` (dimension `'ai-crawler-access'`).

- [ ] **Step 1: Write the failing test**

Create `src/modules/geo/checks/crawler-access.check.spec.ts`:

```ts
import { load } from 'cheerio';
import { PageContext } from '../geo.types';
import { crawlerAccessCheck } from './crawler-access.check';

function ctx(robotsTxt: string | null): PageContext {
  return { url: 'https://x.com', html: '', $: load(''), robotsTxt, llmsTxt: null };
}

describe('crawlerAccessCheck', () => {
  it('is ok when robots.txt does not block AI bots', () => {
    const f = crawlerAccessCheck.run(ctx('User-agent: *\nDisallow: /admin\n'));
    expect(f.status).toBe('ok');
  });

  it('flags when GPTBot is disallowed from the whole site', () => {
    const f = crawlerAccessCheck.run(
      ctx('User-agent: GPTBot\nDisallow: /\n'),
    );
    expect(f.status).toBe('needs_work');
    expect(f.detail).toContain('GPTBot');
  });

  it('flags when a wildcard blocks everything (covers AI bots too)', () => {
    const f = crawlerAccessCheck.run(ctx('User-agent: *\nDisallow: /\n'));
    expect(f.status).toBe('needs_work');
  });

  it('is ok (nothing to block) when there is no robots.txt', () => {
    const f = crawlerAccessCheck.run(ctx(null));
    expect(f.status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- crawler-access`
Expected: FAIL ("Cannot find module './crawler-access.check'").

- [ ] **Step 3: Write the implementation**

Create `src/modules/geo/checks/crawler-access.check.ts`:

```ts
import { Finding, GeoCheck, PageContext } from '../geo.types';

const AI_BOTS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];

// Parse robots.txt into { userAgent(lowercased) -> disallow paths[] }.
function parseGroups(robots: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  let current: string[] = [];
  for (const raw of robots.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const key = field.trim().toLowerCase();
    if (key === 'user-agent') {
      current = groups.get(value.toLowerCase()) ?? [];
      groups.set(value.toLowerCase(), current);
    } else if (key === 'disallow') {
      current.push(value);
    }
  }
  return groups;
}

// A bot is blocked if its own group (or the '*' group as fallback) disallows '/'.
function isBlocked(groups: Map<string, string[]>, bot: string): boolean {
  const rules = groups.get(bot.toLowerCase()) ?? groups.get('*') ?? [];
  return rules.some((p) => p === '/' || p === '/*');
}

export const crawlerAccessCheck: GeoCheck = {
  dimension: 'ai-crawler-access',
  run(ctx: PageContext): Finding {
    const groups = ctx.robotsTxt ? parseGroups(ctx.robotsTxt) : new Map();
    const blocked = AI_BOTS.filter((bot) => isBlocked(groups, bot));

    const base = {
      dimension: 'ai-crawler-access',
      title: 'AI crawler access',
      basis:
        "Vendor crawler docs: OpenAI GPTBot, Anthropic ClaudeBot, PerplexityBot, Google-Extended.",
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- crawler-access`
Expected: PASS (4 tests).

- [ ] **Step 5: Propose commit**

```bash
git add src/modules/geo/checks/crawler-access.check.ts src/modules/geo/checks/crawler-access.check.spec.ts
git commit -m "feat(geo): add ai-crawler-access check"
```

---

### Task 3: `structured-data` and `core-metadata` checks (DOM-based)

**Files:**
- Create: `src/modules/geo/checks/structured-data.check.ts` (+ `.spec.ts`)
- Create: `src/modules/geo/checks/core-metadata.check.ts` (+ `.spec.ts`)

**Interfaces:**
- Produces: `structuredDataCheck: GeoCheck` (`'structured-data'`), `coreMetadataCheck: GeoCheck` (`'core-metadata'`).

- [ ] **Step 1: Write failing tests**

Create `src/modules/geo/checks/structured-data.check.spec.ts`:

```ts
import { load } from 'cheerio';
import { PageContext } from '../geo.types';
import { structuredDataCheck } from './structured-data.check';

function ctx(html: string): PageContext {
  return { url: 'https://x.com', html, $: load(html), robotsTxt: null, llmsTxt: null };
}

describe('structuredDataCheck', () => {
  it('flags when there is no JSON-LD', () => {
    expect(structuredDataCheck.run(ctx('<html><body>hi</body></html>')).status).toBe(
      'needs_work',
    );
  });

  it('is ok and lists types when JSON-LD is present', () => {
    const html =
      '<html><head><script type="application/ld+json">{"@type":"Organization","name":"X"}</script></head></html>';
    const f = structuredDataCheck.run(ctx(html));
    expect(f.status).toBe('ok');
    expect(f.detail).toContain('Organization');
  });
});
```

Create `src/modules/geo/checks/core-metadata.check.spec.ts`:

```ts
import { load } from 'cheerio';
import { PageContext } from '../geo.types';
import { coreMetadataCheck } from './core-metadata.check';

function ctx(html: string): PageContext {
  return { url: 'https://x.com', html, $: load(html), robotsTxt: null, llmsTxt: null };
}

describe('coreMetadataCheck', () => {
  it('flags a page with no title or description', () => {
    expect(coreMetadataCheck.run(ctx('<html><body>x</body></html>')).status).toBe(
      'needs_work',
    );
  });

  it('is ok with a sensible title, description and OG tags', () => {
    const html = `<html><head>
      <title>Acme — AI widgets for teams</title>
      <meta name="description" content="Acme builds AI widgets that help teams ship faster. Trusted by thousands.">
      <meta property="og:title" content="Acme">
    </head></html>`;
    expect(coreMetadataCheck.run(ctx(html)).status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test -- structured-data core-metadata`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `structured-data`**

Create `src/modules/geo/checks/structured-data.check.ts`:

```ts
import { Finding, GeoCheck, PageContext } from '../geo.types';

function extractTypes($: PageContext['$']): string[] {
  const types = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text());
      const nodes = Array.isArray(json) ? json : [json];
      for (const node of nodes) {
        const t = node?.['@type'];
        if (typeof t === 'string') types.add(t);
        else if (Array.isArray(t)) t.forEach((x) => types.add(String(x)));
      }
    } catch {
      // Malformed JSON-LD counts as "present but unusable"; ignored here.
    }
  });
  return [...types];
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
        recommendation: 'No change needed; keep the markup accurate and current.',
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
```

- [ ] **Step 4: Implement `core-metadata`**

Create `src/modules/geo/checks/core-metadata.check.ts`:

```ts
import { Finding, GeoCheck, PageContext } from '../geo.types';

export const coreMetadataCheck: GeoCheck = {
  dimension: 'core-metadata',
  run(ctx: PageContext): Finding {
    const $ = ctx.$;
    const title = $('title').first().text().trim();
    const description = ($('meta[name="description"]').attr('content') ?? '').trim();
    const hasOg = $('meta[property^="og:"]').length > 0;

    const problems: string[] = [];
    if (title.length < 10 || title.length > 70) {
      problems.push('title missing or an unusual length (aim ~10–70 chars)');
    }
    if (description.length < 50 || description.length > 160) {
      problems.push('meta description missing or an unusual length (aim ~50–160 chars)');
    }
    if (!hasOg) problems.push('no Open Graph tags');

    const base = {
      dimension: 'core-metadata',
      title: 'Core metadata',
      basis: 'Standard HTML metadata and Open Graph, consumed by search and AI engines.',
      strength: 'hard' as const,
    };

    if (problems.length === 0) {
      return {
        ...base,
        status: 'ok',
        summary: 'Title, description and Open Graph tags are present and sensible.',
        detail: `Title: "${title}". Description length: ${description.length} chars.`,
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
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm test -- structured-data core-metadata`
Expected: PASS.

- [ ] **Step 6: Propose commit**

```bash
git add src/modules/geo/checks/structured-data.check.* src/modules/geo/checks/core-metadata.check.*
git commit -m "feat(geo): add structured-data and core-metadata checks"
```

---

### Task 4: `client-rendering`, `llms-txt`, `basic-authority` checks + registry

**Files:**
- Create: `src/modules/geo/checks/client-rendering.check.ts` (+ `.spec.ts`)
- Create: `src/modules/geo/checks/llms-txt.check.ts` (+ `.spec.ts`)
- Create: `src/modules/geo/checks/basic-authority.check.ts` (+ `.spec.ts`)
- Create: `src/modules/geo/checks/index.ts`

**Interfaces:**
- Produces: `clientRenderingCheck`, `llmsTxtCheck`, `basicAuthorityCheck` (all `GeoCheck`); `export const ALL_CHECKS: GeoCheck[]`.

- [ ] **Step 1: Write failing tests**

Create `src/modules/geo/checks/client-rendering.check.spec.ts`:

```ts
import { load } from 'cheerio';
import { PageContext } from '../geo.types';
import { clientRenderingCheck } from './client-rendering.check';

function ctx(html: string): PageContext {
  return { url: 'https://x.com', html, $: load(html), robotsTxt: null, llmsTxt: null };
}

describe('clientRenderingCheck', () => {
  it('flags an empty SPA shell (single mount div, little text)', () => {
    const html = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
    expect(clientRenderingCheck.run(ctx(html)).status).toBe('needs_work');
  });

  it('is ok when the body has real server-rendered text', () => {
    const html = `<html><body><main>${'Acme builds AI widgets for teams. '.repeat(20)}</main></body></html>`;
    expect(clientRenderingCheck.run(ctx(html)).status).toBe('ok');
  });
});
```

Create `src/modules/geo/checks/llms-txt.check.spec.ts`:

```ts
import { load } from 'cheerio';
import { PageContext } from '../geo.types';
import { llmsTxtCheck } from './llms-txt.check';

function ctx(llmsTxt: string | null): PageContext {
  return { url: 'https://x.com', html: '', $: load(''), robotsTxt: null, llmsTxt };
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
```

Create `src/modules/geo/checks/basic-authority.check.spec.ts`:

```ts
import { load } from 'cheerio';
import { PageContext } from '../geo.types';
import { basicAuthorityCheck } from './basic-authority.check';

function ctx(html: string): PageContext {
  return { url: 'https://x.com', html, $: load(html), robotsTxt: null, llmsTxt: null };
}

describe('basicAuthorityCheck', () => {
  it('flags a page with no author or date signals', () => {
    expect(basicAuthorityCheck.run(ctx('<html><body>x</body></html>')).status).toBe(
      'needs_work',
    );
  });

  it('is ok when author and date signals exist', () => {
    const html =
      '<html><head><meta name="author" content="Jane"><meta property="article:published_time" content="2026-01-01"></head></html>';
    expect(basicAuthorityCheck.run(ctx(html)).status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test -- client-rendering llms-txt basic-authority`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `client-rendering`**

Create `src/modules/geo/checks/client-rendering.check.ts`:

```ts
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
```

- [ ] **Step 4: Implement `llms-txt`**

Create `src/modules/geo/checks/llms-txt.check.ts`:

```ts
import { Finding, GeoCheck, PageContext } from '../geo.types';

export const llmsTxtCheck: GeoCheck = {
  dimension: 'llms-txt',
  run(ctx: PageContext): Finding {
    const base = {
      dimension: 'llms-txt',
      title: 'llms.txt',
      basis: 'The llmstxt.org proposal (emerging; not yet adopted by major engines).',
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
```

- [ ] **Step 5: Implement `basic-authority`**

Create `src/modules/geo/checks/basic-authority.check.ts`:

```ts
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
```

- [ ] **Step 6: Write the registry**

Create `src/modules/geo/checks/index.ts`:

```ts
import { GeoCheck } from '../geo.types';
import { basicAuthorityCheck } from './basic-authority.check';
import { clientRenderingCheck } from './client-rendering.check';
import { coreMetadataCheck } from './core-metadata.check';
import { crawlerAccessCheck } from './crawler-access.check';
import { llmsTxtCheck } from './llms-txt.check';
import { structuredDataCheck } from './structured-data.check';

// Order = display order in the report.
export const ALL_CHECKS: GeoCheck[] = [
  crawlerAccessCheck,
  clientRenderingCheck,
  structuredDataCheck,
  coreMetadataCheck,
  basicAuthorityCheck,
  llmsTxtCheck,
];
```

- [ ] **Step 7: Run all check tests**

Run: `pnpm test -- checks`
Expected: PASS (all six checks).

- [ ] **Step 8: Propose commit**

```bash
git add src/modules/geo/checks
git commit -m "feat(geo): add remaining checks and the check registry"
```

---

### Task 5: PageFetcher

Fetches the homepage plus `/robots.txt` and `/llms.txt` from the origin.

**Files:**
- Create: `src/modules/geo/page-fetcher.ts`
- Test: `src/modules/geo/page-fetcher.spec.ts`

**Interfaces:**
- Produces:
  - `interface FetchedPage { url: string; html: string; robotsTxt: string | null; llmsTxt: string | null }`
  - `class PageFetcher { fetch(url: string): Promise<FetchedPage> }` (NestJS `@Injectable`)

- [ ] **Step 1: Write the failing test** (uses a real loopback HTTP server as the fixture)

Create `src/modules/geo/page-fetcher.spec.ts`:

```ts
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { PageFetcher } from './page-fetcher';

describe('PageFetcher', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/robots.txt') return res.end('User-agent: *\nDisallow:');
      if (req.url === '/llms.txt') {
        res.statusCode = 404;
        return res.end('nope');
      }
      res.setHeader('content-type', 'text/html');
      res.end('<html><body>hello</body></html>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('returns homepage html + robots.txt, and null for a missing llms.txt', async () => {
    const result = await new PageFetcher().fetch(`${base}/`);
    expect(result.html).toContain('hello');
    expect(result.robotsTxt).toContain('User-agent');
    expect(result.llmsTxt).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- page-fetcher`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement PageFetcher**

Create `src/modules/geo/page-fetcher.ts`:

```ts
import { Injectable } from '@nestjs/common';

export interface FetchedPage {
  url: string;
  html: string;
  robotsTxt: string | null;
  llmsTxt: string | null;
}

const USER_AGENT = 'GEO-Audit-Bot/1.0 (+https://example.com/bot)';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;

@Injectable()
export class PageFetcher {
  async fetch(url: string): Promise<FetchedPage> {
    const origin = new URL(url).origin;
    const [html, robotsTxt, llmsTxt] = await Promise.all([
      this.getText(url),
      this.getText(`${origin}/robots.txt`),
      this.getText(`${origin}/llms.txt`),
    ]);
    if (html === null) {
      throw new Error(`Could not fetch ${url}`);
    }
    return { url, html, robotsTxt, llmsTxt };
  }

  // Returns the body text, or null on any non-2xx / network / timeout error.
  private async getText(target: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(target, {
        headers: { 'user-agent': USER_AGENT },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const text = await res.text();
      return text.slice(0, MAX_BYTES);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- page-fetcher`
Expected: PASS.

- [ ] **Step 5: Propose commit**

```bash
git add src/modules/geo/page-fetcher.ts src/modules/geo/page-fetcher.spec.ts
git commit -m "feat(geo): add PageFetcher for homepage, robots.txt and llms.txt"
```

---

### Task 6: AuditRunner

Combines the fetcher and the checks into a list of findings.

**Files:**
- Create: `src/modules/geo/audit-runner.ts`
- Test: `src/modules/geo/audit-runner.spec.ts`

**Interfaces:**
- Consumes: `PageFetcher.fetch` (Task 5), `ALL_CHECKS` (Task 4), `Finding` (Task 1).
- Produces: `class AuditRunner { run(url: string): Promise<Finding[]> }` (NestJS `@Injectable`, constructor-injects `PageFetcher`).

- [ ] **Step 1: Write the failing test**

Create `src/modules/geo/audit-runner.spec.ts`:

```ts
import { AuditRunner } from './audit-runner';
import { PageFetcher } from './page-fetcher';

describe('AuditRunner', () => {
  it('runs every check against the fetched page', async () => {
    const fetcher = {
      fetch: jest.fn().mockResolvedValue({
        url: 'https://x.com',
        html: '<html><body>hello world</body></html>',
        robotsTxt: 'User-agent: *\nDisallow:',
        llmsTxt: null,
      }),
    } as unknown as PageFetcher;

    const findings = await new AuditRunner(fetcher).run('https://x.com');

    expect(fetcher.fetch).toHaveBeenCalledWith('https://x.com');
    expect(findings.map((f) => f.dimension)).toEqual(
      expect.arrayContaining([
        'ai-crawler-access',
        'structured-data',
        'core-metadata',
        'client-rendering',
        'basic-authority',
        'llms-txt',
      ]),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- audit-runner`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement AuditRunner**

Create `src/modules/geo/audit-runner.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { load } from 'cheerio';
import { ALL_CHECKS } from './checks';
import { Finding, PageContext } from './geo.types';
import { PageFetcher } from './page-fetcher';

@Injectable()
export class AuditRunner {
  constructor(private readonly fetcher: PageFetcher) {}

  async run(url: string): Promise<Finding[]> {
    const page = await this.fetcher.fetch(url);
    const ctx: PageContext = {
      url: page.url,
      html: page.html,
      $: load(page.html),
      robotsTxt: page.robotsTxt,
      llmsTxt: page.llmsTxt,
    };
    return ALL_CHECKS.map((check) => check.run(ctx));
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- audit-runner`
Expected: PASS.

- [ ] **Step 5: Propose commit**

```bash
git add src/modules/geo/audit-runner.ts src/modules/geo/audit-runner.spec.ts
git commit -m "feat(geo): add AuditRunner combining fetch and checks"
```

---

### Task 7: Prisma model + migration + tenant scoping

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<generated>/migration.sql`
- Modify: `src/core/prisma/tenant-scope.extension.ts:8`

**Interfaces:**
- Produces: Prisma `Audit` model and `AuditStatus` enum; `Audit` in `TENANT_MODELS`.

- [ ] **Step 1: Add the model to the schema**

In `prisma/schema.prisma`, append:

```prisma
enum AuditStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

// A GEO audit of a single URL's homepage. Runs async; findings are filled in by
// the worker. Tenant-scoped (see tenant-scope.extension.ts).
model Audit {
  id            String      @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  tenantId      String      @map("tenant_id") @db.Uuid
  requestedById String      @map("requested_by_id") @db.Uuid
  url           String
  status        AuditStatus @default(PENDING)
  findings      Json?
  error         String?
  fetchedAt     DateTime?   @map("fetched_at") @db.Timestamptz(6)
  createdAt     DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, createdAt])
  @@map("audits")
}
```

> Match the existing models' id/uuid and `@db.Timestamptz(6)` conventions — copy the exact `@default(dbgenerated(...))` used by the `File` model in this schema if it differs from the above.

- [ ] **Step 2: Create the migration**

Run: `pnpm prisma migrate dev --name add_audits`
Expected: a new migration is created and applied; `pnpm prisma generate` runs.

- [ ] **Step 3: Add `Audit` to the tenant model set**

In `src/core/prisma/tenant-scope.extension.ts`, change:

```ts
const TENANT_MODELS = new Set<string>(['File']);
```
to:
```ts
const TENANT_MODELS = new Set<string>(['File', 'Audit']);
```

- [ ] **Step 4: Verify build + drift**

Run: `pnpm build && pnpm prisma migrate diff --exit-code --from-url "$DATABASE_URL" --to-schema-datamodel ./prisma/schema.prisma`
Expected: build PASS; drift check prints "No difference detected." (exit 0).

- [ ] **Step 5: Propose commit**

```bash
git add prisma/schema.prisma prisma/migrations src/core/prisma/tenant-scope.extension.ts
git commit -m "feat(geo): add tenant-scoped audits table"
```

---

### Task 8: AuditsService, DTOs, controller

**Files:**
- Create: `src/modules/geo/dto/create-audit.dto.ts`
- Create: `src/modules/geo/dto/audit.response.ts`
- Create: `src/modules/geo/audits.service.ts` (+ `.spec.ts`)
- Create: `src/modules/geo/audits.controller.ts`

**Interfaces:**
- Consumes: `TENANT_PRISMA` / `TenantPrismaClient` (`src/core/prisma/prisma.module`), `JobsService` (`src/core/jobs/jobs.service`), `GEO_AUDIT_QUEUE`/`GeoAuditJobData` (Task 1), `ListQuery`/`Page` (`src/core/common/pagination`), `CurrentUser`/`AuthenticatedUser`/`JwtAuthGuard` (`src/modules/auth`).
- Produces: `AuditsService { create(url, requestedById): Promise<Audit>; findOne(id): Promise<Audit>; list(query): Promise<Page<Audit>> }`.

- [ ] **Step 1: Write the DTOs**

Create `src/modules/geo/dto/create-audit.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class CreateAuditDto {
  @ApiProperty({ example: 'https://example.com' })
  @IsUrl({ require_protocol: true })
  url!: string;
}
```

Create `src/modules/geo/dto/audit.response.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Audit } from '@prisma/client';
import { Finding } from '../geo.types';

// Concrete class for Swagger; runtime value is mapped from the Prisma row.
export class AuditResponse {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] })
  status!: string;
  @ApiProperty({ type: 'array', items: { type: 'object' }, nullable: true })
  findings!: Finding[] | null;
  @ApiProperty({ nullable: true }) error!: string | null;
  @ApiProperty() createdAt!: Date;

  static from(a: Audit): AuditResponse {
    return {
      id: a.id,
      url: a.url,
      status: a.status,
      findings: (a.findings as unknown as Finding[] | null) ?? null,
      error: a.error,
      createdAt: a.createdAt,
    };
  }
}
```

- [ ] **Step 2: Write the failing service test**

Create `src/modules/geo/audits.service.spec.ts`:

```ts
import { AuditsService } from './audits.service';
import { GEO_AUDIT_QUEUE } from './geo.constants';

describe('AuditsService', () => {
  const prisma = { audit: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() } };
  const send = jest.fn();
  const jobs = { client: { send } };

  const service = new AuditsService(
    prisma as never,
    jobs as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('creates a PENDING audit and enqueues a job', async () => {
    prisma.audit.create.mockResolvedValue({ id: 'a1', tenantId: 't1', status: 'PENDING' });

    const audit = await service.create('https://x.com', 'u1');

    expect(prisma.audit.create).toHaveBeenCalledWith({
      data: { url: 'https://x.com', requestedById: 'u1' },
    });
    expect(send).toHaveBeenCalledWith(GEO_AUDIT_QUEUE, { auditId: 'a1', tenantId: 't1' });
    expect(audit.id).toBe('a1');
  });

  it('throws NotFound when an audit is not in the tenant', async () => {
    prisma.audit.findFirst.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow('Audit not found');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test -- audits.service`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the service**

Create `src/modules/geo/audits.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Audit } from '@prisma/client';
import { ListQuery, Page, parseSort } from '../../core/common/pagination';
import { JobsService } from '../../core/jobs/jobs.service';
import { TENANT_PRISMA, TenantPrismaClient } from '../../core/prisma/prisma.module';
import { GEO_AUDIT_QUEUE, GeoAuditJobData } from './geo.constants';

const SORTABLE_FIELDS = ['createdAt', 'url', 'status'] as const;

@Injectable()
export class AuditsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly jobs: JobsService,
  ) {}

  // tenantId is injected into the create by the tenant-scope extension (request
  // context is set by TenantContextInterceptor), and read back for the job.
  async create(url: string, requestedById: string): Promise<Audit> {
    const audit = await this.prisma.audit.create({ data: { url, requestedById } });
    const payload: GeoAuditJobData = { auditId: audit.id, tenantId: audit.tenantId };
    await this.jobs.client.send(GEO_AUDIT_QUEUE, payload);
    return audit;
  }

  async findOne(id: string): Promise<Audit> {
    const audit = await this.prisma.audit.findFirst({ where: { id } });
    if (!audit) throw new NotFoundException('Audit not found');
    return audit;
  }

  async list(query: ListQuery): Promise<Page<Audit>> {
    const where = query.search
      ? { url: { contains: query.search, mode: 'insensitive' as const } }
      : {};
    const rows = await this.prisma.audit.findMany({
      where,
      orderBy: parseSort(query.sort, SORTABLE_FIELDS, { field: 'createdAt', order: 'desc' }),
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test -- audits.service`
Expected: PASS.

- [ ] **Step 6: Implement the controller**

Create `src/modules/geo/audits.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ListQuery, Page } from '../../core/common/pagination';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditsService } from './audits.service';
import { AuditResponse } from './dto/audit.response';
import { CreateAuditDto } from './dto/create-audit.dto';

@ApiTags('audits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audits')
export class AuditsController {
  constructor(private readonly audits: AuditsService) {}

  @Post()
  @HttpCode(202) // accepted; runs asynchronously, poll GET /audits/:id
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAuditDto,
  ): Promise<AuditResponse> {
    return AuditResponse.from(await this.audits.create(dto.url, user.userId));
  }

  @Get()
  async list(@Query() query: ListQuery): Promise<Page<AuditResponse>> {
    const page = await this.audits.list(query);
    return { items: page.items.map(AuditResponse.from), nextCursor: page.nextCursor };
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AuditResponse> {
    return AuditResponse.from(await this.audits.findOne(id));
  }
}
```

- [ ] **Step 7: Build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 8: Propose commit**

```bash
git add src/modules/geo/audits.service.* src/modules/geo/audits.controller.ts src/modules/geo/dto
git commit -m "feat(geo): add audits service, DTOs and controller"
```

---

### Task 9: GEO worker + module wiring

**Files:**
- Create: `src/modules/geo/geo-audit.worker.ts`
- Create: `src/modules/geo/geo.module.ts`
- Modify: `src/app.module.ts` (import `GeoModule`)

**Interfaces:**
- Consumes: `JobsService`, `AuditRunner`, `TENANT_PRISMA`/`TenantPrismaClient`, `TenantContext` (`src/core/tenancy/tenant-context`), `GEO_AUDIT_QUEUE`/`GeoAuditJobData`.
- Produces: `GeoAuditWorker` (implements `OnApplicationBootstrap`), `GeoModule`.

- [ ] **Step 1: Implement the worker**

Create `src/modules/geo/geo-audit.worker.ts`:

```ts
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { JobsService } from '../../core/jobs/jobs.service';
import { TENANT_PRISMA, TenantPrismaClient } from '../../core/prisma/prisma.module';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { AuditRunner } from './audit-runner';
import { GEO_AUDIT_QUEUE, GeoAuditJobData } from './geo.constants';

@Injectable()
export class GeoAuditWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(GeoAuditWorker.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly runner: AuditRunner,
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
  ) {}

  // Registered on bootstrap (after JobsService started pg-boss on module init).
  async onApplicationBootstrap(): Promise<void> {
    const boss = this.jobs.client;
    await boss.createQueue(GEO_AUDIT_QUEUE);
    await boss.work<GeoAuditJobData>(GEO_AUDIT_QUEUE, ([job]) => this.handle(job));
  }

  private async handle(job: PgBoss.Job<GeoAuditJobData>): Promise<void> {
    const { auditId, tenantId } = job.data;
    // The tenant-scope extension fails closed, so all Audit access runs in context.
    await TenantContext.run(tenantId, async () => {
      const audit = await this.prisma.audit.findFirst({ where: { id: auditId } });
      if (!audit) return;
      await this.prisma.audit.update({
        where: { id: auditId },
        data: { status: 'PROCESSING' },
      });
      try {
        const findings = await this.runner.run(audit.url);
        await this.prisma.audit.update({
          where: { id: auditId },
          data: { status: 'COMPLETED', findings, fetchedAt: new Date() },
        });
      } catch (err) {
        this.logger.error(`Audit ${auditId} failed`, err instanceof Error ? err.stack : err);
        await this.prisma.audit.update({
          where: { id: auditId },
          data: {
            status: 'FAILED',
            error: err instanceof Error ? err.message : 'Audit failed',
          },
        });
      }
    });
  }
}
```

> Confirm the exact `boss.work` handler signature against the installed `pg-boss` version and the existing `refresh-token-cleanup.job.ts` usage; adjust the `([job]) =>` destructuring if that file uses a different shape.

- [ ] **Step 2: Write the module**

Create `src/modules/geo/geo.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuditRunner } from './audit-runner';
import { AuditsController } from './audits.controller';
import { AuditsService } from './audits.service';
import { GeoAuditWorker } from './geo-audit.worker';
import { PageFetcher } from './page-fetcher';

@Module({
  controllers: [AuditsController],
  providers: [AuditsService, AuditRunner, PageFetcher, GeoAuditWorker],
})
export class GeoModule {}
```

- [ ] **Step 3: Register in AppModule**

In `src/app.module.ts`, add `GeoModule` to the `imports` array (and its import line), following the existing module imports (e.g. next to `FilesModule`).

- [ ] **Step 4: Build + boot the real binary**

Run: `pnpm build && node dist/main.js` (Ctrl-C after it logs "listening"). Confirm no bootstrap errors (queue registers cleanly).
Expected: process starts and listens; no pg-boss/DI errors.

- [ ] **Step 5: Propose commit**

```bash
git add src/modules/geo/geo-audit.worker.ts src/modules/geo/geo.module.ts src/app.module.ts
git commit -m "feat(geo): add audit worker and wire up the module"
```

---

### Task 10: End-to-end test

**Files:**
- Create: `test/modules/geo.e2e-spec.ts`

**Interfaces:**
- Consumes: the running app (`AppModule` + `configureApp`), the audits endpoints.

- [ ] **Step 1: Write the e2e**

Create `test/modules/geo.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/core/bootstrap/configure-app';
import { Env } from '../../src/core/config/env.validation';

describe('GEO audits (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let fixture: Server;
  let fixtureUrl: string;
  let tokenA = '';

  const uid = () => `${Math.random().toString(36).slice(2)}@geo.test`;

  beforeAll(async () => {
    fixture = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<html><head><title>Acme AI widgets for teams</title></head><body><main>Acme builds AI widgets.</main></body></html>');
    });
    await new Promise<void>((r) => fixture.listen(0, '127.0.0.1', r));
    fixtureUrl = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get(ConfigService<Env, true>));
    await app.init();
    server = app.getHttpServer() as Server;

    tokenA = (await request(server).post('/v1/auth/register').send({ email: uid(), password: 'password123' })).body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((r) => fixture.close(() => r()));
  });

  async function poll(id: string, token: string) {
    for (let i = 0; i < 30; i++) {
      const res = await request(server).get(`/v1/audits/${id}`).set('Authorization', `Bearer ${token}`);
      if (['COMPLETED', 'FAILED'].includes(res.body.data.status)) return res.body.data;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('audit did not complete in time');
  }

  it('runs an audit asynchronously and returns findings', async () => {
    const created = await request(server)
      .post('/v1/audits')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ url: fixtureUrl });
    expect(created.status).toBe(202);
    expect(created.body.data.status).toBe('PENDING');

    const done = await poll(created.body.data.id, tokenA);
    expect(done.status).toBe('COMPLETED');
    expect(done.findings.map((f: { dimension: string }) => f.dimension)).toContain('core-metadata');
  });

  it("isolates one tenant's audits from another", async () => {
    const created = await request(server)
      .post('/v1/audits')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ url: fixtureUrl });
    const id = created.body.data.id;

    const tokenB = (await request(server).post('/v1/auth/register').send({ email: uid(), password: 'password123' })).body.data.accessToken;
    const asB = await request(server).get(`/v1/audits/${id}`).set('Authorization', `Bearer ${tokenB}`);
    expect(asB.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the e2e**

Run: `pnpm test:e2e -- geo`
Expected: PASS (both tests). If pg-boss timing is flaky, confirm `test/jest-e2e.json` still sets `maxWorkers: 1`.

- [ ] **Step 3: Propose commit**

```bash
git add test/modules/geo.e2e-spec.ts
git commit -m "test(geo): e2e for async audit run and tenant isolation"
```

---

### Task 11: Document the endpoints for the frontend

**Files:**
- Modify: `docs/frontend-integration.md`

- [ ] **Step 1: Add an audits section**

In `docs/frontend-integration.md`, add under the endpoint reference:

```markdown
GEO audits (auth required; async):

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/audits` | `{ url }` → `202` with an audit in `PENDING`. Runs in the background. |
| GET | `/v1/audits/:id` | Poll until `status` is `COMPLETED` or `FAILED`, then render `findings`. `:id` must be a UUID. |
| GET | `/v1/audits` | History — supports `limit/cursor/sort/search` like files. |

Each finding: `{ dimension, title, status: 'ok'|'needs_work', summary, detail, recommendation, basis, strength: 'hard'|'advisory' }`.
Poll ~every 1–2s; a typical audit completes in a few seconds.
```

- [ ] **Step 2: Propose commit**

```bash
git add docs/frontend-integration.md
git commit -m "docs: document the GEO audit endpoints for the frontend"
```

---

## Final verification

- [ ] `pnpm ci:local` passes end to end (lint, format, typecheck, build, migrations + drift, unit, e2e).
- [ ] Manual smoke: boot the app, register, `POST /v1/audits { url: "https://<some real site>/" }`, poll `GET /v1/audits/:id` until `COMPLETED`, eyeball the findings.
