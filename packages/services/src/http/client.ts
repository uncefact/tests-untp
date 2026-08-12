import { CORRELATION_ID_HEADER, getOrMintCorrelationId } from '../logging/correlation-id.js';

export interface HttpClientOptions extends RequestInit {
  /**
   * Whether to send the request-scoped `x-correlation-id` header. Defaults to
   * true, which is correct for calls to UNTP services participating in
   * cross-service log correlation (storage, IDR, VC, DID). Pass false for
   * third-party hosts (arbitrary `did:web` domains, credential URIs, JSON-LD
   * contexts): they gain nothing from the ID, and internal request
   * identifiers should not leak to hosts outside the operator's aggregation.
   */
  correlate?: boolean;
}

/**
 * The single outbound HTTP entry point for this package (#654). An ESLint
 * restriction bans bare `fetch` elsewhere under `src/`, so correlation-header
 * propagation cannot be forgotten at individual call sites.
 */
export async function httpFetch(input: string | URL, options: HttpClientOptions = {}): Promise<Response> {
  const { correlate = true, ...init } = options;
  const headers = new Headers(init.headers);

  if (correlate) {
    // The request context is authoritative: a caller-supplied header is
    // overwritten, so a stale or malformed value can never displace the
    // active request's ID, and a valid ID always reaches downstream.
    headers.set(CORRELATION_ID_HEADER, getOrMintCorrelationId());
  } else {
    // Exclusion means exclusion: strip the header even if a caller set one,
    // so internal request identifiers never reach third-party hosts.
    headers.delete(CORRELATION_ID_HEADER);
  }
  return fetch(input, { ...init, headers });
}
