# Security

See also [ADR-0003 (auth)](adr/0003-auth-token-strategy.md) and
[ADR-0004 (privacy)](adr/0004-soft-delete-privacy.md).

## Authentication

- Email + password (argon2id) and Google (ID-token verification).
- Access token: short-lived JWT (`JWT_ACCESS_TTL_SECONDS`, default 900s).
- Refresh token: opaque, stored as a SHA-256 hash, single-use with rotation and
  reuse-detection; revoked on logout. Revocation needs no Redis.
- Same email = same person; an account is separate from its login methods.

## Abuse protection

- **Rate limiting**: global `@nestjs/throttler` (100/min), tightened to 10/min on
  credential routes. In-memory today — a shared store is needed across replicas.
- **Account lockout**: after `LOGIN_MAX_ATTEMPTS` (default 5) failed logins, the
  account is locked for `LOGIN_LOCK_MINUTES` (default 15), returning 429.
- **Body size limit** (`BODY_LIMIT`, default 1 MB) and a request timeout
  (`REQUEST_TIMEOUT_MS`).

## Transport & headers

- `helmet` sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.
- **CORS**: `CORS_ORIGINS` (comma-separated) allow-list. Unset reflects the
  caller's origin (a dev convenience); startup fails if it is unset in production.
- **Trust proxy**: `TRUST_PROXY` must match the deployment topology. Behind
  Cloudflare / a load balancer, set it (e.g. a hop count) so rate-limit keys and
  logged IPs are the real client's, not the proxy's. Over-trusting lets callers
  forge `X-Forwarded-For`.

## Outbound requests / SSRF

The GEO audit feature (`modules/geo`) fetches **user-supplied URLs** server-side,
so it is a deliberate SSRF surface and is guarded accordingly by
`src/modules/geo/url-guard.ts`:

- **http(s) only** — any other scheme is rejected.
- **DNS-resolved allow-check**: the host is resolved and the fetch is refused if
  *any* returned address is non-public — loopback, private, link-local (incl.
  `169.254.169.254` cloud metadata), CGNAT, and multicast/reserved. Both IPv4 and
  IPv6 are covered, including IPv4-mapped (`::ffff:…`), IPv4-compat, and NAT64
  (`64:ff9b::/96`) forms, plus unique-local (`fc00::/7`) and IPv6 link-local.
- **Every redirect hop is re-validated**: the fetcher uses `redirect: 'manual'`
  and runs each `Location` target back through the guard before following it.
- **Streamed byte cap** (2 MB): the body is read incrementally and aborted once
  the cap is hit, so an oversized/malicious response can't buffer unbounded
  memory. A per-hop timeout covers the body read.
- **Content-type gate**: the homepage fetch requires `text/html`.

**Known residual (accepted):** the guard resolves DNS to validate, but the
subsequent `fetch` re-resolves the host, so a DNS-rebinding record (public at
validation, private at connect) is not fully closed. The code flags this;
IP-pinning the validated address via a custom undici dispatcher is the future
hardening.

`GEO_ALLOW_PRIVATE_URLS=true` disables the guard for **dev/test only**. Env
validation refuses to boot if it is `true` while `NODE_ENV=production` (see the
`superRefine` in `env.validation.ts`), so it can never turn the fetcher into an
internal proxy in production.

`POST /v1/audits` is throttled to **20/min per IP** and each tenant is capped at
**5 concurrent in-flight audits** (`PENDING`/`PROCESSING`); exceeding either
returns 429.

## Data protection & privacy

- Soft delete by default. The data model supports hard deletion / anonymisation
  of personal data (cascade foreign keys) for AU Privacy Act 1988 / NZ Privacy
  Act 2020 erasure requests — but no erasure endpoint is built yet, so erasure is
  a manual/DB-level operation for now
  ([ADR-0009](adr/0009-deferred-capabilities.md)).
- Audit log (`audit_logs`) records security-relevant actions (login, register,
  profile update, deletion, lockout) and survives hard deletes.
- Credentials are never logged (`authorization`/`cookie` headers are redacted);
  errors never leak internal details to clients.

## Tenant isolation

Tenant-owned data is scoped **automatically**: a per-request tenant context
(`AsyncLocalStorage`, set from the JWT) plus a Prisma extension inject the
`tenantId` filter into every read/update/delete on tenant models, so one tenant
can never see or modify another's data — even by id (verified end to end). Feature
code injects the tenant-scoped client (`TENANT_PRISMA`) and writes no
`where: { tenantId }`, so it can't be forgotten. The extension fails **closed**:
a tenant model reached with no tenant in context throws rather than returning
every tenant's rows, and `findUnique` (which can't be tenant-constrained) is
rejected on tenant models. Postgres RLS remains a planned database-level backstop
(deferred). See [ADR-0002](adr/0002-multi-tenancy.md).

## Supply chain & secrets

- `pnpm audit` (fails on high-severity prod vulns) runs locally via the
  pre-commit hook and `pnpm ci:local`. SAST (CodeQL) and container image scanning
  are deferred until closer to production
  ([ADR-0009](adr/0009-deferred-capabilities.md)).
- Dependabot keeps GitHub Actions and npm dependencies patched.
- Secrets come from the environment; `.env` is git-ignored and dev-only. A real
  secret store is a deployment-time concern
  ([ADR-0009](adr/0009-deferred-capabilities.md)).
- Rotate `JWT_ACCESS_SECRET` to invalidate all issued access tokens.
