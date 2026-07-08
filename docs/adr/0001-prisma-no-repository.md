# 0001 — Prisma directly, no repository layer

Status: Accepted

## Context

A common enterprise NestJS pattern wraps the ORM in repository interfaces so
services depend on abstractions, ostensibly for testability and the ability to
swap the persistence engine. It also adds a file and a layer per aggregate.

We are committed to PostgreSQL and Prisma, and value a small, boring codebase.

## Decision

Services use `PrismaService` directly. No repository interfaces, no
`BaseService`, no `BaseController`.

- Unit tests mock `PrismaService`.
- Integration/e2e tests run against a real PostgreSQL (Testcontainers-style,
  here a Docker Compose database), which is the only way to trust tenant
  scoping and constraints anyway.
- Tenant scoping is enforced by explicit `where` filters today, and will move to
  a Prisma client extension when there are enough tenant-scoped tables to
  justify it — not via a repository seam.

## Consequences

- Much less boilerplate; the data layer is Prisma, and everyone already knows it.
- Swapping the database engine later is harder. Accepted: it is a near-zero
  probability event for this product.
- We lose a "natural" place to centralise tenant filtering; the Prisma extension
  (see [0002](0002-multi-tenancy.md)) fills that role when needed.
