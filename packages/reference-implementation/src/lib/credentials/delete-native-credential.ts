import { apiLogger } from '@/lib/api/logger';
import { LibraryRecordOrigin } from '@/lib/prisma/generated';
import { deleteNativeCredential } from '@/lib/prisma/repositories/credential.repository';
import {
  removeStoredObject,
  storageCoordinatesAreEmpty,
  storageCoordinatesForLog,
  type RemoveStoredObjectOutcome,
  type StoredObjectCoordinates,
} from '@/lib/library/remove-stored-object';

const logger = apiLogger.child({ module: 'delete-native-credential' });

export type DeleteNativeCredentialAndCopyResult =
  | { outcome: 'missing' }
  | { outcome: 'external' }
  | { outcome: 'deleted'; storage: StoredObjectCoordinates; cleanup: RemoveStoredObjectOutcome };

/**
 * Owns the native credential's delete use case: the transactional row delete
 * and, once that has committed, the best-effort removal of the durable copy
 * the row named. It mirrors the library's external delete
 * (`delete-library-record.ts`) and shares its removal helper, so an operator
 * reads the same outcomes and coordinates on both.
 *
 * Cleanup runs only on the committed coordinates the writer returned, never
 * on a re-read, and never throws for a cleanup failure: the row is already
 * gone and the delete is not repeatable, so an orphaned object is an
 * operator concern recorded in the warning. A credential issued before the
 * coordinates were recorded has none to clean and is reported as
 * `incomplete_storage_coordinates` with its URI. Anything the repository
 * throws propagates untouched, so the route keeps its own error mapping.
 *
 * Deleting a credential does not revoke it. Revocation on delete is planned
 * for a later release; until then a deleted credential that was shared stays
 * verifiable at its status list.
 */
export async function deleteNativeCredentialAndCopy({
  recordId,
  tenantId,
}: {
  recordId: string;
  tenantId: string;
}): Promise<DeleteNativeCredentialAndCopyResult> {
  const result = await deleteNativeCredential({ recordId, tenantId });
  if (result.outcome !== 'deleted') return result;

  logger.info(
    {
      recordId,
      tenantId,
      origin: LibraryRecordOrigin.NATIVE.toLowerCase(),
      ...storageCoordinatesForLog(result.storage),
    },
    'Credential deleted from database',
  );

  if (storageCoordinatesAreEmpty(result.storage)) {
    logger.info({ recordId, tenantId }, 'Credential has no durable copy to delete');
    return { outcome: 'deleted', storage: result.storage, cleanup: 'no_copy' };
  }

  const { outcome, errorName } = await removeStoredObject(tenantId, result.storage);
  if (outcome !== 'deleted') {
    // The error class is logged, never its message: a provider message can
    // carry arbitrary content, while the class tells an operator a vanished
    // instance from a socket timeout.
    logger.warn(
      {
        recordId,
        tenantId,
        ...storageCoordinatesForLog(result.storage),
        stage: outcome,
        ...(errorName === undefined ? {} : { errorName }),
      },
      'Credential deleted; storage object may be orphaned',
    );
  }
  return { outcome: 'deleted', storage: result.storage, cleanup: outcome };
}
