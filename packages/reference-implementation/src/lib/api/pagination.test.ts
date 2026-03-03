import { buildPaginatedResponse } from './pagination';

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

  it('defaults limit to 20 and offset to 0 when not provided', () => {
    const items = [{ id: 1 }];

    const result = buildPaginatedResponse(items, 50);

    expect(result.pagination.limit).toBe(20);
    expect(result.pagination.offset).toBe(0);
    expect(result.pagination.hasMore).toBe(true);
  });

  it('returns empty data with hasMore false when there are zero results', () => {
    const result = buildPaginatedResponse([], 0);

    expect(result).toEqual({
      data: [],
      pagination: {
        total: 0,
        limit: 20,
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
