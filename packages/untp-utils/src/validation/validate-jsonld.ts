import type { JsonLdDocument } from 'jsonld';
import type { TtlCache } from '../cache/ttl-cache.js';
import type { LoadedRemoteDocument } from '../loaders/jsonld-document-loader.js';
import { JsonLdExpansionFailedError, JsonLdInvalidShapeError } from './errors.js';

export interface ValidateJsonLdOptions {
  /** Whether to use safe mode for JSON-LD expansion. Defaults to true. */
  safe?: boolean;
  /**
   * Optional cache, keyed by URL, for resolved remote `@context` documents.
   * Supplying a shared cache avoids re-fetching the same contexts on every
   * validation (e.g. the credential context on the issuance/verification
   * hot path). Only successful fetches are cached, so a URL the SSRF guard
   * rejects is re-checked every time. A successfully fetched and parsed
   * document is cached even if expansion later rejects it.
   */
  contextCache?: TtlCache<LoadedRemoteDocument>;
}

/**
 * jsonld.js's own `JsonLdError` wraps a document loader's rejection in the
 * proprietary `details.cause` and never sets native `Error.cause`
 * (jsonld@8.3.3 `lib/JsonLdError.js`, loader wrap in
 * `lib/ContextResolver.js`), so a plain `.cause` walk over a caught
 * expansion failure dead-ends one hop early: the SSRF guard's rejection
 * (see `createJsonLdDocumentLoader`) is reachable only via the non-standard
 * `error.details.cause`, unlike the schema-fetch path (`schema-loader.ts`),
 * which surfaces the same class of rejection on the native chain.
 *
 * A term's own remote `@context` (a JSON-LD 1.1 "scoped context") loses even
 * that: jsonld.js resolves it through the same loader, but on failure its
 * scoped-context branch (`lib/context.js`) discards the loader's error
 * entirely and throws a fresh `JsonLdError` whose `details` carry no `cause`
 * at all. `fallback` recovers the guard's rejection in that case: `toRDF`'s
 * `documentLoader` is wrapped ({@link validateJsonLd}) to record the last
 * error it threw during the call, and that call-scoped record is passed here
 * as `fallback`. Because jsonld.js resolves `@context` documents one at a
 * time and any loader throw immediately aborts the whole call (no later,
 * unrelated loader call can follow one that failed), a recorded loader error
 * is always the proximate cause of whatever expansion failure this function
 * is asked to rehydrate, whether or not jsonld.js chose to keep its own
 * reference to it.
 *
 * Rehydrates the recovered error (preferring `details.cause` when jsonld.js
 * kept it) onto `error.cause` so a plain `.cause` walk reaches it. Mutates
 * and returns the same object jsonld.js just threw for this call (safe:
 * nothing else holds a reference to it), and only when there is something to
 * recover and jsonld.js has not already set a `cause` itself, so a malformed
 * `@context` that never reached the document loader (and so has nothing
 * buried and no fallback recorded) does not gain a spurious one.
 *
 * @see https://github.com/uncefact/tests-untp/issues/773
 */
function rehydrateJsonLdCause(error: unknown, fallback?: unknown): unknown {
  if (!(error instanceof Error) || error.cause !== undefined) {
    return error;
  }
  const buried = (error as Error & { details?: { cause?: unknown } }).details?.cause;
  const recovered = buried !== undefined ? buried : fallback;
  if (recovered !== undefined) {
    error.cause = recovered;
  }
  return error;
}

/**
 * Catches malformed contexts, undefined terms, and structurally invalid
 * linked data by expanding to RDF in safe mode (unless explicitly disabled).
 *
 * Expansion resolves every remote `@context` through a guarded document
 * loader ({@link createJsonLdDocumentLoader}) so `@context` fetches pass the
 * `validatePublicUrl` SSRF guard rather than jsonld.js's default unguarded
 * Node loader. See ADR-033 §7 and issue #707.
 *
 * @see https://github.com/digitalbazaar/jsonld.js#safe-mode jsonld.js safe mode (a jsonld.js option, not a W3C-defined term).
 * @see ../../../../docs/adrs/033-cvc-architecture.md ADR-033 §7 (Security considerations).
 * @throws {JsonLdInvalidShapeError} if `document` is not a non-null object.
 * @throws {JsonLdExpansionFailedError} if `jsonld.toRDF` rejects (which
 *   includes a remote `@context` failing the SSRF guard; the guard's
 *   rejection is reachable via native `.cause` hops off the thrown error,
 *   see {@link rehydrateJsonLdCause}).
 */
export async function validateJsonLd(document: unknown, options?: ValidateJsonLdOptions): Promise<void> {
  if (typeof document !== 'object' || document === null) {
    throw new JsonLdInvalidShapeError(document);
  }

  // Dynamic import: jsonld pulls in undici/TextDecoder which aren't
  // available in jsdom, so we load it lazily to allow test mocking. The
  // guarded document loader is loaded lazily for the same reason (it depends
  // on the resolvers/node stack, which uses undici and node:dns).
  const jsonldModule = await import('jsonld');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonld = ('default' in jsonldModule ? (jsonldModule as any).default : jsonldModule) as typeof import('jsonld');
  const { createJsonLdDocumentLoader } = await import('../loaders/jsonld-document-loader.js');
  const documentLoader = createJsonLdDocumentLoader({ cache: options?.contextCache });

  // Recorded for rehydrateJsonLdCause's fallback: the last error the loader
  // threw during this call (undefined if every fetch it made succeeded).
  let lastLoaderError: unknown;
  const trackedDocumentLoader = async (url: string): Promise<LoadedRemoteDocument> => {
    try {
      return await documentLoader(url);
    } catch (loaderError) {
      lastLoaderError = loaderError;
      throw loaderError;
    }
  };

  try {
    // The options cast bridges @types/jsonld, which types documentLoader with
    // a legacy callback signature; jsonld.js itself accepts the
    // single-argument promise-returning loader used here.
    await jsonld.toRDF(
      document as JsonLdDocument,
      { safe: options?.safe ?? true, documentLoader: trackedDocumentLoader } as Parameters<typeof jsonld.toRDF>[1],
    );
  } catch (cause) {
    throw new JsonLdExpansionFailedError(rehydrateJsonLdCause(cause, lastLoaderError));
  }
}
