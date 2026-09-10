import { StructuredError } from '@uncefact/untp-utils';
import { safeError } from '@/lib/api/safe-error';
import type { SanitisedServerErrorLogger } from '@/lib/api/sanitised-server-error';
import type { PaginatedResponse } from '@/lib/api/pagination';
import { CredentialRecordProjectionError } from './credential-record-projection';
import { LibraryRecordShapeError, type LibraryRecordDetailView } from './library-record-view';
import {
  LibraryRecordSelectionError,
  NOT_FOUND_LIBRARY_READ_MESSAGE,
  recordUnreadableMessage,
  type LibraryReadFailure,
} from './library-read-errors';
import type { LibraryRecordHydrationResult } from '@/lib/prisma/repositories/library-record.repository';

/**
 * The log methods this module needs, as a structural type, so the module stays
 * off pino and a test can pass two plain functions. Declared against
 * {@link SanitisedServerErrorLogger} rather than beside it, so that the one
 * extra method is what the reader sees; the workspace has no canonical
 * structural logger type yet, and unifying the four that exist is a wider
 * sweep than this module.
 */
export type LibraryReadLogger = SanitisedServerErrorLogger & {
  info: (context: Record<string, unknown>, message: string) => void;
};

type RowProjector<T> = (view: LibraryRecordDetailView) => T;
type LibraryReadLogCode = LibraryReadFailure['code'] | 'DECRYPTION_KEY_UNAVAILABLE';

/**
 * Every value the degradation event's `reason` field can carry. The operator
 * documentation publishes this list and asks deployments to alert on it, so it
 * is a compatibility surface: a value renamed here is renamed with the same
 * sweep an API code gets (ADR-057 consequences), and
 * `library-read-results.test.ts` holds this list equal to the one the
 * operations page documents.
 *
 * The first four are what {@link diagnose} produces from a row-local error.
 * The last three are the detail route's key causes, classified by the
 * projector and passed through {@link logDetailDegradation}, which also
 * reuses `unclassified` for a reveal failure it does not recognise. The
 * compiler holds `KeyUnavailableReason` inside this union at that call.
 */
export const LIBRARY_READ_DEGRADATION_REASONS = [
  'shape',
  'projection',
  'identity-mismatch',
  'unclassified',
  'malformed-envelope',
  'key-configuration',
  'unwrap-failed',
] as const;

/** One value of the published `reason` vocabulary. */
export type LibraryReadDegradationReason = (typeof LIBRARY_READ_DEGRADATION_REASONS)[number];

/** The projected rows and the ids the read could not return, in caller order. */
export type CollectionReadResult<T> = {
  data: T[];
  failures: LibraryReadFailure[];
};

/**
 * The required sibling ADR-057 decision 1 puts beside `data` on every
 * collection read that degrades per row. Named once here so both routes
 * conform to one shape rather than to two hand-written object literals.
 */
export type LibraryReadFailures = { failures: LibraryReadFailure[] };

/**
 * The batch-get body: the rows it could return, and the ids it could not.
 * It is the projector's own result rather than a second declaration of the
 * same pair, so the two cannot drift apart. The alias stays because the route
 * names what it serialises, not what it computed.
 */
export type LibraryReadCollectionBody<T> = CollectionReadResult<T>;

/** The list body: the same pair inside the shared pagination envelope. */
export type PaginatedLibraryReadBody<T> = PaginatedResponse<T> & LibraryReadFailures;

function viewId(view: LibraryRecordDetailView): string {
  return view.record.id;
}

/**
 * Names a row-local failure for the operator. Classification is by error class
 * and by the trusted `recordId` the class carries, never by message text. The
 * comparison with the parent is EQUALITY rather than membership in the
 * selection: an error naming another selected record is still a disagreement
 * the operator must see (ADR-057 decision 5).
 *
 * The comparison's product is that diagnosis and nothing else. Keeping a
 * foreign id out of the response is structural: both the collection and detail
 * paths build the published failure from the parent id before the error is
 * examined at all, so an id read off an error has no path into a response body
 * whether this check runs or not.
 *
 * `errorRecordId` is reported only when it disagrees with the parent, so the
 * field's presence is itself the signal rather than something an operator has
 * to compare on every line.
 */
