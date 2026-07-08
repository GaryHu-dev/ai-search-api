import * as Sentry from '@sentry/node';

// Error tracking. Initialised before the app so early failures are captured,
// and disabled entirely unless a DSN is configured (so local/test runs and
// unconfigured deployments send nothing).
//
// Kept error-capture-only: `skipOpenTelemetrySetup` stops Sentry from standing
// up its own OpenTelemetry, which would collide with ours (see otel.ts).
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
    skipOpenTelemetrySetup: true,
  });
}
