/** Browser-side schema transport. Every schema is fetched through the guarded `/api/schema` route, so this module owns no host policy: it owns the session cache, the request budget, and a typed error its consumers classify. */

import { StructuredError, type StructuredErrorInit } from '@uncefact/untp-utils';
import { createInMemoryTtlCache } from '@uncefact/untp-utils/cache';
import { API_BASE_PATH } from '../../constants';

/** Parsed categories emitted by the guarded `/api/schema` route. */
export type SchemaFetchCategory = 'unreachable' | 'upstream-status' | 'invalid-json' | 'uncoded';

/** Why a schema fetch failed. `unreadable-response` means the proxy answered but its body could not be read. */
export type SchemaFetchReason = 'timeout' | 'not-found' | 'network' | 'parse' | 'unreadable-response';

export interface SchemaFetchErrorInit extends StructuredErrorInit {
  schemaUrl: string;
  category: SchemaFetchCategory;
  serviceStatus?: number;
  upstreamStatus?: number;
  reason: SchemaFetchReason;
  browserSide?: boolean;
}

export class SchemaFetchError extends StructuredError {
  readonly schemaUrl: string;
  readonly category: SchemaFetchCategory;
  readonly serviceStatus?: number;
  readonly upstreamStatus?: number;
  readonly reason: SchemaFetchReason;
  readonly browserSide?: boolean;

  constructor(init: SchemaFetchErrorInit) {
    super(init);
    this.schemaUrl = init.schemaUrl;
    this.category = init.category;
    this.serviceStatus = init.serviceStatus;
    this.upstreamStatus = init.upstreamStatus;
    this.reason = init.reason;
    this.browserSide = init.browserSide;
    this.name = 'SchemaFetchError';
  }
}

/** Reasons a selected schema cannot be identified before validation starts. */
export type SchemaSelectionReason =
  | 'version-not-detected'
  | 'unknown-type'
  | 'unsupported-extension-version'
  | 'vcdm-version-unmapped'
  | 'scheme-version-unsupported'
  | 'builder';

/** A document declared a value that the Playground could not select a schema for. */
export class SchemaSelectionError extends Error {
  readonly reason: SchemaSelectionReason;

  constructor(message: string, reason: SchemaSelectionReason) {
    super(message);
    this.name = 'SchemaSelectionError';
    this.reason = reason;
  }
}

/**
 * Parsed schemas by URL, shared by every family for one browser session. Two
 * concurrent callers for one URL share the in-flight promise, and a failed
 * fetch is never stored, so the retry the failure copy advises does reach the
 * network.
 */
export const schemaCache = createInMemoryTtlCache<any>({ ttlMs: 60 * 60 * 1000, maxEntries: 200 });

/** One budget covering the proxy request and reading its body; exceeding it is reported as a fetch failure, not as a fault in the artefact. */
export const SCHEMA_FETCH_TIMEOUT_MS = 15_000;

export function fetchSchema(schemaUrl: string): Promise<any> {
  return schemaCache.get(schemaUrl, () => fetchFromProxy(schemaUrl));
}

function makeError(
  message: string,
  schemaUrl: string,
  category: SchemaFetchCategory,
  reason: SchemaFetchReason,
  serviceStatus?: number,
  upstreamStatus?: number,
  browserSide?: boolean,
): SchemaFetchError {
  return new SchemaFetchError({
    code: 'playground.schema.fetch',
    message,
    schemaUrl,
    category,
    reason,
    ...(serviceStatus === undefined ? {} : { serviceStatus }),
    ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
    ...(browserSide ? { browserSide: true } : {}),
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function abortError(): Error {
  return Object.assign(new Error('The response body read was aborted.'), { name: 'AbortError' });
}

async function readJsonWithAbort(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    response
      .json()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function fetchFromProxy(schemaUrl: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCHEMA_FETCH_TIMEOUT_MS);
  let responseStatus: number | undefined;

  try {
    const response = await fetch(`${API_BASE_PATH}/api/schema?url=${encodeURIComponent(schemaUrl)}`, {
      signal: controller.signal,
    });
    responseStatus = response.status;

    let body: unknown;
    try {
      body = await readJsonWithAbort(response, controller.signal);
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === 'AbortError') throw error;
      throw makeError(
        `The Playground schema service returned an unreadable response for "${schemaUrl}".`,
        schemaUrl,
        'uncoded',
        'unreadable-response',
        response.status,
        undefined,
        true,
      );
    }

    if (!response.ok) {
      const errorMessage =
        isObject(body) && typeof body.error === 'string'
          ? body.error
          : `Schema service returned status ${response.status}`;
      const category: SchemaFetchCategory =
        isObject(body) && (body.code === 'upstream-status' || typeof body.upstreamStatus === 'number')
          ? 'upstream-status'
          : isObject(body) && body.code === 'invalid-json'
            ? 'invalid-json'
            : isObject(body) && body.code === 'unreachable'
              ? 'unreachable'
              : 'uncoded';
      const upstream = isObject(body) && typeof body.upstreamStatus === 'number' ? body.upstreamStatus : undefined;
      const reason: SchemaFetchReason =
        category === 'invalid-json'
          ? 'parse'
          : category === 'upstream-status' && upstream !== undefined && upstream >= 400 && upstream < 500
            ? 'not-found'
            : 'network';
      throw makeError(`${errorMessage} (${schemaUrl}).`, schemaUrl, category, reason, response.status, upstream);
    }

    return body;
  } catch (error) {
    if (error instanceof SchemaFetchError) throw error;
    if ((error as { name?: unknown } | null)?.name === 'AbortError') {
      throw makeError(
        `Schema fetch timed out after ${SCHEMA_FETCH_TIMEOUT_MS / 1000}s.`,
        schemaUrl,
        'uncoded',
        'timeout',
        responseStatus,
        undefined,
        true,
      );
    }
    throw makeError(
      `The Playground schema service could not be reached for "${schemaUrl}".`,
      schemaUrl,
      'uncoded',
      'network',
      responseStatus,
      undefined,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}