function diagnose(error: unknown, parentId: string): { reason: LibraryReadDegradationReason; errorRecordId?: string } {
  if (error instanceof LibraryRecordShapeError || error instanceof CredentialRecordProjectionError) {
    if (error.recordId === parentId) return { reason: error.reason };
    return { reason: 'identity-mismatch', errorRecordId: error.recordId };
  }
  return { reason: 'unclassified' };
}

/**
 * The one error-level event per degraded record (ADR-057 decision 8). It is
 * the operator's only signal, because the caller's outcome is a 200 carrying a
 * failure entry, so the event carries the error's own name and message through
 * `safeError`, plus its `code` when it is a `StructuredError`. `safeError`
 * reduces an exception to name and message precisely so a cause chain cannot
 * bring key material with it, and neither row-local error class can hold a
 * stored value in the first place: each is a record id plus either a fixed
 * phrase or schema-constraint text.
 *
 * `correlationId` is deliberately absent from this object. The pino adapter's
 * mixin injects the whole request context, including the id served in the
 * `x-correlation-id` response header, into every line; setting it again here
 * could only ever overwrite that with `undefined`.
 */
function logDegradation(
  logger: LibraryReadLogger,
  options: {
    tenantId: string;
    route: string;
    id: string;
    error: unknown;
    stage: 'hydration' | 'projection' | 'detail';
    code: LibraryReadLogCode;
    reasonOverride?: LibraryReadDegradationReason;
  },
): void {
  const diagnosed = diagnose(options.error, options.id);
  logger.error(
    {
      recordId: options.id,
      ...(diagnosed.errorRecordId === undefined ? {} : { errorRecordId: diagnosed.errorRecordId }),
      tenantId: options.tenantId,
      route: options.route,
      readStage: options.stage,
      code: options.code,
      ...(options.error instanceof StructuredError ? { errorCode: options.error.code } : {}),
      reason: options.reasonOverride ?? diagnosed.reason,
      error: safeError(options.error),
    },
    'Library record read degraded',
  );
}

/**
 * Emits the degradation event for a row the route classified itself rather
 * than through {@link projectCollectionRead}. The detail route uses it for the
 * one record it reads.
 */
export function logLibraryRecordFailure(
  logger: LibraryReadLogger,
  options: {
    tenantId: string;
    route: string;
    id: string;
    error: unknown;
    stage: 'hydration' | 'projection' | 'detail';
    code?: LibraryReadLogCode;
  },
): void {
  logDegradation(logger, {
    ...options,
    code: options.code ?? 'RECORD_UNREADABLE',
  });
}

function assertSelectionBoundary(result: LibraryRecordHydrationResult, orderedIds: readonly string[]): void {
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new LibraryRecordSelectionError('the requested selection contains a duplicate id');
  }
  const orderedSet = new Set(orderedIds);
  const selectedSet = new Set(result.selectedIds);
  if (selectedSet.size !== result.selectedIds.length || [...selectedSet].some((id) => !orderedSet.has(id))) {
    throw new LibraryRecordSelectionError('the read returned an invalid selection');
  }

  const outcomeIds = [...result.data.map(viewId), ...result.failures.map(({ id }) => id)];
  const outcomeSet = new Set(outcomeIds);
  if (outcomeSet.size !== outcomeIds.length || outcomeIds.some((id) => !selectedSet.has(id))) {
    throw new LibraryRecordSelectionError('the read returned an invalid outcome selection');
  }
  if (outcomeSet.size !== selectedSet.size || [...selectedSet].some((id) => !outcomeSet.has(id))) {
    throw new LibraryRecordSelectionError('the read returned an unattributable cardinality mismatch');
  }
}

function unreadableFailure(id: string): LibraryReadFailure {
  return { id, code: 'RECORD_UNREADABLE', message: recordUnreadableMessage(id) };
}

function notFoundFailure(id: string): LibraryReadFailure {
  return { id, code: 'NOT_FOUND', message: NOT_FOUND_LIBRARY_READ_MESSAGE };
}

