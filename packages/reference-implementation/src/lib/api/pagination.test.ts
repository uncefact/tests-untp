import {
  buildPaginatedResponse,
  paginateInMemory,
  paginationMetaSchema,
  DEFAULT_PAGE_LIMIT,
  resolveMaxPageLimit,
  warnOnRejectedMaxPageLimitOverride,
} from './pagination';

describe('resolveMaxPageLimit', () => {
  it('returns the default for an absent variable, without rejecting an override', () => {
    expect(resolveMaxPageLimit(undefined)).toEqual({ value: 100, overrideRejected: false });
  });

  it('applies a valid positive-integer override', () => {
    expect(resolveMaxPageLimit('250')).toEqual({ value: 250, overrideRejected: false });
    expect(resolveMaxPageLimit(' 50 ')).toEqual({ value: 50, overrideRejected: false });
    expect(resolveMaxPageLimit('1')).toEqual({ value: 1, overrideRejected: false });
  });

  it('rejects a supplied but unusable override and falls back to the default', () => {
    for (const raw of ['', '   ', '0', '-5', '+5', 'abc', '10.5', '1e3', '0x10', '9'.repeat(400)]) {
      expect(resolveMaxPageLimit(raw)).toEqual({ value: 100, overrideRejected: true });
    }
  });
});

describe('MAX_PAGE_LIMIT / DEFAULT_PAGE_LIMIT resolution at module load', () => {
  const original = process.env.API_MAX_PAGE_LIMIT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.API_MAX_PAGE_LIMIT;
    } else {
      process.env.API_MAX_PAGE_LIMIT = original;
    }
    jest.resetModules();
  });

  it('reads a valid operator override from the environment', async () => {
    process.env.API_MAX_PAGE_LIMIT = '250';
    await jest.isolateModulesAsync(async () => {
      const pagination = await import('./pagination');
      expect(pagination.MAX_PAGE_LIMIT).toBe(250);
      expect(pagination.DEFAULT_PAGE_LIMIT).toBe(20);
    });
  });

  it('bounds the default page size by a configured maximum below the base default', async () => {
    process.env.API_MAX_PAGE_LIMIT = '5';
    await jest.isolateModulesAsync(async () => {
      const pagination = await import('./pagination');
      expect(pagination.MAX_PAGE_LIMIT).toBe(5);
      expect(pagination.DEFAULT_PAGE_LIMIT).toBe(5);
    });
  });

  it('applies the override at the pagination schema boundary', async () => {
    process.env.API_MAX_PAGE_LIMIT = '7';
    await jest.isolateModulesAsync(async () => {
      const { paginationQuerySchema } = await import('./request-schemas/shared');
      expect(paginationQuerySchema.safeParse({ limit: '7' }).success).toBe(true);
      const over = paginationQuerySchema.safeParse({ limit: '8' });
      expect(over.success).toBe(false);
      if (!over.success) {
        expect(over.error.issues[0].message).toBe('must not exceed the maximum of 7');
      }
    });
  });
});

describe('warnOnRejectedMaxPageLimitOverride', () => {
  const original = process.env.API_MAX_PAGE_LIMIT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.API_MAX_PAGE_LIMIT;
    } else {
      process.env.API_MAX_PAGE_LIMIT = original;
    }
  });

  it('warns with the raw value and the applied default when the override is unusable', () => {
    process.env.API_MAX_PAGE_LIMIT = 'not-a-number';
    const warn = jest.fn();

    warnOnRejectedMaxPageLimitOverride({ warn });

    expect(warn).toHaveBeenCalledWith(
      { API_MAX_PAGE_LIMIT: 'not-a-number', appliedMaximum: 100 },
      expect.stringContaining('API_MAX_PAGE_LIMIT'),
    );
  });

  it('stays silent when the override is valid or absent', () => {
    const warn = jest.fn();

    process.env.API_MAX_PAGE_LIMIT = '250';
    warnOnRejectedMaxPageLimitOverride({ warn });

    delete process.env.API_MAX_PAGE_LIMIT;
    warnOnRejectedMaxPageLimitOverride({ warn });

    expect(warn).not.toHaveBeenCalled();
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
