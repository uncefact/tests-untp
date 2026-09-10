import type { LibraryRecordHydrationResult } from '@/lib/prisma/repositories/library-record.repository';

/**
 * The shape `batchGetLibraryRecords` and `listLibraryRecords` actually
 * resolve, for the route suites that stand in for them. A bare array of views,
 * or a `{ data, total }` pair, would leave each route's selection accounting
 * and its hydration-failure branch untested while the suite stayed green,
 * because a repository double is untyped at the mock boundary.
 *
 * `selectedIds` is derived from the outcomes rather than taken as an argument,
 * so every result this builder produces is a VALID selection and neither route
 * suite can reach `assertSelectionBoundary` through it. That is deliberate:
 * the boundary is driven directly in `src/lib/library/library-read-results.ts`'s
 * own suite, against the real helper. Do not add an escape hatch here for a
 * route suite to fake an invalid selection with.
 */
export function libraryHydrationResult(
  data: unknown[],
  failures: LibraryRecordHydrationResult['failures'] = [],
): LibraryRecordHydrationResult {
  const readable = data as LibraryRecordHydrationResult['data'];
  return {
    data: readable,
    failures,
    selectedIds: [...readable.map(({ record }) => record.id), ...failures.map(({ id }) => id)],
  };
}

/** The same result with the anchored total a list read also carries. */
export function libraryListResult(
  data: unknown[],
  total: number,
  failures: LibraryRecordHydrationResult['failures'] = [],
): LibraryRecordHydrationResult & { total: number } {
  return { ...libraryHydrationResult(data, failures), total };
}
