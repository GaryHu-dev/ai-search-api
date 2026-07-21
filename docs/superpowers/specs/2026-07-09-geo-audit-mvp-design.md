# GEO Audit — MVP Design

## Purpose

A GEO (Generative Engine Optimization) audit tool. A signed-in user enters a
website URL and gets back a diagnosis of how well the site's **homepage** is set
up to be found, read, and cited by AI answer engines (ChatGPT, Perplexity,
Google AI Overviews, Gemini), together with concrete fixes. This is the first
product built on the SaaS foundation.

Deliberately **not** in the MVP: a numeric "GEO score" (no agreed industry
standard exists, so a score would be invented — every finding cites a real basis
instead), ongoing monitoring, and competitor comparison.

## Scope (MVP)

- **Input:** a single URL, treated as the site's homepage.
- **Analysed:** the homepage HTML plus the domain's `/robots.txt` and
  `/llms.txt`.
- **Login-gated:** only authenticated users run audits; results are
  tenant-scoped and saved to history.
- **Asynchronous:** `POST` enqueues the audit as a pg-boss background job and
  returns immediately; the web app polls the audit until it is ready. Reports are
  not instant, and this keeps the door open for the slower AI checks later.
- **No AI / no external API:** every check is deterministic code. The AI layer is
  a deferred, additive upgrade.
- **No new infrastructure:** background jobs run on the existing pg-boss
  (Postgres). No Redis.

## Checks (dimensions)

All deterministic. Each produces a **Finding** carrying its evidence `basis` and
a `strength` label — `hard` (a first-party fact or established standard) or
`advisory` (best practice). This is the credibility promise: judgements are
evidenced, not asserted.

1. **AI crawler access** (`hard`) — parse `/robots.txt`; report whether GPTBot,
   ClaudeBot, PerplexityBot and Google-Extended are allowed or blocked.
   *Basis:* each vendor's published crawler documentation.
2. **Client-side rendering** (`hard`) — from the raw HTML, detect whether the
   main content is present server-side or depends on JavaScript (a near-empty
   `<body>` with a single mount element and bulk `<script>` tags signals
   client-side rendering). *Basis:* AI crawlers largely do not execute JavaScript.
3. **Structured data** (`hard`) — detect `schema.org` JSON-LD and report the
   types present (Organization, Product, FAQ, Article, …).
   *Basis:* Schema.org and Google structured-data guidelines.
4. **Core metadata** (`hard`) — presence and sensible length of `<title>` and
   `<meta name="description">`, and presence of the core Open Graph tags.
   *Basis:* standard web metadata that engines consume.
5. **llms.txt** (`hard`) — request `/llms.txt`; report presence.
   *Basis:* the llmstxt.org proposal (flagged as emerging / low-authority).
6. **Basic authority signals** (`advisory`) — detect author/date markup and a
   sitemap. *Basis:* Google's E-E-A-T guidance (authorship, freshness).

## Finding shape

`{ dimension, status, summary, detail, recommendation, basis, strength }`

- `status`: `ok` | `needs_work`.
- `recommendation` is **Level 2** — specific advice plus a template or the exact
  line to change (the robots.txt directive to add, a schema.org JSON-LD template,
  an `llms.txt` example). No AI-generated, site-tailored content in the MVP.

## Data model

One new tenant-scoped table, `audits`:

- `id` (uuidv7), `tenantId`, `requestedById` (user), `url`,
  `status` (`pending` | `processing` | `completed` | `failed`),
  `findings` (JSONB, null until complete), `error` (nullable), `fetchedAt`
  (nullable), `createdAt`.
- Registered in the tenant-scope extension (`TENANT_MODELS` gains `Audit`), so
  it inherits automatic isolation and the fail-closed guarantee.

## API

All auth-required and tenant-scoped:

- `POST /v1/audits { url }` — create the audit (`pending`) and enqueue a pg-boss
  job; returns `202` with the audit id immediately.
- `GET /v1/audits/:id` — one audit; the client **polls** this until `status`
  becomes `completed` (or `failed`), then renders the report.
- `GET /v1/audits` — the caller's audit history. Reuses `ListQuery`
  (limit/cursor/sort/search).

## Architecture

- New feature module `src/modules/geo/` owning the `audits` resource
  (controller, service, DTOs).
- **Async flow.** The service creates the `pending` audit and enqueues a pg-boss
  job (a dedicated queue, registered on `onApplicationBootstrap` like the
  existing cleanup job). The worker sets `processing`, runs the audit, and writes
  `completed` + `findings` (or `failed` + `error`). Because the tenant-scope
  extension fails closed, the worker sets the tenant context
  (`TenantContext.run`) around its DB writes.
- **Pluggable checks.** A `GeoCheck` interface — `run(context): Finding` — where
  `context` holds the fetched homepage (raw HTML plus a parsed DOM/text view),
  `robots.txt`, and `llms.txt`. The worker fetches once, runs every registered
  check, and aggregates the findings. Adding a dimension (including a future
  AI-backed one) means adding a `GeoCheck`; the pipeline is untouched.
- A small `PageFetcher` performs the HTTP fetches (homepage + robots + llms) with
  a timeout and a declared user-agent. No headless browser in the MVP —
  JavaScript rendering is inferred from the markup, not by rendering the page.

## Frontend

A page in the React validation app: a URL input and "Run audit" button → a
"processing" state that polls the audit until it is ready → a results view
(findings grouped by dimension, each showing status, current state,
recommendation, and basis + strength). The user can navigate away and come back;
a completed audit surfaces a "report ready" cue. Plus a history list of past
audits with a re-run action.

## Testing

- **Unit** per check: feed fixture HTML / robots / llms and assert the finding.
  Deterministic checks are cheap to test exhaustively.
- **e2e:** an authenticated `POST /v1/audits` against a served fixture page, then
  poll `GET /v1/audits/:id` until `completed`; assert the findings, persistence,
  and tenant scoping (another tenant cannot read it). The worker runs in-process
  during tests, as the existing job e2e already relies on.

## Explicitly deferred (additive, no rework)

- AI-judged dimensions (content quality, entity clarity, deeper authority) and
  Level-3 site-tailored fix generation — needs the Anthropic API.
- Full-site crawl across multiple pages.
- Export / shareable report / PDF.
- Scoring, ongoing monitoring, competitor comparison.
- A public (unauthenticated) "try one free" hook.
