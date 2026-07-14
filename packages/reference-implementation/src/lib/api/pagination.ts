import { z } from 'zod';

export const paginationMetaSchema = z.object({
  total: z.number().int().describe('Total number of records matching the query'),
  limit: z.number().int().describe('Maximum records per page'),
  offset: z.number().int().describe('Number of records skipped'),
  hasMore: z.boolean().describe('Whether more records exist beyond this page'),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/**
 * Caps a validated `limit` at MAX_PAGE_LIMIT, leaving an absent limit
 * undefined so the repository applies its own default. Used by every list
 * route after parsing the query so a client cannot request an unbounded page.
 */
export function clampLimit(limit?: number): number | undefined {
  return limit !== undefined ? Math.min(limit, MAX_PAGE_LIMIT) : undefined;
}

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
 * database. Pass the same `limit`/`offset` already parsed and capped by the
 * route.
 */
export function paginateInMemory<T>(items: T[], limit?: number, offset?: number): PaginatedResponse<T> {
  const start = offset ?? 0;
  const page = items.slice(start, start + (limit ?? DEFAULT_PAGE_LIMIT));
  return buildPaginatedResponse(page, items.length, limit, offset);
}
