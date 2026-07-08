# 0005 — Directory structure (core / modules / integrations)

Status: Accepted

## Context

NestJS's default is a flat `src/`. As the surface grows, business features and
plumbing blur together. We want a structure that scales and makes the boundary
between "the reusable foundation" and "this product" obvious — the foundation is
intended to become an extractable core later.

## Decision

```
src/
  modules/        Business features (auth, users, files) — controllers/services/dto
  core/           Cross-cutting infrastructure
    bootstrap/    configure*(app) functions; main.ts orchestrates them
    common/       filters/ interceptors/ decorators/ utils/ + pagination
    config/ health/ jobs/ logger/ prisma/
  integrations/   Adapters to external services (google, storage; email later)
  app.module.ts
  main.ts         Thin: otel/sentry → create app → configureApp → listen
```

- Feature-based modules; each owns its controllers, services, and DTOs (request
  and response classes both under its `dto/`).
- No `BaseService` / `BaseController` (inheritance traps).
- `main.ts` delegates to `core/bootstrap/*.setup.ts`; the e2e tests reuse the
  same `configureApp`, so production and tests can't drift.
- Tests mirror the layout: `test/core/`, `test/modules/`.

## Consequences

- The `core/` boundary is what will be extracted into a shared package if a
  second product ever validates it (not done pre-emptively — see
  [0009](0009-deferred-capabilities.md)).
- Slightly deeper import paths than a flat layout; a fair trade for clarity.
