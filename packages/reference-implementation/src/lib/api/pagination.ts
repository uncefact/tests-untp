import { z } from 'zod';

export const paginationMetaSchema = z.object({
  total: z.number().int().describe('Total number of records matching the query'),
  limit: z.number().int().describe('Maximum records per page'),
  offset: z.number().int().describe('Number of records skipped'),
  hasMore: z.boolean().describe('Whether more records exist beyond this page'),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

const BASE_DEFAULT_PAGE_LIMIT = 20;
const DEFAULT_MAX_PAGE_LIMIT = 100;

/**
 * Resolves the maximum page size a list request may ask for from the
 * `API_MAX_PAGE_LIMIT` environment variable, so an operator can raise or lower
 * the bound for their deployment. An absent variable resolves to
 * DEFAULT_MAX_PAGE_LIMIT silently. A supplied value must be a positive integer;
 * a supplied-but-unusable value (blank, non-integer, below 1) resolves to the
 * default and sets `overrideRejected`, so the caller can warn the operator that
 * their setting was not applied (issue #834). An empty string counts as
 * supplied-but-unusable rather than absent, because a config template that
 * expands an unset variable to `""` is a mistake worth surfacing.
 */
export function resolveMaxPageLimit(raw: string | undefined): { value: number; overrideRejected: boolean } {
  if (raw === undefined) {
    return { value: DEFAULT_MAX_PAGE_LIMIT, overrideRejected: false };
  }
  const trimmed = raw.trim();
  const parsed = Number(trimmed);
  if (/^\d+$/.test(trimmed) && Number.isSafeInteger(parsed) && parsed >= 1) {
    return { value: parsed, overrideRejected: false };
  }
  return { value: DEFAULT_MAX_PAGE_LIMIT, overrideRejected: true };
}

/**
 * Warns the operator, through the supplied logger, when API_MAX_PAGE_LIMIT was
 * set to a value that could not be used, so a misconfigured deployment learns
 * its setting was ignored. Called once from the Node server startup hook
 * (instrumentation.node.ts). The logger is a parameter so this module holds no
 * server-only logging import and stays safe in the client bundle, which reaches
 * this file through DEFAULT_PAGE_LIMIT (issue #834).
 */
export function warnOnRejectedMaxPageLimitOverride(logger: {
  warn: (context: Record<string, unknown>, message: string) => void;
}): void {
  const raw = process.env.API_MAX_PAGE_LIMIT;
  const resolved = resolveMaxPageLimit(raw);
  if (resolved.overrideRejected) {
    logger.warn(
      { API_MAX_PAGE_LIMIT: raw, appliedMaximum: resolved.value },
      'API_MAX_PAGE_LIMIT must be a positive integer; applying the default maximum page limit instead',
    );
  }
}

const resolvedMaxPageLimit = resolveMaxPageLimit(process.env.API_MAX_PAGE_LIMIT);

/**
 * Maximum page size a list request may ask for, resolved once at startup from
 * `API_MAX_PAGE_LIMIT` (default DEFAULT_MAX_PAGE_LIMIT). The route-boundary
 * pagination schema (paginationQuerySchema) rejects a `limit` above this rather
 * than clamping it, so a client is told the bound rather than handed a quietly
 * smaller page (ADR-037). Routes not yet migrated to that schema still clamp to
 * this value directly. #834 is the foundation change only.
 *
 * This bound is deliberately not published as an OpenAPI `maximum` constraint.
 * The API documentation page is prerendered as static content, so a value in the
 * specification would freeze at the build-time default and misdescribe a
 * reconfigured deployment. Making the specification deployment-accurate would add
 * disproportionate machinery for one value. The runtime 400 above is the single
 * source of truth for the bound, and the lever is documented for operators (the
 * API Pagination operations doc), not for the API client (issue #834).
 */
export const MAX_PAGE_LIMIT = resolvedMaxPageLimit.value;

/**
 * Page size applied when a list request omits `limit`, bounded by
 * MAX_PAGE_LIMIT so that an operator who lowers the maximum below the base
 * default still receives responses within their configured maximum, including
 * on the common no-limit request (issue #834).
 */
export const DEFAULT_PAGE_LIMIT = Math.min(BASE_DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  limit?: number,
  offset?: number,
): PaginatedResponse<T> {
  const effectiveLimit = limit ?? DEFAULT_PAGE_LIMIT;
  const effectiveOffset = offset ?? 0;
  return {
    data,
    pagination: {
      total,
      limit: effectiveLimit,
      offset: effectiveOffset,
      hasMore: effectiveOffset + data.length < total,
    },
  };
}

/**
 * Slices a fully-materialised array to the requested page and wraps it. For
 * endpoints that must load the whole result set before paging (e.g. the CVC
 * browse routes, which dedupe across tenant lanes), rather than paging at the
 * database. Pass the same `limit`/`offset` already parsed and bounded by the
 * route (rejected above the maximum on schema routes, clamped on legacy ones).
 */
export function paginateInMemory<T>(items: T[], limit?: number, offset?: number): PaginatedResponse<T> {
  const start = offset ?? 0;
  const page = items.slice(start, start + (limit ?? DEFAULT_PAGE_LIMIT));
  return buildPaginatedResponse(page, items.length, limit, offset);
}
