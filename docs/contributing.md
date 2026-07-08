# Contributing

## Setup

```bash
pnpm install
cp .env.example .env
pnpm services:up        # PostgreSQL + MinIO
pnpm prisma:migrate
pnpm start:dev
```

## Workflow

1. Branch off `dev`.
2. Make the change with tests (unit for logic, e2e for HTTP flows).
3. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.
4. For bootstrap/build/config changes, also boot the real binary
   (`node dist/main.js`) — the suites don't run `main.ts`.
5. Open a PR into `dev`.

A pre-commit hook (husky + lint-staged) lints and formats staged files.

## Definition of done

- Lint, typecheck, unit, and e2e pass; coverage stays above the configured floor.
- Schema changes have a migration (CI checks drift).
- New env vars are validated in `env.validation.ts` and documented in
  `.env.example`.
- A significant architectural decision gets an [ADR](adr/README.md).

## CI gates

Install → audit → lint → typecheck → build → migrate + drift check → unit → e2e,
plus CodeQL and a Trivy image scan.
