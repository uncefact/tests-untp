/**
 * Node-side OpenTelemetry SDK initialisation.
 *
 * Loaded dynamically by `instrumentation.ts` at process startup when
 * running under the Node.js runtime. The OTLP exporter targets the
 * local OTel agent sidecar; the SDK does not crash the app on export
 * failure, so running without an observability profile is safe.
 *
 * @see ../../../docs/observability.md
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { buildResource } from './lib/observability/resource';
import { apiLogger } from './lib/api/logger';
import { warnOnRejectedMaxPageLimitOverride } from './lib/api/pagination';

const sdk = new NodeSDK({
  resource: buildResource(),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Surface an unusable API_MAX_PAGE_LIMIT to the operator once at startup (issue #834).
warnOnRejectedMaxPageLimitOverride(apiLogger);

const shutdown = () => {
  sdk.shutdown().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('OpenTelemetry SDK shutdown failed', err);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
