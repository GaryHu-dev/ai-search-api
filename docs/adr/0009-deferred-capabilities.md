# 0009 — Deliberately deferred capabilities (YAGNI)

Status: Accepted

## Context

Many "enterprise" features are easy to add speculatively and expensive to carry
before they earn their place. The foundation stays small; each capability is
added when a real requirement appears. All of the below are **additive** — none
requires reworking what exists.

## Decision — not building yet, with the trigger that would change that

| Capability | Add when |
| --- | --- |
| Organisations / members / invitations | A company genuinely needs multiple member accounts sharing data. The `Tenant` table ([0002](0002-multi-tenancy.md)) already makes this additive. |
| Dynamic RBAC (roles/permissions) | More than the current owner-only model is needed — i.e. members exist and need differing rights. |
| API keys | Programmatic/machine access to the API is offered to customers. |
| Email + password reset | Real users need self-service reset or transactional email (provider chosen: Cloudflare Email; adapter will live in `integrations/`). |
| Idempotency keys / webhooks / usage metering | A public write API, outbound webhooks, or metered billing exists. |
| Redis cache | A measured hot path needs it, or the throttler/sessions must be shared across replicas. |
| Secrets manager | Deploying somewhere with a real secret store (env files are dev-only). |
| Postgres RLS (database-level tenant enforcement) | A fail-closed backstop beneath the app-level auto-scoping ([0002](0002-multi-tenancy.md)); add before the data is high-value/regulated. |

## Consequences

- A smaller, more legible surface today.
- These are recorded so "we don't have X" reads as a decision with a trigger,
  not an oversight.
