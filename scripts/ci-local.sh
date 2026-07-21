#!/usr/bin/env bash
#
# Runs the full local check suite before you push: lint, format, typecheck,
# audit, build, migrations, and all tests against the local services. CI itself
# is intentionally lean (just build + tests on a fresh database), so this script
# is a superset — if it passes, CI will too.

set -euo pipefail
cd "$(dirname "$0")/.."

# Load local env (DATABASE_URL etc.) the way the app does.
[ -f .env ] && { set -a; . ./.env; set +a; }

echo "→ starting services (PostgreSQL + MinIO)"
pnpm services:up >/dev/null
for _ in $(seq 1 30); do
  docker compose exec -T db pg_isready -U app -d app >/dev/null 2>&1 && break
  sleep 1
done

echo "→ install + audit"
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level high

echo "→ generate"
pnpm prisma generate

echo "→ lint + format + typecheck + build"
pnpm lint:check
pnpm format:check
pnpm typecheck
pnpm build

echo "→ migrations + drift check"
pnpm prisma migrate deploy
pnpm prisma migrate diff --exit-code \
  --from-url "$DATABASE_URL" --to-schema-datamodel ./prisma/schema.prisma

echo "→ tests"
pnpm test
pnpm test:e2e

echo "✅ local CI passed"
