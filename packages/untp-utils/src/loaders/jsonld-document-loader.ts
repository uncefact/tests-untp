import type { ResolveDocumentOptions } from '../resolvers/index.js';
import type { TtlCache } from '../cache/ttl-cache.js';

/**
 * The subset of jsonld's `RemoteDocument` shape this loader returns. Carries
 * the fields jsonld.js reads at runtime; it is deliberately not assignable to
 * `@types/jsonld`'s `RemoteDocument` (whose `document: JsonLd` is narrower
 * than the `unknown` a fetched body can be), which is one reason the `toRDF`
 * call site casts its options (see `validateJsonLd`).
 */
export interface LoadedRemoteDocument {
  contextUrl?: string;
  documentUrl: string;
  document: unknown;
}

/** Options for {@link createJsonLdDocumentLoader}. */
export interface JsonLdDocumentLoaderOptions extends ResolveDocumentOptions {
  /** `Accept` header for `@context` fetches. Defaults to JSON-LD then JSON. */
  accept?: string;
  /**
   * Optional cache, keyed by URL, for resolved `@context` documents. When
   * supplied, a document fetched once is reused for the cache's TTL rather
   * than re-fetched on every expansion. Only successful fetches are cached
   * (the {@link TtlCache} contract does not cache rejected fetches), so a
   * URL the guard rejects is re-checked every time. A successfully fetched
   * and parsed document is cached even if downstream JSON-LD processing
   * later rejects it.
   */
  cache?: TtlCache<LoadedRemoteDocument>;
}

/** Default `Accept` for `@context` documents: JSON-LD, falling back to JSON. */
const CONTEXT_ACCEPT_HEADER = 'application/ld+json, application/json;q=0.9';

/**
 * Builds a jsonld document loader that fetches every remote `@context`
 * document through {@link resolveJsonDocument}, so each URL (and every
 * redirect hop) passes `validatePublicUrl` and is pinned to the validated IP
 * before any connection is made, with the resolver's size, timeout, and
 * redirect bounds applied.
 *
 * Without this loader, `jsonld.toRDF` falls back to jsonld.js's default Node
 * document loader, which fetches `@context` URLs with no SSRF protection: a
 * crafted `@context` could drive requests to internal or cloud-metadata
 * addresses during expansion. Wiring this loader in is the JSON-LD
 * document-loader guard committed to in ADR-033 §7.
 *
 * @see ../../../../docs/adrs/033-cvc-architecture.md ADR-033 §7 (Security considerations).
 * @see https://github.com/uncefact/tests-untp/issues/707
 */
export function createJsonLdDocumentLoader(
  options?: JsonLdDocumentLoaderOptions,
): (url: string) => Promise<LoadedRemoteDocument> {
  const { cache, accept, ...resolverOptions } = options ?? {};

  const load = async (url: string): Promise<LoadedRemoteDocument> => {
    // Lazy import: the resolver stack pulls in undici, which jsdom test
    // environments cannot evaluate, so it loads at fetch time to keep this
    // module importable there.
    const { resolveJsonDocument } = await import('../resolvers/index.js');
    const { json, finalUrl } = await resolveJsonDocument(url, {
      ...resolverOptions,
      accept: accept ?? CONTEXT_ACCEPT_HEADER,
    });
    return { documentUrl: finalUrl, document: json };
  };

  return cache ? (url) => cache.get(url, () => load(url)) : load;
}
