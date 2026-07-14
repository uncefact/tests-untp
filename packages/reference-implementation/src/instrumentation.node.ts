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
import { NodeSDK } from '@opentelemetry/sdk-node';

import { buildInstrumentations } from './lib/observability/instrumentations';
import { buildResource } from './lib/observability/resource';

const sdk = new NodeSDK({
  resource: buildResource(),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317',
  }),
  instrumentations: [buildInstrumentations()],
});

sdk.start();

const shutdown = () => {
  sdk.shutdown().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('OpenTelemetry SDK shutdown failed', err);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
