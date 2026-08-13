import { JsonLdInvalidShapeError, JsonLdValidationError } from './errors.js';
import { ResolverError } from '../resolvers/errors.js';
import { UrlValidationError } from '../node/errors.js';

/**
 * A caller-facing description of why JSON-LD validation failed, split into
 * the two classes a caller reacts to differently: a problem with their
 * document (fix the payload) versus a remote `@context` that could not be
 * fetched or used (an environment or upstream condition; the payload may be
 * fine).
 */
export interface JsonLdFailureDescription {
  kind: 'context-fetch' | 'document';
  /**
   * Human-facing reason, safe to return to the caller. Every branch below
   * must preserve that property: detail comes only from explicitly
   * recognised shapes (the guarded loader's typed diagnostics, jsonld.js
   * safe-mode events via an allowlist of string fields, jsonld.js's fixed
   * syntax-error strings, or this package's own typed messages). Messages
   * from unrecognised errors never reach this field; unknown failures get
   * a generic message and the full chain stays on `cause` for the log.
   */
  detail: string;
}

const GENERIC_DOCUMENT_DETAIL = 'the document could not be expanded as valid JSON-LD';
const GENERIC_REMOTE_CONTEXT_DETAIL = 'a remote @context document was fetched but could not be used as a context';
const FLAT_URL_POLICY_DETAIL =
  "a remote @context URL was rejected by this service's URL policy or could not be resolved";

/** Event `details` fields safe to echo: identifiers from the caller's own document or a public context, never free-form values that can carry credential content. */
const SAFE_EVENT_FIELDS = ['property', 'expandedProperty', 'id', 'type', 'term', 'language', 'vocab'] as const;
const MAX_FIELD_LENGTH = 200;

interface JsonLdProcessorError extends Error {
  details?: { code?: unknown; event?: { message?: unknown; details?: Record<string, unknown> } };
}

function isJsonLdProcessorError(value: unknown): value is JsonLdProcessorError {
  return value instanceof Error && value.name.startsWith('jsonld.');
}

/** Formats a safe-mode event: its fixed library message plus allowlisted string fields. */
function describeSafeModeEvent(event: { message?: unknown; details?: Record<string, unknown> }): string {
  const parts: string[] = [];
  if (typeof event.message === 'string' && event.message !== '') {
    parts.push(event.message);
  }
  for (const field of SAFE_EVENT_FIELDS) {
    const value = event.details?.[field];
    if (typeof value === 'string' && value !== '') {
      parts.push(`(${field}: "${value.slice(0, MAX_FIELD_LENGTH)}")`);
    }
  }
  return parts.length > 0 ? parts.join(' ') : GENERIC_DOCUMENT_DETAIL;
}

function* causeChain(error: unknown): Generator<unknown> {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    yield current;
    current = current instanceof Error ? current.cause : undefined;
  }
}

/**
 * Classifies a {@link JsonLdValidationError} by walking its cause chain
 * (native `.cause` hops; the chain is rehydrated by `validateJsonLd`, see
 * issue #773).
 *
 * The two passes run in a load-bearing order. The rehydrated chain nests
 * the guarded loader's error BENEATH jsonld.js's own wrapper
 * (`JsonLdExpansionFailedError` -> `jsonld.InvalidUrl` -> the loader's
 * `UrlValidationError`), and the wrapper's message contains the URL, so the
 * typed-loader pass must exhaust the whole chain before any jsonld.js shape
 * is considered; matching the wrapper first would echo its message and
 * reopen the per-hostname reconnaissance oracle the flat message exists to
 * close.
 *
 * `UrlValidationError` deliberately collapses to one flat message: its
 * subclasses distinguish "does not resolve" from "resolves to a private
 * address" from "scheme not allowed", and echoing that distinction would
 * hand an authenticated caller a network-reconnaissance oracle over
 * attacker-chosen `@context` URLs. The full typed diagnostic stays on the
 * cause chain for the server-side log. `ResolverError` diagnostics fire
 * only after the URL passed the public-address check, so their detail
 * (HTTP status, timeout, size bound) is returned as-is.
 *
 * Known limitation, accepted: a malformed term definition inside a
 * successfully fetched remote context surfaces as a `jsonld.SyntaxError`
 * indistinguishable from the same defect in an inline context, and is
 * classified as a document failure.
 */
export function describeJsonLdFailure(error: JsonLdValidationError): JsonLdFailureDescription {
  // Our own pre-expansion diagnostic: safe, typed, and more precise than
  // the generic fallback (expansion never ran).
  if (error instanceof JsonLdInvalidShapeError) {
    return { kind: 'document', detail: error.message };
  }

  // Pass 1: the guarded loader's typed failures, anywhere on the chain.
  for (const node of causeChain(error)) {
    if (node instanceof UrlValidationError) {
      return { kind: 'context-fetch', detail: FLAT_URL_POLICY_DETAIL };
    }
    if (node instanceof ResolverError) {
      return { kind: 'context-fetch', detail: `could not fetch a remote @context: ${node.message}` };
    }
  }

  // Pass 2: recognised jsonld.js processor shapes (name plus details.code
  // matched exactly; the name prefix alone only locates the processor error,
  // it does not make its message caller-safe).
  for (const node of causeChain(error)) {
    if (!isJsonLdProcessorError(node)) continue;
    const code = node.details?.code;
    if (
      node.name === 'jsonld.InvalidUrl' &&
      (code === 'invalid remote context' || code === 'loading remote context failed')
    ) {
      // Fetched successfully (or rejected by an untyped loader path) but
      // unusable as a context: an upstream condition, not a payload fault.
      return { kind: 'context-fetch', detail: GENERIC_REMOTE_CONTEXT_DETAIL };
    }
    if (node.name === 'jsonld.ValidationError' && node.details?.event !== undefined) {
      return { kind: 'document', detail: describeSafeModeEvent(node.details.event) };
    }
    if (node.name === 'jsonld.SyntaxError') {
      // jsonld.js syntax-error messages are library-authored fixed strings
      // (the variable parts live in details, which is not echoed).
      return { kind: 'document', detail: node.message };
    }
    return { kind: 'document', detail: GENERIC_DOCUMENT_DETAIL };
  }

  return { kind: 'document', detail: GENERIC_DOCUMENT_DETAIL };
}
