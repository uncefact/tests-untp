import { resolveDocument, type ResolveDocumentOptions } from './resolve-document.js';
import { ResolverInvalidJsonError } from './errors.js';

/** Default `Accept` header when the caller does not specify one. */
const DEFAULT_ACCEPT = 'application/json';

/**
 * Options for {@link resolveJsonDocument}. Extends {@link ResolveDocumentOptions}
 * with content negotiation; every SSRF / size / timeout / redirect guard from
 * the underlying {@link resolveDocument} applies unchanged.
 */
export interface ResolveJsonDocumentOptions extends ResolveDocumentOptions {
  /**
   * `Accept` header sent with the request. Defaults to `application/json`.
   * An explicit accept header in {@link ResolveDocumentOptions.headers}
   * (any casing) takes precedence over this.
   */
  accept?: string;
}

/** A JSON document fetched through the guarded resolver. */
export interface ResolvedJsonDocument {
  /** The parsed JSON value. */
  json: unknown;
  /** Final URL after redirect chasing (matches the input when there were no redirects). */
  finalUrl: string;
}

/**
 * Fetches a remote JSON document with the full SSRF / size / timeout / redirect
 * hardening of {@link resolveDocument}, then parses the body as JSON.
 *
 * This is the shared primitive behind guarded JSON-shaped fetches (JSON-LD
 * `@context` documents, JSON Schemas, catalogue documents): each URL and every
 * redirect hop passes `validatePublicUrl` and the connection is pinned to the
 * validated IP, so a crafted or redirected URL cannot reach a private address.
 *
 * @throws {UrlValidationError} for URL / scheme / private-address rejections.
 * @throws {ResolverNetworkError} when the fetch rejects before a response.
 * @throws {ResolverHttpError} on a non-2xx status (with `.status`).
 * @throws {ResolverTooLargeError} when the body exceeds the size cap.
 * @throws {ResolverTooManyRedirectsError} when the redirect chain exceeds the hop cap.
 * @throws {ResolverTimedOutError} when the total timeout fires.
 * @throws {ResolverRedirectMissingLocationError} for a 3xx with no / unparseable Location header.
 * @throws {ResolverInvalidJsonError} when the fetched body is not valid JSON.
 */
export async function resolveJsonDocument(
  url: string,
  options?: ResolveJsonDocumentOptions,
): Promise<ResolvedJsonDocument> {
  const { accept, headers, ...resolverOptions } = options ?? {};

  // HTTP header names are case-insensitive, so an accept header supplied in
  // any casing suppresses the default rather than producing a second header.
  const hasExplicitAccept = Object.keys(headers ?? {}).some((key) => key.toLowerCase() === 'accept');
  const result = await resolveDocument(url, {
    ...resolverOptions,
    headers: hasExplicitAccept ? headers : { Accept: accept ?? DEFAULT_ACCEPT, ...headers },
  });

  const text = new TextDecoder().decode(result.body);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new ResolverInvalidJsonError(result.finalUrl, cause);
  }

  return { json, finalUrl: result.finalUrl };
}
