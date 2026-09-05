/**
 * @jest-environment node
 */
/**
 * Pins the one external-library fact the service-name wiring relies on: the
 * NodeSDK merges its `serviceName` option AFTER its env detector, so the
 * name this application resolves is what spans carry even when the
 * environment would otherwise override it. A future SDK that changed that
 * order would pass every mocked wiring test and silently hand naming back to
 * the environment; this is the test that would catch it.
 */
import { trace } from '@opentelemetry/api';
import { envDetector } from '@opentelemetry/resources';
import { tracing } from '@opentelemetry/sdk-node';

import { resolveServiceName } from './resource';
import { startNodeSdk } from './start-sdk';

const SAVED = {
  OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
  OTEL_RESOURCE_ATTRIBUTES: process.env.OTEL_RESOURCE_ATTRIBUTES,
};

function restore(name: keyof typeof SAVED) {
  if (SAVED[name] === undefined) delete process.env[name];
  else process.env[name] = SAVED[name];
}

async function emittedServiceName(): Promise<unknown> {
  const exporter = new tracing.InMemorySpanExporter();
  // The real starter, so dropping its `serviceName` option would fail this
  // suite; only the exporter and detectors are swapped to read in memory.
  const sdk = startNodeSdk(
    { serviceName: resolveServiceName(), serviceVersion: '0.0.0-test' },
    {
      traceExporter: undefined,
      // The env detector is the one that competes for service.name, and it is
      // synchronous; the default host/process detectors add async attributes
      // that would defer the export past the read below.
      resourceDetectors: [envDetector],
      spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
      instrumentations: [],
    },
  );
  try {
    trace.getTracer('service-name-emission-test').startSpan('probe').end();
    const [span] = exporter.getFinishedSpans();
    return span.resource.attributes['service.name'];
  } finally {
    await sdk.shutdown();
    trace.disable();
  }
}

describe('service.name as emitted by the NodeSDK', () => {
  afterEach(() => {
    restore('OTEL_SERVICE_NAME');
    restore('OTEL_RESOURCE_ATTRIBUTES');
  });

  it('keeps the resolved default when only OTEL_RESOURCE_ATTRIBUTES tries to set service.name', async () => {
    delete process.env.OTEL_SERVICE_NAME;
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.name=shadow';

    expect(await emittedServiceName()).toBe('reference-implementation');
  });

  it('emits a padded OTEL_SERVICE_NAME trimmed, as resolved', async () => {
    process.env.OTEL_SERVICE_NAME = '  ri-staging  ';
    delete process.env.OTEL_RESOURCE_ATTRIBUTES;

    expect(await emittedServiceName()).toBe('ri-staging');
  });
});
