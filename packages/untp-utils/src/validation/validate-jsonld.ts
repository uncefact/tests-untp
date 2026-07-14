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
 *   includes a remote `@context` failing the SSRF guard).
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

  try {
    // The options cast bridges @types/jsonld, which types documentLoader with
    // a legacy callback signature; jsonld.js itself accepts the
    // single-argument promise-returning loader used here.
    await jsonld.toRDF(
      document as JsonLdDocument,
      { safe: options?.safe ?? true, documentLoader } as Parameters<typeof jsonld.toRDF>[1],
    );
  } catch (cause) {
    throw new JsonLdExpansionFailedError(cause);
  }
}
