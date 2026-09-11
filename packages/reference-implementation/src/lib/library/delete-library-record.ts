import { appLogger } from '@/lib/api/logger';
import { LibraryRecordOrigin } from '@/lib/prisma/generated';
import {
  deleteLibraryRecord,
  type DeleteLibraryRecordStorage,
} from '@/lib/prisma/repositories/library-record.repository';
import {
  removeStoredObject,
  storageCoordinatesAreEmpty,
  storageCoordinatesForLog,
  type RemoveStoredObjectOutcome,
} from '@/lib/library/remove-stored-object';

const logger = appLogger.child({ module: 'delete-library-record' });

/**
 * What became of the durable copy once the row was committed as deleted.
 * `no_copy` is a record that never held one and `deleted` is the only outcome
 * that removed a stored object; the other three name the point at which the
 * best-effort cleanup gave up and left an orphan warning behind.
 */
export type DeleteLibraryRecordCleanup = RemoveStoredObjectOutcome;

export type DeleteLibraryRecordAndCopyResult =
  | { outcome: 'missing' }
  | { outcome: 'native' }
  | { outcome: 'deleted'; storage: DeleteLibraryRecordStorage; cleanup: DeleteLibraryRecordCleanup };

/**
 * The removal itself lives in `remove-stored-object.ts`, shared with the
 * recovery that retires a copy. The outcomes it returns are named for an
 * operator reading this line, so each is reported here with the coordinates
 * and the stage rather than translated.
 */
async function deleteDurableCopy(
  recordId: string,
  tenantId: string,
  storage: DeleteLibraryRecordStorage,
): Promise<DeleteLibraryRecordCleanup> {
  if (storageCoordinatesAreEmpty(storage)) {
    logger.info({ recordId, tenantId }, 'Library record has no durable copy to delete');
    return 'no_copy';
  }

  const { outcome, errorName } = await removeStoredObject(tenantId, storage);
  if (outcome === 'deleted') return outcome;

  // The error class is logged, never its message: a provider message can carry
  // arbitrary content (amendment A1), but the class is what tells an operator
  // a vanished instance from a socket timeout.
  logger.warn(
    {
      recordId,
      tenantId,
      ...storageCoordinatesForLog(storage),
      stage: outcome,
      ...(errorName === undefined ? {} : { errorName }),
    },
    'Library record deleted; storage object may be orphaned',
  );
  return outcome;
}

/**
 * Owns the library's delete use case: the transactional row delete and, once
 * that has committed, the best-effort removal of the durable copy the row
 * pointed at.
 *
 * Cleanup runs only on the committed custody tuple the writer returned, and
 * never on a re-read, so a concurrent write cannot redirect it at another
 * record's object. It never throws for a cleanup failure: an orphaned stored
 * object is an operator concern recorded in the warning, not a caller concern,
 * because the row is already gone and the delete is not repeatable. Anything
 * the repository throws propagates untouched, so the caller keeps its own
 * database-error and sanitised-failure mapping.
 *
 * The caller maps the returned outcome onto its own response, and repeats none
 * of these decisions.
 */
export async function deleteLibraryRecordAndCopy({
  recordId,
  tenantId,
}: {
  recordId: string;
  tenantId: string;
}): Promise<DeleteLibraryRecordAndCopyResult> {
  const result = await deleteLibraryRecord({ recordId, tenantId });
  if (result.outcome !== 'deleted') return result;

  logger.info(
    {
      recordId,
      tenantId,
      origin: LibraryRecordOrigin.EXTERNAL.toLowerCase(),
      ...storageCoordinatesForLog(result.storage),
    },
    'Library record deleted from database',
  );
  const cleanup = await deleteDurableCopy(recordId, tenantId, result.storage);
  return { outcome: 'deleted', storage: result.storage, cleanup };
}
