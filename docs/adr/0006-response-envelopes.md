# 0006 — Consistent response and error envelopes

Status: Accepted

## Context

Clients and support tooling benefit from a single, predictable response shape
and a correlation id they can quote back to us.

## Decision

- **Success**: a global interceptor wraps handler results as
  `{ data, requestId }`.
- **Error**: a global exception filter renders every error as
  `{ statusCode, error, message, requestId, path, timestamp }`. Unknown
  (non-HTTP) errors become a generic 500 with no internal details leaked, and
  are logged with a stack and reported to Sentry.
- **Correlation id**: every request gets an `x-request-id` (generated or taken
  from the inbound header), echoed in the response header, in both envelopes,
  and in every log line.
- **Opt-out**: binary downloads (`StreamableFile`), empty 204s, and health
  probes skip the success envelope (`@SkipResponseEnvelope()`), so their shapes
  stay raw for monitors and file clients.

## Consequences

- One contract for all JSON responses; support can trace any response to its log
  line via `requestId`.
- Response DTOs (Swagger) document the inner payload; the envelope is implicit —
  a documented convention rather than repeated in every schema.
