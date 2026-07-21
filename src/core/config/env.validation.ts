import { z } from 'zod';

// A single, validated description of everything the process needs from its
// environment. Anything not declared here is intentionally ignored, so the
// running config can never drift from what this file documents.
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
    DATABASE_URL: z.string().url(),

    // Signs access tokens. Long and random; rotating it invalidates every issued
    // access token, so treat it as a secret.
    JWT_ACCESS_SECRET: z.string().min(32),
    // Access tokens are deliberately short-lived; revocation is handled through
    // refresh tokens rather than by trying to revoke access tokens.
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    // Comma-separated list of allowed CORS origins. Unset = reflect the request
    // origin (convenient in development; lock this down in production).
    CORS_ORIGINS: z.string().optional(),

    // SSRF-guard override for the GEO audit fetcher: 'true' lets it fetch private
    // / loopback URLs. Declared here (rather than read raw) so config validation
    // doesn't strip it. Dev and tests only — never set in production.
    GEO_ALLOW_PRIVATE_URLS: z.string().optional(),
    // Express `trust proxy`. MUST match the real deployment topology: behind
    // Cloudflare/a load balancer, set this (e.g. a hop count or trusted CIDRs) so
    // the real client IP drives rate-limiting and logging. Too trusting lets
    // callers forge X-Forwarded-For; unset means no proxy is trusted.
    TRUST_PROXY: z.string().optional(),
    // Per-account lockout after repeated failed password logins.
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
    // Hard limits to blunt abuse.
    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    BODY_LIMIT: z.string().default('1mb'),
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),

    // Observability. OpenTelemetry is off unless enabled; it exports to an OTLP
    // endpoint in production, or to the console when OTEL_CONSOLE is set (dev).
    OTEL_ENABLED: z
      .string()
      .optional()
      .transform((value) => value === 'true'),
    OTEL_SERVICE_NAME: z.string().default('saas-api'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_CONSOLE: z
      .string()
      .optional()
      .transform((value) => value === 'true'),

    // Error tracking. Disabled unless a Sentry DSN is provided.
    SENTRY_DSN: z.string().optional(),

    // Optional: backend-driven Google sign-in (authorization-code / redirect
    // flow). Enabled only when CLIENT_ID + CLIENT_SECRET + CALLBACK_URL are all
    // set; otherwise the strategy isn't registered and the routes stay dormant.
    // CALLBACK_URL is where Google redirects back (must match the Google Cloud
    // console). POST_LOGIN_REDIRECT is the frontend URL we bounce the browser to
    // afterwards, with the tokens (or an error) in the URL fragment.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CALLBACK_URL: z.string().url().optional(),
    GOOGLE_POST_LOGIN_REDIRECT: z.string().url().optional(),

    // Optional: S3-compatible object storage. MinIO locally, Cloudflare R2 in
    // production. File features are disabled until these are set.
    STORAGE_ENDPOINT: z.string().url().optional(),
    STORAGE_REGION: z.string().default('auto'),
    STORAGE_BUCKET: z.string().optional(),
    STORAGE_ACCESS_KEY_ID: z.string().optional(),
    STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
    // MinIO requires path-style addressing; R2 accepts it too. Defaults on.
    STORAGE_FORCE_PATH_STYLE: z
      .string()
      .optional()
      .transform((value) => value !== 'false'),
  })
  .superRefine((env, ctx) => {
    // The SSRF-guard override must never be on in production — refuse to boot,
    // rather than silently turning the audit fetcher into an internal proxy.
    if (
      env.NODE_ENV === 'production' &&
      env.GEO_ALLOW_PRIVATE_URLS === 'true'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GEO_ALLOW_PRIVATE_URLS'],
        message:
          'must not be enabled in production (it disables the SSRF guard)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

// Runs once at startup, wired into @nestjs/config as its `validate` hook. We
// fail fast with a readable summary rather than a stack trace, so a
// misconfigured deployment surfaces the problem immediately instead of booting
// into a half-working state.
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}
