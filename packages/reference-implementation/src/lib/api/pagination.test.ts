import {
  buildPaginatedResponse,
  clampLimit,
  paginateInMemory,
  paginationMetaSchema,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from './pagination';

describe('clampLimit', () => {
  it('leaves an absent limit undefined so the repository applies its own default', () => {
    expect(clampLimit(undefined)).toBeUndefined();
  });

  it('passes a limit below the cap through unchanged', () => {
    expect(clampLimit(50)).toBe(50);
  });

  it('passes the cap value through unchanged', () => {
    expect(clampLimit(MAX_PAGE_LIMIT)).toBe(MAX_PAGE_LIMIT);
  });

  it('caps a limit above the maximum at MAX_PAGE_LIMIT', () => {
    expect(clampLimit(MAX_PAGE_LIMIT + 1)).toBe(MAX_PAGE_LIMIT);
    expect(clampLimit(100000)).toBe(MAX_PAGE_LIMIT);
  });
});

describe('buildPaginatedResponse', () => {
  it('returns correct pagination metadata with explicit limit and offset', () => {
    const items = [{ id: 1 }, { id: 2 }];

    const result = buildPaginatedResponse(items, 10, 2, 0);

    expect(result).toEqual({
      data: items,
      pagination: {
        total: 10,
        limit: 2,
        offset: 0,
        hasMore: true,
      },
    });
  });

  it('sets hasMore to false on the last page', () => {
    const items = [{ id: 9 }, { id: 10 }];

    const result = buildPaginatedResponse(items, 10, 5, 8);

    expect(result).toEqual({
      data: items,
      pagination: {
        total: 10,
        limit: 5,
        offset: 8,
        hasMore: false,
      },
    });
  });

  it('defaults limit to DEFAULT_PAGE_LIMIT and offset to 0 when not provided', () => {
    const items = [{ id: 1 }];

    const result = buildPaginatedResponse(items, 50);

    expect(result.pagination.limit).toBe(DEFAULT_PAGE_LIMIT);
    expect(result.pagination.offset).toBe(0);
    expect(result.pagination.hasMore).toBe(true);
  });

  it('returns empty data with hasMore false when there are zero results', () => {
    const result = buildPaginatedResponse([], 0);

    expect(result).toEqual({
      data: [],
      pagination: {
        total: 0,
        limit: DEFAULT_PAGE_LIMIT,
        offset: 0,
        hasMore: false,
      },
    });
  });

  it('sets hasMore to false when offset + data length equals total', () => {
    const items = [{ id: 3 }, { id: 4 }];

    const result = buildPaginatedResponse(items, 4, 2, 2);

    expect(result).toEqual({
      data: items,
      pagination: {
        total: 4,
        limit: 2,
        offset: 2,
        hasMore: false,
      },
    });
  });
});

describe('paginateInMemory', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: i }));

  it('slices the page by limit and offset and reports the full total', () => {
    const result = paginateInMemory(items, 2, 1);

    expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.pagination).toEqual({ total: 5, limit: 2, offset: 1, hasMore: true });
  });

  it('defaults to DEFAULT_PAGE_LIMIT and offset 0 when not provided', () => {
    const result = paginateInMemory(items);

    expect(result.data).toEqual(items);
    expect(result.pagination).toEqual({ total: 5, limit: DEFAULT_PAGE_LIMIT, offset: 0, hasMore: false });
  });

  it('returns an empty page with hasMore false when the offset is past the end', () => {
    const result = paginateInMemory(items, 2, 10);

    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({ total: 5, limit: 2, offset: 10, hasMore: false });
  });
});

describe('paginationMetaSchema', () => {
  it('parses valid pagination metadata', () => {
    const result = paginationMetaSchema.parse({
      total: 100,
      limit: 20,
      offset: 0,
      hasMore: true,
    });

    expect(result).toEqual({
      total: 100,
      limit: 20,
      offset: 0,
      hasMore: true,
    });
  });

  it('rejects non-integer total', () => {
    expect(() => paginationMetaSchema.parse({ total: 1.5, limit: 20, offset: 0, hasMore: false })).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() => paginationMetaSchema.parse({ total: 10 })).toThrow();
  });
});
