import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ConsoleSpanExporter,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

// OpenTelemetry bootstrap. This MUST run before the application (and therefore
// before http/express/pino are required) so auto-instrumentation can patch
// them — main.ts imports this file first, ahead of everything else.
//
// Reads process.env directly because Nest's ConfigService isn't available this
// early. Disabled entirely unless OTEL_ENABLED=true, so tests and local runs
// pay nothing.
if (process.env.OTEL_ENABLED === 'true') {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  let traceExporter: SpanExporter | undefined;
  if (endpoint) {
    traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });
  } else if (process.env.OTEL_CONSOLE === 'true') {
    traceExporter = new ConsoleSpanExporter();
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'saas-api',
    }),
    traceExporter,
    // Exposes Prometheus metrics on :9464/metrics (HTTP server latency, request
    // counts, runtime, etc.) for a scraper to pull.
    metricReader: new PrometheusExporter({ port: 9464 }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem spans are noise for a web service.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    void sdk.shutdown();
  });
}
