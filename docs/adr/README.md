# Architecture Decision Records

Each ADR records one significant decision: its context, the decision, and the
consequences. They exist so the *why* behind the code is durable and reviewable
— especially where we deliberately diverge from common patterns.

Format: short. Status is `Accepted` unless noted. Superseding decisions get a
new ADR that references the old one rather than editing history.

| # | Decision |
| --- | --- |
| [0001](0001-prisma-no-repository.md) | Prisma directly, no repository layer |
| [0002](0002-multi-tenancy.md) | Multi-tenancy: account = tenant, with a Tenant table |
| [0003](0003-auth-token-strategy.md) | Auth and token strategy |
| [0004](0004-soft-delete-privacy.md) | Soft delete by default, hard delete for privacy |
| [0005](0005-directory-structure.md) | Directory structure (core / modules / integrations) |
| [0006](0006-response-envelopes.md) | Consistent response and error envelopes |
| [0007](0007-observability.md) | Observability (OpenTelemetry + Sentry + Pino) |
| [0008](0008-background-jobs-pg-boss.md) | Background jobs on pg-boss (no Redis) |
| [0009](0009-deferred-capabilities.md) | Deliberately deferred capabilities (YAGNI) |
