# 0004 — Soft delete by default, hard delete for privacy

Status: Accepted

## Context

Business records benefit from being recoverable and auditable, but personal data
must be genuinely erasable to meet Australian (Privacy Act 1988) and New Zealand
(Privacy Act 2020) obligations.

## Decision

- Tenant/user rows carry a nullable `deletedAt` timestamp. Deleting sets it;
  it is not a physical delete.
- Soft-deleted users cannot authenticate — both login and refresh reject them.
- Personal data still supports **hard deletion / anonymisation** for verified
  erasure requests. Cascade foreign keys make deleting a user or tenant remove
  its dependent rows.
- **Audit logs have no foreign keys** (`audit_logs`), so the "who did what"
  history survives even a hard delete of the subject.

## Consequences

- Everyday deletes are reversible and leave an audit trail.
- There is an explicit, separate path for irreversible erasure when the law
  requires it, rather than conflating the two.
- `deletedAt` is a plain column, so every tenant-scoped query must remember to
  exclude soft-deleted rows where relevant (helpers like
  `UsersService.getActiveById` centralise this).
