# 0007 — Observability (OpenTelemetry + Sentry + Pino)

Status: Accepted

## Context

Structured logs alone are not observability: correlating a slow request across
layers, and alerting on aggregate error/latency, need traces and metrics. We
also want vendor neutrality and no cost when disabled.

## Decision

- **Logs**: Pino (structured JSON), one correlation id per request, plus
  `userId`/`tenantId` on authenticated requests.
- **Traces + metrics**: OpenTelemetry (`src/otel.ts`, imported first in
  `main.ts` so auto-instrumentation patches http/express/Prisma/pino before they
  load). `trace_id` is injected into logs. Metrics are exposed for Prometheus on
  `:9464/metrics`. Off unless `OTEL_ENABLED=true`; exports to an OTLP endpoint in
  production or the console in development.
- **Error tracking**: Sentry (`src/sentry.ts`), error-capture only
  (`skipOpenTelemetrySetup: true` so it does not stand up a second OTel and
  collide with ours). Disabled unless `SENTRY_DSN` is set; 5xx are reported from
  the exception filter.

## Consequences

- Logs → traces → metrics tell one story; `trace_id` ties them together.
- OTel bootstrap ordering is load-bearing: it must be the first import.
- Sentry and OTel coexist only because Sentry's own instrumentation is
  suppressed; revisit if we adopt Sentry performance tracing.

## Follow-ups

- Metrics/traces are not yet exercised in CI.
