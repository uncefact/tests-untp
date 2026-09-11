/** @jest-environment node */

const mockCapturedLogLines: string[] = [];

jest.mock('@uncefact/untp-ri-services/logging', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services/logging');
  return {
    ...actual,
    createLogger: (config: Record<string, unknown> = {}) =>
      actual.createLogger({
        ...config,
        destination: { write: (line: string) => mockCapturedLogLines.push(line) },
      }),
  };
});

import { context, trace } from '@opentelemetry/api';
import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import { runWithRequestContext } from '@uncefact/untp-ri-services/logging';
import { extractGroupClaim } from '@/lib/auth/group-claim';
import { readContextCacheTtlMs } from '@/lib/credentials/context-cache';
import { apiLogger } from './logger';

const traceExporter = new tracing.InMemorySpanExporter();
const traceSdk = new NodeSDK({
  autoDetectResources: false,
  instrumentations: [],
  spanProcessors: [new tracing.SimpleSpanProcessor(traceExporter)],
});

beforeAll(() => {
  traceSdk.start();
});

afterAll(async () => {
  await traceSdk.shutdown();
});

beforeEach(() => {
  mockCapturedLogLines.length = 0;
});

it('emits trace fields from the real apiLogger instance inside a span', () => {
  // Fails if apiLogger is constructed without the trace provider or a child
  // logger stops inheriting its parent's mixin.
  const span = trace.getTracer('api-logger-tests').startSpan('request');

  try {
    context.with(trace.setSpan(context.active(), span), () => {
      runWithRequestContext('api-correlation', () => {
        apiLogger.info('api logger log');
      });
    });
  } finally {
    span.end();
  }

  const [entry] = mockCapturedLogLines.map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(entry).toMatchObject({
    correlationId: 'api-correlation',
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    traceFlags: span.spanContext().traceFlags,
    msg: 'api logger log',
  });
});

it('binds exactly one module field for a module logger child', () => {
  // Fails if a module child is created from apiLogger, which already binds module: api.
  extractGroupClaim({ groups: ['group-a', 'group-b'] }, { claimName: 'groups', claimFormat: 'array_first' });

  const line = mockCapturedLogLines.find((candidate) => candidate.includes('Multiple groups found in token'));
  expect(line).toBeDefined();
  if (line === undefined) throw new Error('Expected the group-claim warning to be captured');
  expect(line.match(/"module":/g)).toHaveLength(1);
  expect((JSON.parse(line) as Record<string, unknown>).module).toBe('group-claim');
});

it('binds exactly one module field for a pre-existing module logger child', () => {
  // Fails if a pre-existing module logger remains rooted at apiLogger, which
  // already binds module: api.
  readContextCacheTtlMs({ CONTEXT_CACHE_TTL_MS: 'not-a-number' });

  const line = mockCapturedLogLines.find((candidate) => candidate.includes('CONTEXT_CACHE_TTL_MS'));
  expect(line).toBeDefined();
  if (line === undefined) throw new Error('Expected the context-cache warning to be captured');
  expect(line.match(/"module":/g)).toHaveLength(1);
  expect((JSON.parse(line) as Record<string, unknown>).module).toBe('context-cache');
});
