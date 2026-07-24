# Architecture

Omniport is a multi-tenant platform on NestJS. The foundation — `core/`,
`integrations/`, plus the base modules `auth`, `users`, `files`,
`notifications` — is product-agnostic and knows nothing about any specific
product domain. Product modules live under `modules/` too; today that's
`geo`, the GEO site audit feature. Planned (roadmap, not yet built): SEO/GEO
content generation and publishing to WordPress/Shopify.

For the *why* behind these choices, see the [ADRs](adr/README.md).

## Layers

```
HTTP → Guards → Interceptors → ValidationPipe → Controller → Service → Prisma → PostgreSQL
                                                                   ↘ Integrations (storage)
```

There is no repository layer — services use Prisma directly ([ADR-0001](adr/0001-prisma-no-repository.md)).

## Request pipeline

1. **ThrottlerGuard** — global rate limit (tighter on credential routes).
2. **JwtAuthGuard** (on protected routes) — validates the access token, sets
   `request.user = { userId, tenantId, email }`.
3. **TenantContextInterceptor** — binds `request.user.tenantId` to the async
   context so the Prisma tenant-scope extension filters queries automatically.
4. **TimeoutInterceptor** — fails a handler that runs too long.
5. **ValidationPipe** — validates and transforms the body against its DTO.
6. **Controller → Service** — business logic; tenant-scoped queries.
7. **ResponseEnvelopeInterceptor** — wraps success as `{ data, requestId }`.
8. **AllExceptionsFilter** — renders any error as the error envelope.

Every request carries an `x-request-id`; it appears in logs, both envelopes, and
(when OpenTelemetry is on) alongside a `trace_id`.

## Folder structure

```
src/
  modules/        Business features: auth, users, files, geo, notifications
  core/           Infrastructure
    bootstrap/    configure*(app) — composed by main.ts and reused by e2e
    common/       filters, interceptors, decorators, utils, pagination
    tenancy/      per-request tenant context (automatic isolation)
    audit/ config/ health/ jobs/ logger/ prisma/
  integrations/   External-service adapters: storage (email later)
  app.module.ts
  main.ts
```

Google sign-in is not an `integrations/` adapter: it's Passport strategy code
that lives with the rest of auth, at
`modules/auth/strategies/google.strategy.ts` (guarded by
`modules/auth/google-auth.guard.ts`), since the OAuth redirect dance is
auth-specific rather than a generic external-service client.

Business features live under `modules/`; cross-cutting infrastructure under
`core/`; adapters to third-party services under `integrations/`
([ADR-0005](adr/0005-directory-structure.md)). Unit specs are co-located under
each directory's `__tests__/` folder (e2e stays under top-level `test/`).

## Tenancy

Account = tenant today, but a real `Tenant` table exists so "one company, many
members" is an additive change later ([ADR-0002](adr/0002-multi-tenancy.md)).
Tenant-owned rows carry `tenantId`, and filtering is **automatic**: a
per-request `TenantContext` (AsyncLocalStorage) plus a Prisma extension scope
every query on tenant models to the current tenant, so feature code can't leak
across tenants by forgetting a `where`. Inject `TENANT_PRISMA` for tenant data;
use the plain `PrismaService` for system/non-tenant work.

## Modules

| Module | Responsibility |
| --- | --- |
| `auth` | Register, login (password + Google), token issue/rotation, lockout |
| `users` | The caller's own account: read, update, soft-delete |
| `files` | Upload / list (paginated) / download / delete, tenant-scoped |
| `geo` | GEO audit: async homepage analysis of a user-supplied URL (SSRF-guarded fetch, deterministic checks) |
| `notifications` | Per-user notifications: list (paginated, filterable to unread), unread count, mark one/all read — tenant- and user-scoped |
| `core/health` | Liveness and readiness probes |
| `core/jobs` | Background jobs (pg-boss); refresh-token cleanup |
| `core/audit` | Append-only audit log |
| `integrations/storage` | S3-compatible object storage (MinIO / R2) |

## Data & observability

- PostgreSQL via Prisma; migrations in `prisma/migrations`. See
  [database.md](database.md).
- Structured Pino logs, OpenTelemetry traces/metrics, Sentry errors. See
  [ADR-0007](adr/0007-observability.md).
