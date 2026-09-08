/**
 * Browser-side schema transport shared by the conformity-scheme and link set validators (#988).
 *
 * Every schema reaches the browser through the guarded `/api/schema` route, so this module owns
 * nothing about hosts or SSRF: it owns the session cache every family reads (the utils TTL cache,
 * which also de-duplicates concurrent requests), a bounded timeout, and a reason-based error the
 * consumers map to their own copy. The credential validator
 * keeps its own fetcher and status-based error (`schemaValidation.ts`); folding it in is tracked
 * as a follow-up because its consumers read `status` and `upstreamStatus` rather than a reason.
 */

import { createInMemoryTtlCache } from '@uncefact/untp-utils/cache';
import { API_BASE_PATH } from '../../constants';

/**
 * Parsed schemas by URL, shared by every family so a schema is fetched once per session. The same
 * utils cache the `/api/schema` route uses server-side, with the same bounds: it de-duplicates
 * concurrent requests for one URL and never stores a failed fetch, so a retry after an outage
 * goes to the network again.
 */
export const schemaCache = createInMemoryTtlCache<any>({ ttlMs: 60 * 60 * 1000, maxEntries: 200 });

const SCHEMA_FETCH_TIMEOUT_MS = 15_000;

export type SchemaFetchReason = 'timeout' | 'not-found' | 'network' | 'parse';

export class SchemaFetchError extends Error {
  constructor(
    public readonly schemaUrl: string,
    public readonly reason: SchemaFetchReason,
    message: string,
  ) {
    super(message);
    this.name = 'SchemaFetchError';
  }
}

export function fetchSchema(schemaUrl: string): Promise<any> {
  return schemaCache.get(schemaUrl, () => fetchFromProxy(schemaUrl));
}

async function fetchFromProxy(schemaUrl: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCHEMA_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_PATH}/api/schema?url=${encodeURIComponent(schemaUrl)}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      // The proxy answers 502 for any upstream failure and names the category
      // and the upstream status in its body, so both are read from there.
      const body = await response.json().catch(() => null);
      // The published hosts answer 403, not 404, for a missing path, so any
      // upstream 4xx is read as "nothing published at this URL".
      const upstream = typeof body?.upstreamStatus === 'number' ? body.upstreamStatus : undefined;
      if (upstream !== undefined && upstream >= 400 && upstream < 500) {
        throw new SchemaFetchError(schemaUrl, 'not-found', `No schema published at ${schemaUrl} (status ${upstream}).`);
      }
      const reason = typeof body?.error === 'string' ? body.error : `Schema service returned ${response.status}`;
      throw new SchemaFetchError(
        schemaUrl,
        body?.code === 'invalid-json' ? 'parse' : 'network',
        `${reason} (${schemaUrl}).`,
      );
    }
    try {
      return await response.json();
    } catch (err) {
      // The timeout can fire while the body is still streaming; that is a timeout, not a
      // malformed schema, so let the outer handler classify it.
      if ((err as { name?: unknown } | null)?.name === 'AbortError') throw err;
      throw new SchemaFetchError(schemaUrl, 'parse', `Schema at ${schemaUrl} is not valid JSON.`);
    }
  } catch (err) {
    if (err instanceof SchemaFetchError) throw err;
    // DOMException extends Error in current runtimes but not everywhere fetch is polyfilled.
    if ((err as { name?: unknown } | null)?.name === 'AbortError') {
      throw new SchemaFetchError(
        schemaUrl,
        'timeout',
        `Schema fetch timed out after ${SCHEMA_FETCH_TIMEOUT_MS / 1000}s.`,
      );
    }
    throw new SchemaFetchError(schemaUrl, 'network', err instanceof Error ? err.message : 'Unknown network error.');
  } finally {
    clearTimeout(timeout);
  }
}
