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
  /**
   * `context-fetch`: a remote `@context` could not be fetched (host down,
   * URL refused, bounds exceeded). `context-invalid`: a remote `@context`
   * was fetched but is not usable as a context. `document`: the contexts
   * are fine and the document itself fails against them.
   */
  kind: 'context-fetch' | 'context-invalid' | 'document';
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
  /**
   * The recognised jsonld.js code (`details.code` of a syntax or URL error,
   * or the safe-mode event code) or the resolver's structured code. Never
   * set for a URL-policy rejection, whose subclasses must stay
   * indistinguishable to the caller.
   */
  code?: string;
  /** The `@context` URL that failed, when jsonld.js names one; it comes from the caller's own document. */
  url?: string;
  /**
   * For `document` failures: whether jsonld.js rejected the context
   * definitions themselves (`syntax-error`) or the document's content under
   * them (`safe-mode-event`). A verifier tells its user to fix the @context
   * in the first case and the credential in the second.
   */
  source?: 'syntax-error' | 'safe-mode-event';
  /** Allowlisted identifiers from a safe-mode event or syntax error (property, term, id, type, language, vocab). */
  fields?: Partial<Record<(typeof SAFE_EVENT_FIELDS)[number], string>>;
}

const GENERIC_DOCUMENT_DETAIL = 'the document could not be expanded as valid JSON-LD';
const GENERIC_REMOTE_CONTEXT_DETAIL = 'a remote @context document was fetched but could not be used as a context';
const FLAT_URL_POLICY_DETAIL =
  "a remote @context URL was rejected by this service's URL policy or could not be resolved";

/** Event `details` fields safe to echo: identifiers from the caller's own document or a public context, never free-form values that can carry credential content. */
const SAFE_EVENT_FIELDS = ['property', 'expandedProperty', 'id', 'type', 'term', 'language', 'vocab'] as const;
const MAX_FIELD_LENGTH = 200;

interface JsonLdProcessorError extends Error {
  details?: {
    code?: unknown;
    url?: unknown;
    term?: unknown;
    event?: { code?: unknown; message?: unknown; details?: Record<string, unknown> };
  };
}

function isJsonLdProcessorError(value: unknown): value is JsonLdProcessorError {
  return value instanceof Error && value.name.startsWith('jsonld.');
}

/** The allowlisted string fields present on a details object, truncated. */
function safeFields(details: Record<string, unknown> | undefined): JsonLdFailureDescription['fields'] | undefined {
  const fields: Partial<Record<(typeof SAFE_EVENT_FIELDS)[number], string>> = {};
  for (const field of SAFE_EVENT_FIELDS) {
    const value = details?.[field];
    if (typeof value === 'string' && value !== '') fields[field] = value.slice(0, MAX_FIELD_LENGTH);
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

/** Formats a safe-mode event: its fixed library message plus allowlisted string fields. */
function describeSafeModeEvent(event: { message?: unknown; details?: Record<string, unknown> }): string {
  const parts: string[] = [];
  if (typeof event.message === 'string' && event.message !== '') {
    parts.push(event.message);
  }
  for (const [field, value] of Object.entries(safeFields(event.details) ?? {})) {
    parts.push(`(${field}: "${value}")`);
  }
  return parts.length > 0 ? parts.join(' ') : GENERIC_DOCUMENT_DETAIL;
}

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

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

  // The failing @context URL, when jsonld.js recorded one on its wrapper.
  // It is the caller's own document's URL, so it is safe to hand back.
  let url: string | undefined;
  for (const node of causeChain(error)) {
    if (isJsonLdProcessorError(node) && node.name === 'jsonld.InvalidUrl') {
      url = stringOr(node.details?.url);
      break;
    }
  }

  // Pass 1: the guarded loader's typed failures, anywhere on the chain.
  for (const node of causeChain(error)) {
    if (node instanceof UrlValidationError) {
      return { kind: 'context-fetch', detail: FLAT_URL_POLICY_DETAIL, ...(url && { url }) };
    }
    if (node instanceof ResolverError) {
      return {
        kind: 'context-fetch',
        detail: `could not fetch a remote @context: ${node.message}`,
        code: node.code,
        ...(url && { url }),
      };
    }
  }

  // Pass 2: recognised jsonld.js processor shapes (name plus details.code
  // matched exactly; the name prefix alone only locates the processor error,
  // it does not make its message caller-safe).
  for (const node of causeChain(error)) {
    if (!isJsonLdProcessorError(node)) continue;
    const code = stringOr(node.details?.code);
    if (node.name === 'jsonld.InvalidUrl' && code === 'invalid remote context') {
      // Fetched successfully but not usable as a context: the artefact, not
      // the document, is at fault.
      return { kind: 'context-invalid', detail: GENERIC_REMOTE_CONTEXT_DETAIL, code, ...(url && { url }) };
    }
    if (node.name === 'jsonld.InvalidUrl' && code === 'loading remote context failed') {
      // Rejected by an untyped loader path: could not be loaded at all.
      return { kind: 'context-fetch', detail: GENERIC_REMOTE_CONTEXT_DETAIL, code, ...(url && { url }) };
    }
    if (node.name === 'jsonld.ValidationError' && node.details?.event !== undefined) {
      const event = node.details.event;
      const fields = safeFields(event.details);
      return {
        kind: 'document',
        detail: describeSafeModeEvent(event),
        source: 'safe-mode-event',
        ...(stringOr(event.code) && { code: stringOr(event.code) }),
        ...(fields && { fields }),
      };
    }
    if (node.name === 'jsonld.SyntaxError') {
      // jsonld.js syntax-error messages are library-authored fixed strings
      // (the variable parts live in details; only the allowlisted identifiers
      // are echoed).
      const fields = safeFields(node.details as Record<string, unknown> | undefined);
      return {
        kind: 'document',
        detail: node.message,
        source: 'syntax-error',
        ...(code && { code }),
        ...(fields && { fields }),
      };
    }
    return { kind: 'document', detail: GENERIC_DOCUMENT_DETAIL };
  }

  return { kind: 'document', detail: GENERIC_DOCUMENT_DETAIL };
}
