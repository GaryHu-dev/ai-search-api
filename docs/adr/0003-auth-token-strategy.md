# 0003 — Authentication and token strategy

Status: Accepted

## Context

We need email+password and Google sign-in, session revocation, and no Redis in
the current stack.

## Decision

- **Access token**: short-lived stateless JWT (default 15 min), carrying
  `sub`, `tenantId`, `email`.
- **Refresh token**: opaque random string, stored only as a **SHA-256 hash** in
  `refresh_tokens`. Single-use — rotated on every refresh. Presenting an
  already-revoked token is treated as theft and revokes the user's whole token
  family. Logout revokes the presented token.
- **Passwords**: argon2id (`@node-rs/argon2`).
- **Google**: verify a Google **ID token** sent by the client (API-first), not a
  server-side redirect flow. Keeps the backend stateless.
- **Identity model**: same email = same person. An account is separate from its
  login methods (password, Google); one account can have several.
- **Lockout**: after `LOGIN_MAX_ATTEMPTS` failed password logins, the account is
  locked for `LOGIN_LOCK_MINUTES` (429), checked before password verification.

## Consequences

- Revocation works without Redis (delete/revoke the refresh row).
- Access tokens cannot be revoked before they expire — mitigated by the short
  TTL. Soft-deleted users are rejected at login and refresh; an outstanding
  access token dies at expiry.
- SHA-256 is sufficient for high-entropy random refresh tokens; argon2 is used
  only for low-entropy human passwords (right tool per job).

## Alternatives considered

- **Stateful server sessions**: gives instant revocation but abandons the
  stateless access path. Rejected.
- **bcrypt-hashed refresh tokens**: unnecessary slow hashing for random,
  high-entropy secrets. Rejected in favour of SHA-256.
