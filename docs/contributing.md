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

A pre-commit hook (husky + lint-staged) lints and formats staged files, and a
commit-msg hook enforces Conventional Commits.

## Branch protection (keep `main` green)

Never push directly to `main`. All work lands via PR, and `main` requires the CI
checks to pass before merge — so a CI failure only ever affects a feature branch
or PR, never `main`.

Recommended GitHub settings (Settings → Branches → protect `main`):

- Require a pull request before merging.
- Require status checks to pass: `verify`, `image-scan`, `analyze` (CodeQL).
- Require branches to be up to date before merging (or use a merge queue).

Workflow-file changes (`.github/`) can only be fully validated by the runner, so
iterate on them **on a branch/PR**, not on `main`. Dependabot keeps action and
dependency versions current, which prevents "action version no longer exists"
breakages.

## Running CI locally

`pnpm ci:local` runs the same command steps as the CI `verify` job against the
local services — catches lint/typecheck/build/migration/test failures before you
push. It does **not** reproduce action-level issues (versions, runner setup);
for those use [`act`](https://github.com/nektos/act) or a branch push.

## Definition of done

- Lint, typecheck, unit, and e2e pass; coverage stays above the configured floor.
- Schema changes have a migration (CI checks drift).
- New env vars are validated in `env.validation.ts` and documented in
  `.env.example`.
- A significant architectural decision gets an [ADR](adr/README.md).

## CI gates

Install → audit → lint → typecheck → build → migrate + drift check → unit → e2e,
plus CodeQL and a Trivy image scan.
