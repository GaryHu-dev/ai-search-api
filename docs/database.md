# Database

PostgreSQL 17 via Prisma. Schema in `prisma/schema.prisma`, migrations in
`prisma/migrations`.

## Conventions

- **Primary keys**: UUIDv7 (`@default(uuid(7)) @db.Uuid`) — non-guessable and
  time-ordered (good index locality).
- **Timestamps**: `@db.Timestamptz(6)` (timezone-aware).
- **Soft delete**: nullable `deletedAt` on tenant/user rows
  ([ADR-0004](adr/0004-soft-delete-privacy.md)).
- **Tenant scoping**: tenant-owned rows carry `tenantId`; high-volume tables get
  a `(tenantId, createdAt)` composite index.

## Tables

| Table | Purpose |
| --- | --- |
| `tenants` | Customer boundary; business data hangs off this |
| `users` | Accounts (unique email); lockout + soft-delete columns |
| `login_methods` | Password / Google credentials per user |
| `refresh_tokens` | Hashed, rotating refresh tokens |
| `audit_logs` | Append-only action history (no FKs) |
| `files` | Object-storage metadata, tenant-scoped |

## Workflow

```bash
pnpm prisma:migrate         # create + apply a migration (dev)
pnpm prisma migrate deploy  # apply migrations (CI/prod)
pnpm prisma:generate        # regenerate the client
pnpm db:seed                # idempotent demo tenant + account (dev)
```

The Prisma client lifecycle is owned by `PrismaService` (connects on boot, so a
bad `DATABASE_URL` fails at startup; disconnects on shutdown). pg-boss keeps its
own `pgboss` schema in the same database.
