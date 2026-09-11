/** @jest-environment node */

import { context, trace } from '@opentelemetry/api';
import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import {
  AesGcmEncryptionAdapter,
  decryptCredentialToBytes,
  EncryptionAlgorithm,
} from '@uncefact/untp-ri-services/encryption';
import { createLogger } from '@uncefact/untp-ri-services/logging';
import { getActiveTraceContext } from './trace-context';

function createCapture(): {
  destination: { write: (msg: string) => void };
  entries: () => Record<string, unknown>[];
} {
  const lines: string[] = [];
  return {
    destination: { write: (msg: string) => lines.push(msg.trim()) },
    entries: () => lines.map((line) => JSON.parse(line)),
  };
}

describe('getActiveTraceContext', () => {
  const exporter = new tracing.InMemorySpanExporter();
  const sdk = new NodeSDK({
    autoDetectResources: false,
    instrumentations: [],
    traceExporter: exporter,
    spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
  });
  const tracer = trace.getTracer('reference-implementation-tests');

  beforeAll(() => {
    sdk.start();
  });

  afterAll(async () => {
    await sdk.shutdown();
  });

  it('returns no trace context without an active span and leaves the trace keys absent', () => {
    expect(getActiveTraceContext()).toBeUndefined();

    const capture = createCapture();
    const logger = createLogger({ destination: capture.destination, traceContextProvider: getActiveTraceContext });
    logger.info({ correlationId: 'c1' }, 'outside span');

    const [entry] = capture.entries();
    expect(entry.correlationId).toBe('c1');
    expect(entry).not.toHaveProperty('traceId');
    expect(entry).not.toHaveProperty('spanId');
    expect(entry).not.toHaveProperty('traceFlags');
  });

  it('returns the active sampled span context and adds the same ids to a real log line', async () => {
    const capture = createCapture();
    const logger = createLogger({ destination: capture.destination, traceContextProvider: getActiveTraceContext });
    const span = tracer.startSpan('request');

    try {
      await context.with(trace.setSpan(context.active(), span), async () => {
        expect(getActiveTraceContext()).toEqual({
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          traceFlags: span.spanContext().traceFlags,
        });
        logger.info({ correlationId: 'c1', traceId: 'bogus', spanId: 'bogus' }, 'inside span');
      });
    } finally {
      span.end();
    }

    const [entry] = capture.entries();
    expect(entry).toMatchObject({
      correlationId: 'c1',
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      traceFlags: span.spanContext().traceFlags,
      msg: 'inside span',
    });
  });

  it('adds active trace ids to AES-GCM debug lines through an injected logger', async () => {
    const key = 'a'.repeat(64);
    const capture = createCapture();
    const encryptionLogger = createLogger({ level: 'debug' });
    const envelope = new AesGcmEncryptionAdapter(key, encryptionLogger).encrypt(
      'secret',
      EncryptionAlgorithm.AES_256_GCM,
    );
    const logger = createLogger({
      level: 'debug',
      destination: capture.destination,
      traceContextProvider: getActiveTraceContext,
    });
    const span = tracer.startSpan('decrypt-credential');

    try {
      await context.with(trace.setSpan(context.active(), span), async () => {
        const decrypted = decryptCredentialToBytes({ ...envelope, key }, logger);
        expect(Buffer.from(decrypted).toString('utf8')).toBe('secret');
      });
    } finally {
      span.end();
    }

    const entries = capture.entries();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.msg)).toEqual(['Decrypting data', 'Data decrypted successfully']);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        traceFlags: span.spanContext().traceFlags,
      });
    }
  });

  it('includes ids from a valid non-recording span', () => {
    const span = trace.wrapSpanContext({
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      traceFlags: 0,
    });
    const capture = createCapture();
    const logger = createLogger({ destination: capture.destination, traceContextProvider: getActiveTraceContext });

    context.with(trace.setSpan(context.active(), span), () => {
      logger.info('inside non-recording span');
    });

    const [entry] = capture.entries();
    expect(entry).toMatchObject({
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      traceFlags: 0,
      msg: 'inside non-recording span',
    });
  });
});
