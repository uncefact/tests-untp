import { JsonLdInvalidShapeError, JsonLdValidationError } from './errors.js';
import { ResolverError, ResolverInvalidJsonError } from '../resolvers/errors.js';
import { UrlValidationError } from '../node/errors.js';

/**
 * A caller-facing description of why JSON-LD validation failed, split into
 * the two classes a caller reacts to differently: a problem with their
 * document (fix the payload) versus a remote `@context` that could not be
 * fetched or used (an environment or upstream condition; the payload may be
 * fine).
 */
/** The event and syntax-error identifiers the classifier is allowed to echo, see {@link SAFE_EVENT_FIELDS}. */
export type SafeJsonLdFields = Partial<Record<(typeof SAFE_EVENT_FIELDS)[number], string>>;

interface JsonLdFailureDescriptionBase {
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

/**
 * A remote `@context` could not be used. `context-fetch`: it could not be
 * fetched (host down, URL refused, bounds exceeded). `context-invalid`: it
 * was fetched but is not usable as a context.
 */
export interface JsonLdContextFailure extends JsonLdFailureDescriptionBase {
  kind: 'context-fetch' | 'context-invalid';
  /**
   * The resolver's structured code or the recognised jsonld.js code. Absent
   * for a URL-policy rejection on purpose: its subclasses must stay
   * indistinguishable to the caller (see {@link describeJsonLdFailure}), so
   * do not tighten this.
   */
  code?: string;
  /** The `@context` URL that failed, when jsonld.js names one; it comes from the caller's own document. */
  url?: string;
}

/** The contexts are fine and the document itself fails against them. */
export interface JsonLdDocumentFailure extends JsonLdFailureDescriptionBase {
  kind: 'document';
  /** The jsonld.js syntax-error or safe-mode event code, or this module's own `invalid document shape` code. */
  code?: string;
  /**
   * Whether jsonld.js rejected the context definitions themselves
   * (`syntax-error`) or the document's content under them
   * (`safe-mode-event`). A verifier tells its user to fix the @context in
   * the first case and the credential in the second. Absent when neither
   * shape was recognised.
   */
  source?: 'syntax-error' | 'safe-mode-event';
  /** Allowlisted identifiers from the event or syntax error, see {@link SAFE_EVENT_FIELDS}. */
  fields?: SafeJsonLdFields;
}

export type JsonLdFailureDescription = JsonLdContextFailure | JsonLdDocumentFailure;

const GENERIC_DOCUMENT_DETAIL = 'the document could not be expanded as valid JSON-LD';
const GENERIC_REMOTE_CONTEXT_DETAIL = 'a remote @context response could not be used as a JSON-LD context';
const REMOTE_CONTEXT_CHAIN_DETAIL =
  'the remote @context chain could not be resolved: too many remote contexts, or a remote context refers back to itself';
const GENERIC_REMOTE_CONTEXT_LOAD_DETAIL = 'a remote @context document could not be loaded';
const FLAT_URL_POLICY_DETAIL =
  "a remote @context URL was rejected by this service's URL policy or could not be resolved";

/** Event `details` fields safe to echo: identifiers from the caller's own document or a public context, never free-form values that can carry credential content. */
/** The only jsonld.js event and syntax-error detail fields ever echoed to a caller; everything else may carry document content. */
export const SAFE_EVENT_FIELDS = ['property', 'expandedProperty', 'id', 'type', 'term', 'language', 'vocab'] as const;
const MAX_FIELD_LENGTH = 200;

interface JsonLdProcessorError extends Error {
  details?: Record<string, unknown> & {
    event?: { code?: unknown; message?: unknown; details?: Record<string, unknown> };
  };
}

function isJsonLdProcessorError(value: unknown): value is JsonLdProcessorError {
  return value instanceof Error && value.name.startsWith('jsonld.');
}

/** The allowlisted string fields present on a details object, truncated. */
function safeFields(details: Record<string, unknown> | undefined): SafeJsonLdFields | undefined {
  const fields: SafeJsonLdFields = {};
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
 * The passes run in a load-bearing order. The rehydrated chain nests the
 * guarded loader's error BENEATH jsonld.js's own wrapper
 * (`JsonLdExpansionFailedError` -> `jsonld.InvalidUrl` -> the loader's
 * `UrlValidationError`), and the wrapper's message contains the URL, so no
 * jsonld.js message may become `detail` until the typed-loader pass has
 * exhausted the whole chain; matching the wrapper's message first would
 * reopen the per-hostname reconnaissance oracle the flat message exists to
 * close. The URL scan that runs before the typed-loader pass reads only the
 * wrapper's `details.url`, which is the caller's own document's URL.
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
    return { kind: 'document', detail: error.message, code: 'invalid document shape' };
  }

  // The failing @context URL, when jsonld.js recorded one on its wrapper: a
  // URL from the caller's document, or one a remote context it named refers
  // to. Either way it is a public URL the caller caused to be requested,
  // never the address it resolved to.
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
    if (node instanceof ResolverInvalidJsonError) {
      // Thrown only after a response body was read and failed to parse: the
      // artefact, not the delivery, is at fault.
      return { kind: 'context-invalid', detail: GENERIC_REMOTE_CONTEXT_DETAIL, code: node.code, ...(url && { url }) };
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
      // Rejected by an untyped loader path, so the typed pass found nothing:
      // the context could not be loaded, and the wrapper's message (which
      // names the URL) is not echoed.
      return { kind: 'context-fetch', detail: GENERIC_REMOTE_CONTEXT_LOAD_DETAIL, code, ...(url && { url }) };
    }
    if (node.name === 'jsonld.ContextUrlError') {
      // jsonld.js throws this only while resolving a chain of remote contexts
      // (too many, or one that refers back to itself); a cycle between local
      // term definitions is jsonld.CyclicalContext and stays a document fault.
      return { kind: 'context-fetch', detail: REMOTE_CONTEXT_CHAIN_DETAIL, ...(code && { code }), ...(url && { url }) };
    }
    if (node.name === 'jsonld.SyntaxError' && code === 'invalid scoped context') {
      // A term-scoped remote context whose body was unusable: jsonld.js
      // discards the original error, so only the term survives.
      const fields = safeFields(node.details);
      return { kind: 'context-invalid', detail: GENERIC_REMOTE_CONTEXT_DETAIL, code, ...(fields && { fields }) };
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
      // jsonld.js interpolates caller values into some syntax messages
      // (jsonld@8.3.3 lib/context.js: an @index value, a term, a type), so
      // the message is never echoed; the recognised code and the allowlisted
      // identifiers are the whole diagnostic.
      const fields = safeFields(node.details);
      return {
        kind: 'document',
        detail: code ? `Invalid JSON-LD syntax; ${code}.` : GENERIC_DOCUMENT_DETAIL,
        source: 'syntax-error',
        ...(code && { code }),
        ...(fields && { fields }),
      };
    }
    return { kind: 'document', detail: GENERIC_DOCUMENT_DETAIL };
  }

  return { kind: 'document', detail: GENERIC_DOCUMENT_DETAIL };
}
