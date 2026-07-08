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