/**
 * Projects a repository result once in caller order, isolating every row-local
 * throw so one damaged record cannot cost the caller the rest of the page.
 *
 * `orderedIds` must be distinct. That is a precondition of this helper, not a
 * defence against a caller's input: both routes establish it before calling,
 * the batch by deduplicating the submitted ids and the list by taking the ids
 * its own page selected. The check exists so an exported helper states its own
 * contract, and it is enforced by the same throw as the rest, because a
 * duplicate would otherwise produce two outcomes for one id.
 *
 * Three further things a caller depends on and cannot read off the signature:
 *
 * - An ordered id the read did not select becomes a `NOT_FOUND` failure. That
 *   is the batch accounting rule (ADR-057 decision 2); a list route, whose
 *   ordered ids are the ids its own page selected, never reaches it.
 * - A hydration result that breaches the caller's selection boundary throws
 *   `LibraryRecordSelectionError`. A route must let that reach its sanitised
 *   500 (ADR-057 decision 5) rather than degrade it per row, because the
 *   request produced no selection an outcome could truthfully be attributed
 *   to.
 * - It logs one error-level event through `logger` for every degraded row, so
 *   the caller does not log those again.
 */
export function projectCollectionRead<T>(
  result: LibraryRecordHydrationResult,
  options: {
    orderedIds: readonly string[];
    tenantId: string;
    route: string;
    project: RowProjector<T>;
  },
  logger: LibraryReadLogger,
): CollectionReadResult<T> {
  assertSelectionBoundary(result, options.orderedIds);
  const dataById = new Map(result.data.map((view) => [viewId(view), view]));
  const failureById = new Map(result.failures.map((failure) => [failure.id, failure]));
  const selectedSet = new Set(result.selectedIds);
  const data: T[] = [];
  const failures: LibraryReadFailure[] = [];

  for (const id of options.orderedIds) {
    if (!selectedSet.has(id)) {
      failures.push(notFoundFailure(id));
      continue;
    }

    const hydrationFailure = failureById.get(id);
    if (hydrationFailure !== undefined) {
      const classified = unreadableFailure(id);
      failures.push(classified);
      logDegradation(logger, {
        tenantId: options.tenantId,
        route: options.route,
        id,
        error: hydrationFailure.error,
        stage: 'hydration',
        code: classified.code,
      });
      continue;
    }

    const view = dataById.get(id);
    // Unreachable by construction: assertSelectionBoundary has already proved
    // every selected id has exactly one outcome, and the branch above consumed
    // the other one. Kept as a structural assertion, not a reachable outcome.
    if (view === undefined) {
      throw new LibraryRecordSelectionError(`record ${id} had no readable outcome`);
    }
    try {
      data.push(options.project(view));
    } catch (error) {
      const classified = unreadableFailure(id);
      failures.push(classified);
      logDegradation(logger, {
        tenantId: options.tenantId,
        route: options.route,
        id,
        error,
        stage: 'projection',
        code: classified.code,
      });
    }
  }

  return { data, failures };
}

/** One info-level line per collection request, carrying the counts it produced. */
export function logLibraryReadSummary(
  logger: LibraryReadLogger,
  options: { tenantId: string; route: string; result: CollectionReadResult<unknown> },
): void {
  logger.info(
    {
      tenantId: options.tenantId,
      route: options.route,
      returned: options.result.data.length,
      unreadable: options.result.failures.filter(({ code }) => code === 'RECORD_UNREADABLE').length,
      notFound: options.result.failures.filter(({ code }) => code === 'NOT_FOUND').length,
    },
    'Library record read summary',
  );
}

/**
 * The detail route's degradation event for a record whose held key could not
 * be returned. `reason` separates the three causes the projector classifies,
 * because they need different repairs, and `cause` is the error itself,
 * reduced by `safeError` like every other degradation event.
 */
export function logDetailDegradation(
  logger: LibraryReadLogger,
  options: { tenantId: string; route: string; id: string; reason: LibraryReadDegradationReason; cause: unknown },
): void {
  logDegradation(logger, {
    tenantId: options.tenantId,
    route: options.route,
    id: options.id,
    error: options.cause,
    stage: 'detail',
    code: 'DECRYPTION_KEY_UNAVAILABLE',
    reasonOverride: options.reason,
  });
}
