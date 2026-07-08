# Deployment

## Recommended topology

For this product's stage, a container platform beats both hand-managed servers
and Kubernetes:

```
Cloudflare  (CDN + WAF + edge rate limiting)
    │
Load balancer  (provided by the platform)
    │
  app ×2+   ← stateless container replicas, autoscaled
    │
Managed PostgreSQL  (with a connection pooler)
```

- **Run**: Google Cloud Run, Fly.io, Railway, or Render — set a minimum of **two
  replicas** for redundancy and let them autoscale. The platform supplies the
  load balancer, rolling deploys, and restarts (using the health probes below).
- **Database**: managed PostgreSQL (Neon, Supabase, RDS) with a connection
  pooler — see [Database connections](#database-connections).
- **Edge**: put Cloudflare in front for CDN, WAF, and rate limiting. Edge rate
  limiting is global by nature and stops abuse before it reaches the app, which
  is why the in-app throttler being per-instance is not a problem.
- **Observability**: Grafana Cloud or Datadog, plus Sentry — see below.
- **Kubernetes**: not yet. It is the classic over-engineering trap at this stage;
  a PaaS gives multi-node, autoscaling, and zero-downtime deploys with almost no
  ops.

The app is stateless (JWT, DB-backed state), so replicas need no shared session
or sticky routing. Multi-instance safety is already handled for auth lockout
(DB-backed) and background jobs (pg-boss coordinates via PostgreSQL). The two
cross-replica concerns are **database connections** (below) and **rate limiting**
(edge, per [security.md](security.md)).

## Build

Multi-stage `Dockerfile` (Node 24 Alpine): installs deps, generates the Prisma
client, compiles to `dist/`, and ships a non-root runtime image.

```bash
docker build -t saas-api .
```

## Environment

Validated at boot — a missing or malformed variable stops the process. See
`.env.example` for the full list. The essentials:

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | `production` disables Swagger |
| `PORT` | Listen port (default 3000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | ≥32 chars; rotating it invalidates all access tokens |
| `CORS_ORIGINS` | Comma-separated allow-list |
| `TRUST_PROXY` | Set to match the proxy topology (e.g. `1` behind one proxy) |
| `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT` | Traces/metrics (optional) |
| `SENTRY_DSN` | Error tracking (optional) |
| `STORAGE_*` | Object storage; point at Cloudflare R2 in production |

## Database migrations

Apply migrations before/at release with the non-interactive command:

```bash
pnpm prisma migrate deploy
```

CI verifies migrations are in sync with `schema.prisma` (a drift check), so a
model change without a migration fails the pipeline. Follow expand/contract for
zero-downtime changes.

## Database connections

Each instance keeps its own Prisma connection pool, so `instances × pool size`
must stay under PostgreSQL's `max_connections`. Two instances can quietly
exhaust a small database — this is the main thing to get right when scaling out.

- Put a **connection pooler** in front of PostgreSQL: PgBouncer, or the pooler
  built into Neon / Supabase / RDS Proxy.
- Bound Prisma's own pool with `connection_limit`, and set `pgbouncer=true` when
  the pooler runs in transaction mode (Prisma then skips prepared statements):

  ```
  DATABASE_URL="postgresql://user:pass@pooler-host:6432/app?pgbouncer=true&connection_limit=5"
  ```

- **Migrations must use the direct (non-pooled) connection**, not a
  transaction-mode pooler. Point `prisma migrate deploy` at the direct URL (many
  managed providers expose both a pooled and a direct URL).

## Runtime endpoints

- `GET /health/live` — liveness (restart the container if failing).
- `GET /health/ready` — readiness (route traffic only when the DB is reachable).
- `:9464/metrics` — Prometheus metrics (when `OTEL_ENABLED=true`).
- `/docs` — Swagger (non-production only).

## Observability integration

The app emits four signals, all vendor-neutral, so wiring them to a platform is
mostly configuration — switching platforms is an env-var change, not a code
change.

| Signal | Emitted as | How to ship it |
| --- | --- | --- |
| Logs | Structured JSON on stdout (Pino) | The host's log forwarder, or an agent (Grafana Alloy, Datadog Agent) |
| Traces | OTLP (when `OTEL_ENABLED=true`) | Point `OTEL_EXPORTER_OTLP_ENDPOINT` at the backend |
| Metrics | Prometheus on `:9464/metrics` | Scrape with an agent (or push via OTLP) |
| Errors | Sentry | Set `SENTRY_DSN` |

The hard part — clean structured logs with a correlation id and `trace_id`, and
OTLP traces — is already done. Getting stdout logs *into* a platform is a
deployment-side step (an agent / the host's forwarder) for any vendor.

### Sentry (errors)

Set `SENTRY_DSN`; nothing else. Note: Sentry hosts in US or EU (no in-Australia
region) — if error payloads must stay onshore, self-host Sentry.

### Grafana Cloud (traces + metrics + logs)

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<zone>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(instanceId:token)>
```

- Metrics: scrape `:9464/metrics` with Grafana Alloy, or push via OTLP.
- Logs: ship stdout with Alloy / Promtail.
- **Residency**: Grafana Cloud offers an APAC region and a data-residency
  commitment as an enterprise option; strict in-country AU is an enterprise
  negotiation. For full control, self-host the Grafana stack (Tempo / Mimir /
  Loki) in AWS Sydney or Auckland.

### Datadog (traces + metrics + logs)

Run the Datadog Agent (OTLP receiver enabled) as a sidecar and point
`OTEL_EXPORTER_OTLP_ENDPOINT` at it (e.g. `http://localhost:4318`); the Agent
also tails container logs.

- **Residency**: use the **AP2 (Sydney) site** — data stays in Australia, suited
  to regulated ANZ sectors. For NZ-onshore requirements, Sydney is offshore.

### Notes

`src/otel.ts` pushes traces via OTLP and exposes metrics for scraping. Adding
OTLP metric push, or explicit exporter auth headers, is a small change if a
chosen platform needs it.

## Scaling notes

- The throttler and pg-boss workers run in-process. Running multiple replicas
  needs a shared throttler store, and pg-boss will coordinate via the database.
- Behind Cloudflare/a load balancer, set `TRUST_PROXY` (see
  [security.md](security.md)).
- Object storage in production is Cloudflare R2 (`STORAGE_FORCE_PATH_STYLE=false`,
  `STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com`).
