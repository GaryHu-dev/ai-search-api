# API

Interactive reference: **Swagger at `/docs`** (non-production). This page covers
the cross-cutting conventions.

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
| POST | `/v1/auth/google` | Google ID-token login |
| POST | `/v1/auth/refresh` | Rotate refresh token |
| POST | `/v1/auth/logout` | Revoke a refresh token |
| GET/PATCH/DELETE | `/v1/users/me` | The caller's own account |
| POST/GET | `/v1/files` | Upload / list (paginated) |
| GET/DELETE | `/v1/files/:id/download`, `/v1/files/:id` | Download / delete |
| POST | `/v1/audits` | Start a GEO audit (`202`, runs async; 20/min per IP, 5 in-flight per tenant) |
| GET | `/v1/audits/:id` | Poll one audit until `COMPLETED`/`FAILED` |
| GET | `/v1/audits` | List audits (paginated `ListQuery`: `limit`/`cursor`/`sort`/`search`) |
| GET | `/health/live`, `/health/ready` | Probes (unversioned, raw shape) |

Downloads (`StreamableFile`) and health probes return raw bodies (no success
envelope).
