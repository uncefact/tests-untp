import { renderHook, act, waitFor } from '@testing-library/react';

import type { PaginatedResponse, PaginationMeta } from '@/lib/api/pagination';

import { usePaginatedFetch } from './use-paginated-fetch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockResponse<T>(data: T[], overrides?: Partial<PaginationMeta>): PaginatedResponse<T> {
  return {
    data,
    pagination: {
      total: data.length,
      limit: 20,
      offset: 0,
      hasMore: false,
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePaginatedFetch', () => {
  // -----------------------------------------------------------------------
  // 1. Fetches on mount with defaults
  // -----------------------------------------------------------------------
  it('fetches on mount with default limit and offset', async () => {
    const items = [{ id: 1 }, { id: 2 }];
    const fetchFn = jest.fn().mockResolvedValue(createMockResponse(items));

    const { result } = renderHook(() => usePaginatedFetch(fetchFn));

    // fetchFn should be called with defaults
    expect(fetchFn).toHaveBeenCalledWith({ limit: 20, offset: 0 });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(items);
    expect(result.current.pagination).toEqual(
      expect.objectContaining({ total: 2, limit: 20, offset: 0, hasMore: false }),
    );
    expect(result.current.error).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 2. Custom limit
  // -----------------------------------------------------------------------
  it('uses a custom limit when provided', async () => {
    const fetchFn = jest.fn().mockResolvedValue(createMockResponse([]));

    renderHook(() => usePaginatedFetch(fetchFn, { limit: 50 }));

    expect(fetchFn).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });

  // -----------------------------------------------------------------------
  // 3. fetchOnMount: false
  // -----------------------------------------------------------------------
  it('does not fetch on mount when fetchOnMount is false', async () => {
    const fetchFn = jest.fn().mockResolvedValue(createMockResponse([]));

    const { result } = renderHook(() => usePaginatedFetch(fetchFn, { fetchOnMount: false }));

    // Should not have been called
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);

    // Now call refresh — it should trigger a fetch
    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Loading state
  // -----------------------------------------------------------------------
  it('sets isLoading to true during fetch and false after', async () => {
    let resolveFetch!: (value: PaginatedResponse<{ id: number }>) => void;
    const fetchFn = jest.fn().mockReturnValue(
      new Promise<PaginatedResponse<{ id: number }>>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = renderHook(() => usePaginatedFetch(fetchFn));

    // isLoading should become true once the effect fires
    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });

    // Resolve the promise
    await act(async () => {
      resolveFetch(createMockResponse([{ id: 1 }]));
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([{ id: 1 }]);
  });

  // -----------------------------------------------------------------------
  // 5. Error handling
  // -----------------------------------------------------------------------
  it('sets error when fetchFn rejects with an Error', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => usePaginatedFetch(fetchFn));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network failure');
    expect(result.current.data).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 6. refresh()
  // -----------------------------------------------------------------------
  it('re-fetches with the same limit and offset when refresh is called', async () => {
    const fetchFn = jest.fn().mockResolvedValue(createMockResponse([{ id: 1 }]));

    const { result } = renderHook(() => usePaginatedFetch(fetchFn));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    // Both calls should use the same params
    expect(fetchFn).toHaveBeenNthCalledWith(1, { limit: 20, offset: 0 });
    expect(fetchFn).toHaveBeenNthCalledWith(2, { limit: 20, offset: 0 });
  });

  // -----------------------------------------------------------------------
  // 7. goToPage()
  // -----------------------------------------------------------------------
  it('fetches with the given offset when goToPage is called', async () => {
    const fetchFn = jest.fn().mockResolvedValue(createMockResponse([{ id: 1 }], { total: 40, hasMore: true }));

    const { result } = renderHook(() => usePaginatedFetch(fetchFn));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      result.current.goToPage(20);
    });

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith({ limit: 20, offset: 20 });
    });
  });

  // -----------------------------------------------------------------------
  // 8. setPageSize()
  // -----------------------------------------------------------------------
  it('fetches with new limit and resets offset when setPageSize is called', async () => {
    const fetchFn = jest.fn().mockResolvedValue(createMockResponse([]));

    const { result } = renderHook(() => usePaginatedFetch(fetchFn));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // First move to a non-zero offset
    await act(async () => {
      result.current.goToPage(40);
    });

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith({ limit: 20, offset: 40 });
    });

    // Now change page size — offset should reset to 0
    await act(async () => {
      result.current.setPageSize(50);
    });

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    });
  });

  // -----------------------------------------------------------------------
  // 9. Non-Error thrown
  // -----------------------------------------------------------------------
  it('wraps a non-Error thrown value in an Error', async () => {
    const fetchFn = jest.fn().mockRejectedValue('something went wrong');

    const { result } = renderHook(() => usePaginatedFetch(fetchFn));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('something went wrong');
    expect(result.current.data).toEqual([]);
  });
});
