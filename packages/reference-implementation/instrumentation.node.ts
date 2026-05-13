/**
 * Node-side OpenTelemetry SDK initialisation.
 *
 * Loaded dynamically by `instrumentation.ts` at process startup when
 * running under the Node.js runtime. Sets up auto-instrumentation
 * (HTTP, Next.js, Prisma, fetch, etc.) and an OTLP gRPC trace exporter
 * pointed at the local OTel agent (see docker-compose's `otel-agent`
 * service under the `observability` / `local-observability` profiles,
 * per ADR 020).
 *
 * The SDK tolerates a missing collector: if `OTEL_EXPORTER_OTLP_ENDPOINT`
 * points nowhere reachable, exports retry with backoff and the app keeps
 * serving requests. Running without an observability profile is
 * therefore safe.
 *
 * Walking skeleton scope (#592): traces only. Pino logs (#593),
 * metrics (#594), and custom domain spans land in follow-up tickets.
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { buildResource } from './src/lib/observability/resource';

const sdk = new NodeSDK({
  resource: buildResource(),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

const shutdown = () => {
  sdk
    .shutdown()
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('OpenTelemetry SDK shutdown failed', err);
    })
    .finally(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
