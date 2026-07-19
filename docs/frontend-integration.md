# Frontend Integration Guide

Everything a separate frontend project needs to build against this API. Written
for a **React + Vite single-page app** whose first job is to exercise/validate
the whole API end to end (auth, account, files). The marketing/SEO site is a
separate concern (deferred).

> **Best starting move:** point an OpenAPI client generator at
> `http://localhost:3000/docs-json` (e.g. `openapi-typescript`) to get typed
> request/response models that stay in sync with the backend. This document
> covers the conventions the spec doesn't spell out.

## 1. Run the backend for local dev

From the backend repo:

```bash
pnpm services:up      # PostgreSQL + MinIO (object storage)
pnpm prisma:migrate   # apply schema
pnpm start:dev        # http://localhost:3000
```

- API base URL: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs-json`
- All business endpoints are versioned under `/v1`. Health checks are not
  versioned.

CORS: with `CORS_ORIGINS` unset (dev default) the API reflects the request
origin, so a Vite dev server on `http://localhost:5173` works out of the box.
Auth is **Bearer tokens, not cookies** — no CSRF/cross-site-cookie handling
needed.

To exercise the file endpoints, the backend needs `STORAGE_*` set (the
`.env.example` values point at the local MinIO). Without it, file routes return
503.

## 2. Response envelopes

Every JSON response is wrapped. **Unwrap `data` on success; read `message` on
error.**

Success:

```json
{ "data": { /* payload */ }, "requestId": "uuid" }
```

Error:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Invalid email or password",   // may be a string[] for validation
  "requestId": "uuid",
  "path": "/v1/auth/login",
  "timestamp": "2026-07-08T..."
}
```

Exceptions (raw, not wrapped): file **downloads** (binary stream) and the
`/health/*` probes.

Every response carries an `x-request-id` header; surface it in error toasts so
issues can be traced to a log line.

Validation is strict: the API rejects any request body field its DTO doesn't
declare (`forbidNonWhitelisted`), returning `400` with `message` as a
`string[]`. A generated client won't send stray fields, but hand-built payloads
can trip this — send only the documented fields.

## 3. Auth flow

Tokens are returned in the JSON body:

```json
{ "accessToken": "jwt", "refreshToken": "opaque", "tokenType": "Bearer", "expiresIn": 900 }
```

**Storage strategy (agreed): access token in memory, refresh token in
`localStorage`.** (Fine for this validation client; production should move the
refresh token to an httpOnly cookie, which needs a backend change.)

Rules:

- Send `Authorization: Bearer <accessToken>` on every protected request.
- Access token is short-lived (~15 min) and kept in memory, so it's gone after a
  page reload — on app load, if a refresh token exists in `localStorage`, call
  refresh to get a fresh access token.
- On a `401` from a protected call: call `/v1/auth/refresh` once, store the new
  pair, and retry the original request. If refresh also fails, clear tokens and
  send the user to login.
- **Refresh tokens rotate and are single-use.** Every refresh returns a *new*
  refresh token — overwrite the stored one. Reusing a spent refresh token
  returns `401` and revokes the whole session (by design).
- Logout: `POST /v1/auth/logout { refreshToken }`, then clear local state.

Google sign-in: get an ID token on the client via Google Identity Services, then
`POST /v1/auth/google { idToken }`. (Backend must have `GOOGLE_CLIENT_ID` set, or
it returns 503.)

Rate limits to handle in the UI: credential routes allow ~10/min (429 on
exceed); after 5 failed logins an account is locked ~15 min (429).

## 4. Endpoint reference

Auth (public):

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/v1/auth/register` | `{ email, password, displayName? }` | token pair (201) |
| POST | `/v1/auth/login` | `{ email, password }` | token pair (200) |
| POST | `/v1/auth/google` | `{ idToken }` | token pair (200) |
| POST | `/v1/auth/refresh` | `{ refreshToken }` | new token pair (200) |
| POST | `/v1/auth/logout` | `{ refreshToken }` | 204 |

Account (auth required — `Bearer`):

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/v1/users/me` | — | `{ id, email, displayName, createdAt }` |
| PATCH | `/v1/users/me` | `{ displayName? }` | updated user |
| DELETE | `/v1/users/me` | — | 204 (soft delete; login then blocked) |

Files (auth required):

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/files` | `multipart/form-data`, field name **`file`** → `{ id, filename, contentType, size, createdAt }` |
| GET | `/v1/files` | list — see pagination below |
| GET | `/v1/files/{id}/download` | **raw binary** (Content-Disposition attachment); not enveloped. `{id}` must be a UUID — malformed → `400`, unknown → `404` |
| DELETE | `/v1/files/{id}` | 204. `{id}` must be a UUID — malformed → `400`, unknown → `404` |

GEO audits (auth required; **async** — the report is not instant):

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/audits` | `{ url }` → `202` with an audit in `PENDING`. Runs in the background. Tighter rate limit than the global one — 20/min per IP, and max 5 in-flight audits per tenant; exceeding either → `429`. |
| GET | `/v1/audits/{id}` | **Poll** until `status` is `COMPLETED` or `FAILED`, then render `findings`. `{id}` must be a UUID. |
| GET | `/v1/audits` | History — supports `limit`/`cursor`/`sort`/`search` like files. |

Each finding: `{ dimension, title, status: 'ok' | 'needs_work', summary, detail, recommendation, basis, strength: 'hard' | 'advisory' }`. Poll roughly every 1–2s; a typical audit completes in a few seconds.

Health (public, unversioned, raw shape): `GET /health/live`, `GET /health/ready`.

## 5. Pagination, sorting, filtering (list endpoints)

`GET /v1/files?limit=20&cursor=<id>&sort=-createdAt&search=report`

- `limit` (1–100, default 20), `cursor` (id to continue after — pass the
  previous response's `nextCursor`).
- `sort`: a field name, prefix `-` for descending. Files allow: `createdAt`,
  `filename`, `size`. Unknown fields fall back to the default (`-createdAt`).
- `search`: free-text; for files it matches the filename (case-insensitive).
- Response: `{ data: { items: [...], nextCursor: string | null }, requestId }`.
  `nextCursor === null` means the last page.

## 6. Files: uploaded objects are tenant-scoped

Each account is its own tenant; a file is only ever visible to the account that
uploaded it (enforced server-side). Nothing to do on the client — just know that
a 404 on another tenant's file id is expected, not a bug.

## 7. Suggested scope for the validation app

Enough screens to drive every endpoint:

1. **Auth**: register, login (email/password), Google button, logout. An axios/
   fetch wrapper that attaches the Bearer token and handles the 401→refresh→retry
   loop centrally.
2. **Account**: view `me`, edit display name, delete account.
3. **Files**: upload, paginated list with sort + search, download, delete.

Keep it functional over pretty — the goal is to prove the API works from a real
browser client. Deploy target when ready: Cloudflare Pages.
