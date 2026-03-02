export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
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
  const effectiveLimit = limit ?? 20;
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
