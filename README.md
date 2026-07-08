# SaaS API

A business-agnostic SaaS foundation built with NestJS. The first product built
on top of it is an AI Search platform, but this codebase deliberately keeps no
knowledge of that domain — the aim is a small, boring, well-understood base that
future products can sit on.

## Stack

- **Runtime:** Node.js 24 LTS
- **Framework:** NestJS 11 (TypeScript)
- **Database:** PostgreSQL 17 via Prisma
- **Logging:** Pino (structured JSON, one correlation id per request)
- **Docs:** Swagger / OpenAPI
- **Package manager:** pnpm

## Prerequisites

- Node.js 24+ (`.nvmrc` pins the major version)
- pnpm
- Docker (for a local PostgreSQL)

## Getting started

```bash
pnpm install
cp .env.example .env          # adjust if needed; validated at startup
pnpm services:up              # start PostgreSQL + MinIO in Docker
pnpm prisma:migrate           # apply migrations (generates the client too)
pnpm start:dev                # http://localhost:3000
```

`services:up` starts PostgreSQL and MinIO (object storage). Background jobs run
in-process via pg-boss on the same database — no extra service needed. The MinIO
console is at http://localhost:9001 (minioadmin / minioadmin).

Once running:

- API docs (non-production only): http://localhost:3000/docs
- Liveness probe: http://localhost:3000/health/live
- Readiness probe: http://localhost:3000/health/ready

## Project layout

Business features live under `src/modules/`; cross-cutting infrastructure under
`src/core/`; adapters to external services under `src/integrations/`.

```
src/
  modules/                 Business features
    auth/    Registration, login (password + Google), tokens, lockout
    users/   The caller's own account: read, update, soft-delete
    files/   Upload/list/download/delete, tenant-scoped
  core/                    Cross-cutting infrastructure
    bootstrap/ configure*(app) — composed by main.ts, reused by e2e
    audit/     Append-only audit log (who did what, when)
    common/    filters, interceptors, decorators, utils, pagination
    config/    Environment validation (fails fast) and the config module
    health/    Liveness and readiness probes
    jobs/      Background jobs (pg-boss); e.g. refresh-token cleanup
    logger/    Pino with a per-request correlation id
    prisma/    Prisma client lifecycle + tenant-scope extension
    tenancy/   Per-request tenant context (automatic isolation)
  integrations/            External-service adapters
    google/    Google ID-token verification
    storage/   S3-compatible object storage (MinIO locally, R2 in production)
  app.module.ts
  main.ts                  Thin: otel/sentry, create app, configureApp, listen
prisma/
  schema.prisma
  migrations/
```

Each module owns its controllers, services, and DTOs (request and response
classes both under its `dto/`).

## Documentation

Full docs live in [`docs/`](docs/):

- [Architecture](docs/architecture.md) · [Security](docs/security.md) ·
  [Database](docs/database.md) · [Deployment](docs/deployment.md)
- [API conventions](docs/api.md) · [Coding style](docs/coding-style.md) ·
  [Contributing](docs/contributing.md) · [Troubleshooting](docs/troubleshooting.md)
- [Architecture Decision Records](docs/adr/README.md) — the *why* behind the
  key choices.

## Conventions

These are deliberate and worth knowing before adding code:

- **Multi-tenancy from day one.** Tenant-owned rows carry a `tenant_id`, and
  tenant filtering is applied automatically rather than by hand. Isolation is a
  property of the data model, not a feature to add later.
- **No repository layer.** Prisma is the data-access layer. Services use it
  directly; we do not wrap it in repositories or a `BaseService`.
- **API versioning** is on from the first endpoint (`/v1/...`). Health checks
  are intentionally unversioned.
- **Soft delete by default** for business records (`deleted_at`); personal data
  supports hard deletion to meet AU/NZ privacy obligations.
- **Config is validated at boot.** A missing or malformed variable stops the
  process instead of failing later at runtime.
- **Consistent response envelopes.** Success responses are wrapped as
  `{ data, requestId }`; errors as `{ statusCode, error, message, requestId,
  path, timestamp }`. Binary downloads and health probes opt out via
  `@SkipResponseEnvelope()`.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm start:dev` | Run with hot reload |
| `pnpm build` | Compile to `dist/` |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | End-to-end tests (needs the database up) |
| `pnpm lint` | Lint and auto-fix |
| `pnpm db:up` / `pnpm db:down` | Start / stop the local database |
| `pnpm prisma:migrate` | Create and apply a migration |
