import { getRequestContext } from './request-context.js';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

const MAX_CORRELATION_ID_LENGTH = 128;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Zero-trust check for inbound correlation IDs, shared by every UNTP service
 * in this repository that accepts them. Mirrors the storage service's
 * `src/middleware/correlation-id.ts` posture: length-capped, alphanumeric
 * plus `-` and `_`. Reject-and-replace callers must not echo the offending
 * value into logs.
 */
export function isValidCorrelationId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_CORRELATION_ID_LENGTH && CORRELATION_ID_PATTERN.test(value);
}

/**
 * Extracts the Root token from an AWS `X-Amzn-Trace-Id` header value
 * (`Root=1-67891233-abcdef012345678912345678;Parent=...`). The raw header can
 * never pass {@link isValidCorrelationId} (it carries `=` and `;`), but the
 * Root token is hex-and-hyphens and flows cleanly through every UNTP
 * service's validator, joining RI logs to ALB access logs and X-Ray. Returns
 * null when no valid Root token is present.
 */
export function amznTraceRootToken(headerValue: string): string | null {
  const match = /(?:^|;)Root=([^;]+)/.exec(headerValue);
  const root = match?.[1];
  // Strict X-Ray Root syntax (1-<8 hex>-<24 hex>), not merely fleet-valid:
  // anything looser would launder arbitrary attacker-chosen strings into a
  // value the logs present as an AWS trace ID.
  return root && /^1-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{24}$/.test(root) ? root : null;
}

/**
 * The current request's correlation ID, or a freshly minted one when running
 * outside a request context (e.g. a background job), so downstream services
 * always receive a valid ID.
 */
export function getOrMintCorrelationId(): string {
  return getRequestContext()?.correlationId ?? randomUuid();
}

/**
 * Web Crypto (globalThis.crypto) rather than node:crypto: this module is
 * imported by the Next.js Edge middleware bundle via the logging barrel, and
 * a node:crypto import trips Edge-runtime build warnings. randomUUID is
 * available in Node and Edge; the getRandomValues fallback covers runtimes
 * that expose only the lower-level primitive (e.g. jsdom).
 */
function randomUuid(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
