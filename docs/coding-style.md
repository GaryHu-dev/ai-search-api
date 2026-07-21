# Coding style

Enforced by ESLint (type-checked) + Prettier; run `pnpm lint` and `pnpm format`.
Beyond the linters:

## Conventions

- **TypeScript strict** everywhere; no `any` in production code (tests may relax
  it for mocks).
- **File names**: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.dto.ts`,
  `*.response.ts`, `*.setup.ts`, `*.spec.ts`, `*.e2e-spec.ts`.
- **DTOs** (request and response) live under a module's `dto/` folder.
- **Comments explain *why*, not *what*** — match the surrounding density; no
  narration of obvious code.
- **English**: AU/NZ spelling in prose.

## Patterns to follow

- Services use Prisma directly — **no repository layer, no `BaseService`/
  `BaseController`** ([ADR-0001](adr/0001-prisma-no-repository.md)).
- Map entities to explicit response classes; never return Prisma models raw.
- Tenant-scoped queries always filter on `tenantId`; user lookups exclude
  soft-deleted rows.
- Cross-cutting behaviour goes in `core/common` (filters/interceptors/pipes);
  external services go in `integrations/`.
- Config is read through a typed `ConfigService<Env, true>`, never `process.env`
  directly (except the pre-boot `otel.ts` / `sentry.ts`).

## Testing

- Unit-test logic-bearing services (mock dependencies); e2e-test HTTP flows
  against real services. e2e reuse `configureApp` so they match production.
- Unit specs are co-located under each directory's `__tests__/` folder; e2e specs
  live under the top-level `test/`.
- A floating promise is an error (`no-floating-promises`).
