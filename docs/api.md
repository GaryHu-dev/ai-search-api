# API

This is Omniport's API. Interactive reference: **Swagger at `/docs`**
(non-production). This page covers the cross-cutting conventions.

## Conventions

- **Versioning**: URI, e.g. `/v1/...`. Health checks are unversioned.
- **Auth**: `Authorization: Bearer <accessToken>` on protected routes.
- **Success envelope**: `{ "data": <payload>, "requestId": "..." }`.
- **Error envelope**: `{ "statusCode", "error", "message", "requestId", "path",
  "timestamp" }`. `message` may be an array (validation errors).
- **Correlation**: every response carries an `x-request-id` header; quote it in
  bug reports.
- **Pagination**: list endpoints take `?limit=&cursor=` and return
  `{ items, nextCursor }` (cursor-based).
- **Sorting**: `?sort=field` (or `-field` for descending), restricted to an
  allow-list per endpoint.
- **Filtering**: `?search=` for endpoint-specific free-text filtering.

## Endpoints (summary)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/auth/register` | Returns a token pair |
| POST | `/v1/auth/login` | Password login (rate-limited, lockout) |
| GET | `/v1/auth/google` | Redirects the browser to Google's consent screen (no body/response — browser navigation only) |
| GET | `/v1/auth/google/callback` | Google calls this back with a code; on success 302s to `GOOGLE_POST_LOGIN_REDIRECT` with tokens in the URL **fragment**, on failure with `#error=google_auth_failed` |
| POST | `/v1/auth/refresh` | Rotate refresh token |
| POST | `/v1/auth/logout` | Revoke a refresh token |
| GET/PATCH/DELETE | `/v1/users/me` | The caller's own account |
| POST/GET | `/v1/files` | Upload / list (paginated) |
| GET/DELETE | `/v1/files/:id/download`, `/v1/files/:id` | Download / delete |
| POST | `/v1/audits` | Start a GEO audit (`202`, runs async; 20/min per IP, 5 in-flight per tenant) |
| GET | `/v1/audits/:id` | Poll one audit until `COMPLETED`/`FAILED` |
| GET | `/v1/audits` | List audits (paginated `ListQuery`: `limit`/`cursor`/`sort`/`search`) |
| GET | `/v1/notifications` | List the caller's notifications (paginated `ListQuery`: `limit`/`cursor`/`sort`/`search`; `?unread=true` filters to unread only) |
| GET | `/v1/notifications/unread-count` | `{ count }` of unread notifications |
| POST | `/v1/notifications/read-all` | Marks all of the caller's notifications read → `{ count }` (`200`, not `201` — nothing is created) |
| PATCH | `/v1/notifications/:id/read` | Marks one notification read → the updated notification |
| GET | `/health/live`, `/health/ready` | Probes (unversioned, raw shape) |

Downloads (`StreamableFile`) and health probes return raw bodies (no success
envelope). Notifications routes require `Authorization: Bearer` like the other
protected endpoints and return the standard `{ data, requestId }` envelope; the
Google redirect endpoints are the one exception — they never return JSON, only
a redirect.
