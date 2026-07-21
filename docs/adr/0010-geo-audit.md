# 0010 — GEO audit: async deterministic checks + SSRF-guarded fetch

Status: Accepted

## Context

The first product feature is a GEO (generative-engine optimisation) audit: given
a URL, fetch its homepage and report how well the site is set up for AI-search
visibility. This is the first code in the repo that reaches the outside network
on behalf of a user, and it fetches **untrusted, user-supplied URLs** server-side
— a deliberate SSRF surface. It also does real work (several outbound fetches per
run) that shouldn't block the request or be trivially abusable.

See the design spec:
[docs/superpowers/specs/2026-07-09-geo-audit-mvp-design.md](../superpowers/specs/2026-07-09-geo-audit-mvp-design.md).

## Decision

- **Async pipeline.** `POST /v1/audits` creates a `PENDING` audit and returns
  `202`; a pg-boss worker ([0008](0008-background-jobs-pg-boss.md)) runs it and
  the client polls `GET /v1/audits/:id`. The worker claims the row atomically
  (`PENDING → PROCESSING`) so a redelivery can't run it twice.
- **Pluggable deterministic checks.** Findings come from pure, deterministic
  checks (`modules/geo/checks`) over the fetched HTML/robots/llms — no AI scoring
  yet. New checks are added by dropping in a function.
- **SSRF-guarded fetcher.** `url-guard.ts` allows http(s) only, DNS-resolves the
  host and blocks non-public addresses (loopback/private/link-local/CGNAT/cloud
  metadata, IPv4 and IPv6 incl. IPv4-mapped and NAT64), re-validates every
  redirect hop (`redirect: 'manual'`), caps the streamed body, and gates on
  content-type. See [security.md](../security.md).
- **Tenant-scoped audits.** The `audits` table carries `tenantId` and is read
  through `TENANT_PRISMA`, so audits are isolated like all other tenant data
  ([0002](0002-multi-tenancy.md)).
- **Self-healing + retention.** A scheduled reaper fails audits stuck in
  `PROCESSING` past a threshold (crashed worker); a retention sweep purges old
  audits and their scraped content.
- **Abuse limits.** `POST /v1/audits` is throttled to 20/min per IP and each
  tenant is capped at 5 concurrent in-flight audits (429 on exceed).

## Consequences / accepted residuals

- A soft-deleted user or tenant keeps access until its (~15-min) access token
  expires — a direct consequence of the stateless-token choice
  ([0003](0003-auth-token-strategy.md)); not fixed by design.
- **DNS-rebinding** between validation and connect is not fully closed: the guard
  resolves DNS to validate, but `fetch` re-resolves. IP-pinning the validated
  address via a custom undici dispatcher is deferred.
- **Per-tenant daily quota** and domain allow/deny lists are deferred (the
  in-flight cap and IP throttle are the interim controls).
- **AI-scored checks and full-site crawling** are deferred; the MVP is
  homepage-only with deterministic checks.
