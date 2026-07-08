# 0008 — Background jobs on pg-boss (no Redis)

Status: Accepted

## Context

We need background and scheduled work (e.g. cleaning up expired tokens) without
adding infrastructure. The stack deliberately excludes Redis.

## Decision

Use **pg-boss**, which stores its queues in the same PostgreSQL database.

- `JobsService` owns the pg-boss lifecycle; each job class registers its own
  queue, worker, and schedule on startup.
- Workers run **in-process** at current scale.
- First real job: a daily purge of expired/revoked refresh tokens (not a demo).

## Consequences

- Zero extra infrastructure — one datastore.
- Job throughput is coupled to the primary database. Acceptable now; if jobs ever
  compete with request handling, the same queues can be drained by a **separate
  worker process** without changing how jobs are enqueued.
- e2e boot the app, which starts pg-boss (creating its schema), so e2e must run
  serially (`maxWorkers: 1`) to avoid a schema-creation race.
