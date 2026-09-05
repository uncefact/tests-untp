import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';

import { buildInstrumentations } from './instrumentations';
import { buildResource } from './resource';

export interface StartNodeSdkOptions {
  /** The resolved `service.name`; see `resolveServiceName`. */
  serviceName: string;
  /** Overrides the version `buildResource` would read from the package. */
  serviceVersion?: string;
}

/**
 * Start the OpenTelemetry Node SDK for one process. Called by the web boot
 * and the worker entrypoint. The auto-instrumentation it installs patches
 * packages as the module system loads them, so a process that wants `pg` or
 * HTTP spans, or trace context on its `pino` log lines, calls this before
 * importing the modules that load those packages; the worker does, the web
 * boot does not yet.
 *
 * `serviceName` is passed to the SDK as well as into the resource because
 * the SDK merges its env detector over the resource and `serviceName` last,
 * so only the option makes the resolved name win over a padded
 * `OTEL_SERVICE_NAME` (see `resource.ts`).
 */
export function startNodeSdk(options: StartNodeSdkOptions, overrides: Partial<NodeSDKConfiguration> = {}): NodeSDK {
  // `overrides` exist for the emission test, which swaps the exporter and
  // detectors to read spans in memory while still driving this function.
  const sdk = new NodeSDK({
    resource: buildResource({ serviceName: options.serviceName, serviceVersion: options.serviceVersion }),
    serviceName: options.serviceName,
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317',
    }),
    instrumentations: buildInstrumentations(),
    ...overrides,
  });
  sdk.start();
  return sdk;
}
