import { isSpanContextValid, trace } from '@opentelemetry/api';

/** Returns valid active-span identifiers, or no fields when no span is active. */
export function getActiveTraceContext(): { traceId: string; spanId: string; traceFlags?: number } | undefined {
  const span = trace.getActiveSpan();
  if (span === undefined) return undefined;

  const spanContext = span.spanContext();
  if (!isSpanContextValid(spanContext)) return undefined;

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  };
}
