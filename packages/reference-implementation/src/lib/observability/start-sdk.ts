import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';

import { buildInstrumentations } from './instrumentations';
import { buildOtlpTraceExporterOptions } from './otlp-trace-exporter-options';
import { buildResource } from './resource';

export interface StartNodeSdkOptions {
  /** The resolved `service.name`; see `resolveServiceName`. */
  serviceName: string;
  /** Overrides the version `buildResource` would read from the package. */
  serviceVersion?: string;
}

/**
 * Build the configuration passed to the OpenTelemetry Node SDK without
 * starting it. The SDK constructs environment-selected log and metric
 * exporters while it consumes this configuration.
 */
function buildNodeSdkConfiguration(
  options: StartNodeSdkOptions,
  overrides: Partial<NodeSDKConfiguration> = {},
): Partial<NodeSDKConfiguration> {
  return {
    resource: buildResource({ serviceName: options.serviceName, serviceVersion: options.serviceVersion }),
    serviceName: options.serviceName,
    traceExporter: new OTLPTraceExporter(buildOtlpTraceExporterOptions()),
    instrumentations: buildInstrumentations(),
    ...overrides,
  };
}

/**
 * Construct an unstarted SDK from the shared configuration.
 *
 * `NodeSDK` constructs its environment-selected log and metric exporters in
 * its constructor, while provider registration and resource detection wait
 * for `start()`.
 */
export function buildNodeSdk(options: StartNodeSdkOptions, overrides: Partial<NodeSDKConfiguration> = {}): NodeSDK {
  return new NodeSDK(buildNodeSdkConfiguration(options, overrides));
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
  const sdk = buildNodeSdk(options, overrides);
  sdk.start();
  return sdk;
}
