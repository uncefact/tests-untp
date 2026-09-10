import { resolveStorageService } from '@/lib/services/resolve-storage-service';

/**
 * The four columns a library row uses to name one durable copy. Both callers
 * pass exactly these, so a coordinate a row does not hold reads as `null`
 * here rather than as an absent property that a guard could miss.
 */
export type StoredObjectCoordinates = {
  storageUri: string | null;
  storageServiceInstanceId: string | null;
  storageExternalId: string | null;
  storageBucket: string | null;
};

/**
 * What became of one durable copy. `no_copy` is a set of coordinates that
 * names nothing and `deleted` is the only outcome that removed an object; the
 * other three name the point at which the attempt gave up and left the object
 * behind for an operator.
 */
export type RemoveStoredObjectOutcome =
  | 'no_copy'
  | 'deleted'
  | 'incomplete_storage_coordinates'
  | 'storage_resolution_failed'
  | 'storage_delete_failed';

/**
 * `errorName` accompanies the two outcomes that failed against a real error
 * and is absent otherwise. The error's MESSAGE never travels: a provider
 * message can carry arbitrary content (ADR-055 amendment A1), while the class
 * and the cause's code are what tell an operator a vanished instance from a
 * socket timeout.
 */
export type RemoveStoredObjectResult = { outcome: RemoveStoredObjectOutcome; errorName?: string };

export function storageCoordinatesAreEmpty(storage: StoredObjectCoordinates): boolean {
  return (
    storage.storageUri === null &&
    storage.storageServiceInstanceId === null &&
    storage.storageExternalId === null &&
    storage.storageBucket === null
  );
}

// Names the four fields rather than spreading the value, so a wider type
// reaching a caller's log line one day cannot put anything else into it.
export function storageCoordinatesForLog(storage: StoredObjectCoordinates): StoredObjectCoordinates {
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
function storageCoordinatesAreComplete(storage: StoredObjectCoordinates): storage is StoredObjectCoordinates & {
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

// A refused connection or a DNS failure reaches here as a bare `TypeError`
// from fetch, with the useful code on its cause; naming that code beside the
// class is what lets an operator tell "storage unreachable" from a defect,
// still without any provider text (A1).
export function errorNameOf(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const cause = error.cause;
  const code =
    cause !== null && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
      ? cause.code
      : undefined;
  return code === undefined ? error.name : `${error.name} (${code})`;
}

/**
 * Removes one durable copy from the storage service the coordinates name, and
 * reports what happened rather than throwing. Nothing here logs: the two
 * callers are saying different things to an operator (a record was deleted, a
 * copy was retired) and each writes its own line from the returned outcome.
 *
 * It never throws for a removal failure. Every caller runs it after its own
 * transaction has committed, on a copy nothing references any more, so a
 * failure leaves an object an operator has to reclaim and nothing else. It
 * resolves the instance the coordinates name and never the tenant's current
 * primary, so a reconfigured tenant cannot make this delete from somewhere
 * else.
 */
export async function removeStoredObject(
  tenantId: string,
  storage: StoredObjectCoordinates,
): Promise<RemoveStoredObjectResult> {
  if (storageCoordinatesAreEmpty(storage)) return { outcome: 'no_copy' };
  if (!storageCoordinatesAreComplete(storage)) return { outcome: 'incomplete_storage_coordinates' };

  let service: { delete: (externalId: string, bucket: string) => Promise<unknown> };
  try {
    service = (await resolveStorageService(tenantId, storage.storageServiceInstanceId)).service;
  } catch (error) {
    return { outcome: 'storage_resolution_failed', errorName: errorNameOf(error) };
  }
  try {
    await service.delete(storage.storageExternalId, storage.storageBucket);
  } catch (error) {
    return { outcome: 'storage_delete_failed', errorName: errorNameOf(error) };
  }
  return { outcome: 'deleted' };
}
