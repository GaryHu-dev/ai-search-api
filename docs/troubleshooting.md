# Troubleshooting

## `pnpm` refuses to run a dependency's build script

pnpm blocks install scripts by default. Allowed packages are listed under
`allowBuilds` in `pnpm-workspace.yaml` (Prisma is allowed; add others
deliberately).

## `docker compose` not found (Colima / CLI-only Docker)

The Compose v2 plugin may be missing. Symlink the standalone binary:

```bash
mkdir -p ~/.docker/cli-plugins
ln -sfn "$(command -v docker-compose)" ~/.docker/cli-plugins/docker-compose
```

## CI fails on "migrations not in sync with schema"

`schema.prisma` was changed without a migration. Run `pnpm prisma:migrate` to
generate one and commit it.

## `node dist/main.js` can't find the module / output is under `dist/src/`

TypeScript widened its `rootDir` because a `.ts` file outside `src/` was
included in the build. Keep such files (e.g. `prisma/seed.ts`, run via ts-node)
in `tsconfig.build.json`'s `exclude`.

## e2e tests fail to connect / hang

They need the services up: `pnpm services:up` (PostgreSQL + MinIO). e2e run
serially (`maxWorkers: 1`) because each boot starts pg-boss. The storage suite
skips itself when `STORAGE_*` is unset.

## OpenTelemetry shows no traces

OTel is off unless `OTEL_ENABLED=true`. For local spans set `OTEL_CONSOLE=true`;
for a collector set `OTEL_EXPORTER_OTLP_ENDPOINT`. `src/otel.ts` must remain the
first import in `main.ts`.

## File endpoints return 503 "Object storage is not configured"

`STORAGE_*` isn't set. Start MinIO (`pnpm services:up`) and copy the storage
block from `.env.example`, or point at R2.

## Reminder: tests never run `main.ts` or `dist/`

After changing bootstrap/build/config, boot the real binary
(`node dist/main.js`) — the test suites won't catch those.
