# ADR: Reusable paginated fetch hook with useReducer

- **Date:** 2026-05-12
- **Status:** accepted

## Context

The reference implementation needs to display paginated lists of resources (DIDs, credentials, etc.) across multiple pages. Each paginated view requires the same state management: loading indicators, error handling, page navigation, and page size changes. Without a shared abstraction, this logic would be duplicated in every context or component that consumes a paginated API endpoint.

The API layer already returns a consistent `PaginatedResponse<T>` shape with `data` and `pagination` (containing `total`, `limit`, `offset`, `hasMore`). A client-side hook can leverage this consistent shape to provide a generic solution.

## Decision

We introduced a `usePaginatedFetch<T>` hook in `src/hooks/use-paginated-fetch.ts` that:

1. **Uses `useReducer`** to manage interrelated state (`data`, `pagination`, `isLoading`, `error`, `limit`, `offset`, `fetchVersion`) as a single state machine. This was chosen over multiple `useState` calls because the state values are interdependent — changing the page size must also reset the offset, and fetching must atomically update loading, data, and error.

2. **Accepts a generic `fetchFn`** parameter `(params: { limit, offset }) => Promise<PaginatedResponse<T>>`, making it reusable for any paginated API endpoint without coupling to a specific service.

3. **Stores `fetchFn` in a ref** to avoid requiring callers to memoise the function and to prevent stale closures.

4. **Uses a `fetchVersion` counter** for the refresh mechanism — incrementing it re-triggers the `useEffect` without changing pagination params.

5. **Supports `fetchOnMount: false`** via a negative initial `fetchVersion` (-1), which the effect skips. Calling `refresh()` increments it to 0, enabling fetching.

This hook is consumed by context providers (e.g. `DidProvider`) which add domain-specific derived state (filtered lists, default item) on top of the generic pagination.

## Consequences

**What becomes easier:**
- Adding new paginated resource views requires only calling the hook with the appropriate service function
- Pagination state transitions are explicit and predictable via the reducer
- The hook is testable in isolation with `renderHook`

**What becomes harder:**
- The hook assumes all paginated endpoints follow the `PaginatedResponse<T>` shape — endpoints with different response formats would need a separate approach
- Server-side filtering (e.g. filtering by DID type) is not built into the hook — consumers must handle this at the `fetchFn` level

## Alternatives Considered

### Multiple `useState` calls
Rejected because the state values are interdependent. Setting page size must also reset offset, and a fetch completion must atomically update data, pagination, and loading. With separate `useState` calls, these updates would cause multiple re-renders and risk inconsistent intermediate states.

### Hardcoded high limit (e.g. `limit: 1000`)
Rejected because it doesn't scale and prevents consumers from implementing proper pagination UI. A proper pagination hook supports the related cards that need paginated list views.

### TanStack React Query
A related card exists to install React Query. Once available, the hook internals can be refactored to use `useQuery` while keeping the same external API. The current `useReducer` approach is a pragmatic interim solution that doesn't block the React Query migration.

## References

- `packages/reference-implementation/src/hooks/use-paginated-fetch.ts` — implementation
- `packages/reference-implementation/src/lib/api/pagination.ts` — `PaginatedResponse<T>` and `PaginationMeta` types
