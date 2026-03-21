'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { PaginatedResponse, PaginationMeta } from '@/lib/api/pagination';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FetchFn<T> = (params: { limit: number; offset: number }) => Promise<PaginatedResponse<T>>;

interface UsePaginatedFetchOptions {
  /** Number of items per page. Defaults to `DEFAULT_PAGE_LIMIT`. */
  limit?: number;
  /** Whether to fetch immediately on mount. Defaults to `true`. */
  fetchOnMount?: boolean;
}

interface PaginatedFetchState<T> {
  data: T[];
  pagination: PaginationMeta | null;
  isLoading: boolean;
  error: Error | null;
  limit: number;
  offset: number;
  fetchVersion: number;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type PaginatedFetchAction<T> =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; data: T[]; pagination: PaginationMeta }
  | { type: 'FETCH_ERROR'; error: Error }
  | { type: 'SET_PAGE'; offset: number }
  | { type: 'SET_PAGE_SIZE'; limit: number }
  | { type: 'REFRESH' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer<T>(state: PaginatedFetchState<T>, action: PaginatedFetchAction<T>): PaginatedFetchState<T> {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, isLoading: true, error: null };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        data: action.data,
        pagination: action.pagination,
        isLoading: false,
      };

    case 'FETCH_ERROR':
      return { ...state, error: action.error, isLoading: false };

    case 'SET_PAGE':
      return { ...state, offset: action.offset };

    case 'SET_PAGE_SIZE':
      return { ...state, limit: action.limit, offset: 0 };

    case 'REFRESH':
      return { ...state, fetchVersion: state.fetchVersion + 1 };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePaginatedFetch<T>(fetchFn: FetchFn<T>, options: UsePaginatedFetchOptions = {}) {
  const { limit = DEFAULT_PAGE_LIMIT, fetchOnMount = true } = options;

  const [state, dispatch] = useReducer(reducer<T>, {
    data: [],
    pagination: null,
    isLoading: false,
    error: null,
    limit,
    offset: 0,
    fetchVersion: fetchOnMount ? 0 : -1,
  });

  // Keep fetchFn in a ref so callers don't need to memoise it.
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  useEffect(() => {
    if (state.fetchVersion < 0) {
      return;
    }

    let cancelled = false;

    const performFetch = async () => {
      dispatch({ type: 'FETCH_START' });

      try {
        const result = await fetchFnRef.current({
          limit: state.limit,
          offset: state.offset,
        });

        if (!cancelled) {
          dispatch({
            type: 'FETCH_SUCCESS',
            data: result.data,
            pagination: result.pagination,
          });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: 'FETCH_ERROR',
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    };

    performFetch();

    return () => {
      cancelled = true;
    };
  }, [state.limit, state.offset, state.fetchVersion]);

  const refresh = useCallback(() => dispatch({ type: 'REFRESH' }), []);

  const goToPage = useCallback((offset: number) => dispatch({ type: 'SET_PAGE', offset }), []);

  const setPageSize = useCallback((newLimit: number) => dispatch({ type: 'SET_PAGE_SIZE', limit: newLimit }), []);

  return {
    data: state.data,
    pagination: state.pagination,
    isLoading: state.isLoading,
    error: state.error,
    refresh,
    goToPage,
    setPageSize,
  };
}
