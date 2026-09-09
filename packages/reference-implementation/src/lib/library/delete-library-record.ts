import { apiLogger } from '@/lib/api/logger';
import { LibraryRecordOrigin } from '@/lib/prisma/generated';
import {
  deleteLibraryRecord,
  type DeleteLibraryRecordStorage,
} from '@/lib/prisma/repositories/library-record.repository';
import { resolveStorageService } from '@/lib/services/resolve-storage-service';

const logger = apiLogger.child({ module: 'delete-library-record' });

/**
 * What became of the durable copy once the row was committed as deleted.
 * `no_copy` is a record that never held one and `deleted` is the only outcome
 * that removed a stored object; the other three name the point at which the
 * best-effort cleanup gave up and left an orphan warning behind.
 */
export type DeleteLibraryRecordCleanup =
  | 'no_copy'
  | 'deleted'
  | 'incomplete_storage_coordinates'
  | 'storage_resolution_failed'
  | 'storage_delete_failed';

export type DeleteLibraryRecordAndCopyResult =
  | { outcome: 'missing' }
  | { outcome: 'native' }
  | { outcome: 'deleted'; storage: DeleteLibraryRecordStorage; cleanup: DeleteLibraryRecordCleanup };

function storageCoordinatesAreEmpty(storage: DeleteLibraryRecordStorage): boolean {
  return (
    storage.storageUri === null &&
    storage.storageServiceInstanceId === null &&
    storage.storageExternalId === null &&
    storage.storageBucket === null
  );
}

// Names the four fields rather than spreading the value, so a wider type
// reaching this function one day cannot put anything else into a log line.
function storageCoordinatesForLog(storage: DeleteLibraryRecordStorage): DeleteLibraryRecordStorage {
  return {
    storageUri: storage.storageUri,
    storageServiceInstanceId: storage.storageServiceInstanceId,
    storageExternalId: storage.storageExternalId,
    storageBucket: storage.storageBucket,
  };
}

// Non-empty, not merely non-null: `resolveStorageService` treats a falsy
// instance id as "use the tenant's current primary", and the adapter returns
// without a request when the bucket is empty, so an empty string here would
// either delete from the wrong instance or silently do nothing. The current
// UNCEFACT adapter generates the object id itself and takes the bucket from
// validated configuration, so an empty string is not a value it produces;
// the guard defends the persisted row (neither column carries a non-empty
// constraint) and any other adapter that fills these columns.
function storageCoordinatesAreComplete(storage: DeleteLibraryRecordStorage): storage is DeleteLibraryRecordStorage & {
  storageServiceInstanceId: string;
  storageExternalId: string;
  storageBucket: string;
} {
  return (
    typeof storage.storageServiceInstanceId === 'string' &&
    storage.storageServiceInstanceId.length > 0 &&
    typeof storage.storageExternalId === 'string' &&
    storage.storageExternalId.length > 0 &&
    typeof storage.storageBucket === 'string' &&
    storage.storageBucket.length > 0
  );
}

async function deleteDurableCopy(
  recordId: string,
  tenantId: string,
  storage: DeleteLibraryRecordStorage,
): Promise<DeleteLibraryRecordCleanup> {
  if (storageCoordinatesAreEmpty(storage)) {
    logger.info({ recordId, tenantId }, 'Library record has no durable copy to delete');
    return 'no_copy';
  }

  if (!storageCoordinatesAreComplete(storage)) {
    logger.warn(
      {
        recordId,
        tenantId,
        ...storageCoordinatesForLog(storage),
        stage: 'incomplete_storage_coordinates',
      },
      'Library record deleted; storage object may be orphaned',
    );
    return 'incomplete_storage_coordinates';
  }

  // The error class is logged, never its message: a provider message can carry
  // arbitrary content (amendment A1), but the class is what tells an operator
  // a vanished instance from a socket timeout.
  let service: { delete: (externalId: string, bucket: string) => Promise<unknown> };
  try {
    service = (await resolveStorageService(tenantId, storage.storageServiceInstanceId)).service;
  } catch (error) {
    logger.warn(
      {
        recordId,
        tenantId,
        ...storageCoordinatesForLog(storage),
        stage: 'storage_resolution_failed',
        errorName: errorNameOf(error),
      },
      'Library record deleted; storage object may be orphaned',
    );
    return 'storage_resolution_failed';
  }
  try {
    await service.delete(storage.storageExternalId, storage.storageBucket);
  } catch (error) {
    logger.warn(
      {
        recordId,
        tenantId,
        ...storageCoordinatesForLog(storage),
        stage: 'storage_delete_failed',
        errorName: errorNameOf(error),
      },
      'Library record deleted; storage object may be orphaned',
    );
    return 'storage_delete_failed';
  }
  return 'deleted';
}

// A refused connection or a DNS failure reaches here as a bare `TypeError`
// from fetch, with the useful code on its cause; naming that code beside the
// class is what lets an operator tell "storage unreachable" from a defect,
// still without any provider text (A1).
function errorNameOf(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const cause = error.cause;
  const code =
    cause !== null && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
      ? cause.code
      : undefined;
  return code === undefined ? error.name : `${error.name} (${code})`;
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
