# 0002 — Multi-tenancy: account = tenant, with a Tenant table

Status: Accepted

## Context

The first product starts with simple self-service accounts; a company using it
initially shares a single account. But "one company, many member accounts,
shared data" is a likely future need, and retrofitting tenancy onto a live
schema is one of the most painful migrations there is.

## Decision

Introduce a real `Tenant` table from day one, even though today it is 1 tenant :
1 user. All tenant-owned data carries a `tenantId` foreign key to `Tenant`
(never to the user).

- Today: registering creates a tenant and its first user together.
- Later: adding more users to a tenant is additive — no data moves, because
  business data already belongs to the tenant, not the user.

Supporting choices:

- UUIDv7 primary keys (`@db.Uuid`) — non-guessable and time-ordered.
- A `(tenantId, createdAt)` composite index on tenant-scoped tables from the
  start; cheap now, painful to add at scale.
- **Tenant filtering is automatic.** A per-request `AsyncLocalStorage`
  (`TenantContext`, set by `TenantContextInterceptor` from the JWT's tenant) plus
  a Prisma client extension (`tenantScopeExtension`) inject the `tenantId` filter
  into reads/updates/deletes and the value into creates for tenant-owned models.
  Feature code injects the tenant-scoped client (`TENANT_PRISMA`) and writes no
  `where: { tenantId }` — so it can't be forgotten. Adding a tenant-owned model
  means adding it to one list (`TENANT_MODELS`). Postgres RLS is the intended
  fail-closed backstop (not yet added).

## Consequences

- Negligible cost now; no rebuild when multi-user organisations arrive.
- The management surface (invite members, roles) is deferred — see
  [0009](0009-deferred-capabilities.md).

## Alternatives considered

- **User as tenant** (`tenantId = userId`): simplest, but growing to teams needs
  a genuine data migration. Rejected.
- **Schema- or database-per-tenant**: stronger isolation, heavy operations.
  Rejected for this stage.
