import {
  CheckRunState,
  CredentialDetailsStatus,
  IdempotencyOperation,
  LibraryRecordOrigin,
  type CoreCredentialType,
  type CredentialDetailsError,
  type ExternalContentKind,
  type Prisma,
} from '../generated';
import { prisma } from '../prisma';
import { linkClaimToRecord } from './idempotency-key.repository';
import { noChecksRun, type CheckResults, type CheckRunFailure } from './check-run.repository';
import { isUniqueConstraintViolation } from '@/lib/prisma/db-errors';
import { apiLogger } from '@/lib/api/logger';
import { safeError } from '@/lib/api/safe-error';
import type { CredentialDetails } from '@/lib/credentials/extract-credential-details';
import type { ProtectedDecryptionKey } from '@/lib/credentials/decryption-key-protection';
// From the module, not the jobs barrel: the barrel loads pg-boss, whose
// ESM-only build the unit test runtime cannot parse, and every unit test that
// touches the repositories barrel would load it through this file.
import { prismaSqlExecutor } from '@/lib/jobs/prisma-sql-executor';
import type { SqlExecutor } from '@/lib/jobs/types';
import {
  LibraryRecordShapeError,
  narrowExternalRecord,
  type ExternalLibraryRecordView,
} from '@/lib/library/library-record-view';

const logger = apiLogger.child({ module: 'external-credential.repository' });

/**
 * The durable copy a registration stored, all or nothing. `decryptionKey` is
 * the storage service's key already protected at rest (ADR-055 decision 2);
 * absent for an unopened ciphertext copy, which has no key of ours to hold.
 */
export type ExternalStorageInput = {
  uri: string;
  digestMultibase: string;
  serviceInstanceId: string;
  externalId: string;
  bucket?: string;
  decryptionKey?: ProtectedDecryptionKey;
};

export type ReplaceCustodyInput = {
  recordId: string;
  tenantId: string;
  storage: ExternalStorageInput;
};

/**
 * What reading the artefact produced, on the same terms as the native row's
 * capture (#952): extracted with values, failed with a reason, or pending
 * because the artefact was never reached (a failed fetch, an unopened
 * ciphertext), which a later re-verify that reaches it resolves. The type
 * pair (ADR-053 decision 8) travels with an extracted outcome only. Each
 * branch closes the others' fields so a capture assembled through a variable
 * cannot carry, say, an error into an extracted row.
 */
export type ExternalDetailsCapture =
  | {
      status: typeof CredentialDetailsStatus.EXTRACTED;
      fields: CredentialDetails;
      /** The type the artefact asserts, an extension's own name when it is one. */
      credentialType: string | null;
      /**
       * The one core kind the type set names. An artefact naming none, or
       * two, does not extract: it fails with a bridge error instead
       * (decision 8), so an extracted capture always carries one.
       */
      coreCredentialType: CoreCredentialType;
      coreDataModelVersion: string | null;
      error?: undefined;
    }
  | {
      status: typeof CredentialDetailsStatus.EXTRACTION_FAILED;
      error: CredentialDetailsError;
      fields?: undefined;
      credentialType?: undefined;
      coreCredentialType?: undefined;
      coreDataModelVersion?: undefined;
    }
  | {
      status: typeof CredentialDetailsStatus.EXTRACTION_PENDING;
      error?: undefined;
      fields?: undefined;
      credentialType?: undefined;
      coreCredentialType?: undefined;
      coreDataModelVersion?: undefined;
    };

/**
 * What the verify job needs to find its run: references only, never content
 * or a key, because a job row is long-lived plain text outside the
 * protections the record's own store gives it (ADR-054 decision 5).
 */
export type VerifyJobReference = {
  tenantId: string;
  recordId: string;
  generation: number;
  checkRunId: string;
};

/**
 * Generation 1 as the register call settles it in-request: PENDING when the
 * asynchronous verifier call is still owed, FAILED when an in-request step
 * already decided the outcome.
 */
export type InitialCheckRunInput =
  | {
      state: typeof CheckRunState.PENDING;
      checks: Partial<CheckResults>;
      /**
       * Enqueues the verify job the pending run waits on, inside the same
       * transaction as the rows, through the queue's transactional send
       * (`sql` is the executor that send takes), so the record and its job
       * commit together or not at all (ADR-054 decision 4). Required on a
       * PENDING run so no pending record is created without a caller that
       * owns its job; the row's `lastEnqueuedAt` records that this ran. Do
       * nothing else here: the transaction is open for its duration, within
       * the explicit budget the create sets. The caller's precondition, not enforced
       * here: the verify queue is created at boot, so the send inside the
       * transaction is one insert rather than queue creation on first use.
       */
      enqueue: (sql: SqlExecutor, job: VerifyJobReference) => Promise<void>;
      failure?: undefined;
    }
  | {
      state: typeof CheckRunState.FAILED;
      checks: Partial<CheckResults>;
      failure: CheckRunFailure;
      enqueue?: undefined;
    };

export type CreateExternalCredentialInput = {
  tenantId: string;
  sourceUrl: string;
  sourceDigest?: string;
  contentDigest?: string | null;
  duplicateOfRecordId?: string | null;
  /**
   * Null (or omitted) until a body was observed; never false after a failed
   * fetch. The register route, which walks the fetch outcomes, is what keeps
   * this and the other observation-dependent fields honest; the repository
   * persists what it is given.
   */
  encrypted?: boolean | null;
  contentKind?: ExternalContentKind;
  storage?: ExternalStorageInput;
  annotations: {
    displayName: string;
    declaredCredentialType: CoreCredentialType;
    /** A calendar date; the column keeps the date and drops any time of day. */
    dateReceived?: Date;
    notes?: string;
  };
  /**
   * A key was supplied and the source turned out to be plaintext, so it was
   * never applied. Recorded on the record and never cleared, so it reads as
   * "at least one registration or re-verification supplied a key that was
   * not needed".
   */
  decryptionKeyUnused?: boolean;
  details: ExternalDetailsCapture;
  checkRun: InitialCheckRunInput;
  /**
   * When set, the record, its first check run and this claim are written in
   * one transaction (ADR-051 decision 3), so a crash cannot leave a
   * registered record whose claim is still reclaimable and would register it
   * again (decision 6).
   */
  idempotencyClaimId?: string;
};

/**
 * An external credential as this repository's callers see it: the library
 * record (identity and the extracted fields) narrowed to its external child
 * (source, custody, annotations), and its newest check run. One declaration
 * under two names, so the detail view and this repository's return type
 * cannot drift apart.
 */
export type { ExternalLibraryRecordView as ExternalCredentialRecord };

/** Created by `prisma/migrations/20260906000000_external_credential_content_identity/migration.sql`. */
export const CONTENT_DIGEST_UNIQUE_INDEX = 'ExternalCredential_tenantId_contentDigest_key';

/**
 * Thrown when the opened credential's content already belongs to an external
 * record in the tenant. `existingRecordId` names that record. The sentence a
 * caller reads is composed by the route, so this class carries the id alone
 * and nothing here can drift from the published wording.
 */
export class DuplicateCredentialError extends Error {
  readonly existingRecordId: string;

  constructor(existingRecordId: string) {
    super(`Duplicate external credential content, already held by record ${existingRecordId}`);
    this.name = 'DuplicateCredentialError';
    this.existingRecordId = existingRecordId;
  }
}

/**
 * Thrown when a digest promotion is asked to release a digest the named
 * record does not hold, so the caller's premise about the row is wrong and
 * its transaction must not continue.
 */
export class ContentDigestNotHeldError extends Error {
  constructor(recordId: string, tenantId: string) {
    super(`Record ${recordId} in tenant ${tenantId} does not hold the content digest being relinquished`);
    this.name = 'ContentDigestNotHeldError';
  }
}

/**
 * Thrown when the advisory row chosen for promotion changed under the
 * promotion, so the digest would be released with nobody holding it. The
 * caller's transaction rolls back and the digest stays with its owner.
 */
export class ContentDigestPromotionRacedError extends Error {
  constructor(advisoryRecordId: string) {
    super(`Advisory record ${advisoryRecordId} changed before it could take the released content digest`);
    this.name = 'ContentDigestPromotionRacedError';
  }
}

function detailsColumns(capture: ExternalDetailsCapture) {
  switch (capture.status) {
    case CredentialDetailsStatus.EXTRACTED:
      return {
        ...capture.fields,
        credentialType: capture.credentialType,
        coreCredentialType: capture.coreCredentialType,
        coreDataModelVersion: capture.coreDataModelVersion,
        detailsStatus: capture.status,
      };
    case CredentialDetailsStatus.EXTRACTION_FAILED:
      return { detailsStatus: capture.status, detailsError: capture.error };
    case CredentialDetailsStatus.EXTRACTION_PENDING:
      return { detailsStatus: capture.status };
  }
}

/** One attempt at the create transaction; see {@link createExternalCredential} for the contract. */
async function createExternalCredentialOnce(input: CreateExternalCredentialInput): Promise<ExternalLibraryRecordView> {
  // One instant for every timestamp the rows carry, so the record can never
  // read as updated, or enqueued, before it was created.
  const now = new Date(Date.now());
  // An explicit budget rather than Prisma's 5 s default: the transaction
  // holds the enqueue, which is a round trip to the same database, and a
  // budget that expires here rolls the rows back after the durable copy was
  // already stored (the caller logs the orphan's coordinates). Generous
  // enough that only a genuinely stuck database trips it.
  return prisma.$transaction(
    async (tx) => {
      const record = await tx.libraryRecord.create({
        data: {
          tenantId: input.tenantId,
          origin: LibraryRecordOrigin.EXTERNAL,
          createdAt: now,
          updatedAt: now,
          ...detailsColumns(input.details),
        },
      });
      const external = await tx.externalCredential.create({
        data: {
          id: record.id,
          tenantId: input.tenantId,
          createdAt: now,
          updatedAt: now,
          sourceUrl: input.sourceUrl,
          sourceDigest: input.sourceDigest ?? null,
          contentDigest: input.contentDigest ?? null,
          duplicateOfRecordId: input.duplicateOfRecordId ?? null,
          encrypted: input.encrypted ?? null,
          contentKind: input.contentKind ?? null,
          storageUri: input.storage?.uri ?? null,
          storageDigestMultibase: input.storage?.digestMultibase ?? null,
          storageServiceInstanceId: input.storage?.serviceInstanceId ?? null,
          storageExternalId: input.storage?.externalId ?? null,
          storageBucket: input.storage?.bucket ?? null,
          decryptionKey: input.storage?.decryptionKey ?? null,
          displayName: input.annotations.displayName,
          declaredCredentialType: input.annotations.declaredCredentialType,
          dateReceived: input.annotations.dateReceived ?? null,
          notes: input.annotations.notes ?? null,
          decryptionKeyUnused: input.decryptionKeyUnused ?? false,
        },
      });
      const checkRun = await tx.checkRun.create({
        data: {
          recordId: record.id,
          tenantId: input.tenantId,
          generation: 1,
          state: input.checkRun.state,
          ...noChecksRun(),
          ...input.checkRun.checks,
          ...(input.checkRun.state === CheckRunState.FAILED
            ? {
                failureCode: input.checkRun.failure.code,
                failureMessage: input.checkRun.failure.message,
                failureRetryable: input.checkRun.failure.retryable,
                completedAt: now,
              }
            : { lastEnqueuedAt: now }),
          requestedAt: now,
        },
      });
      if (input.idempotencyClaimId) {
        await linkClaimToRecord(tx, input.idempotencyClaimId, record.id, IdempotencyOperation.LIBRARY_REGISTER);
      }
      if (input.checkRun.state === CheckRunState.PENDING) {
        await input.checkRun.enqueue(prismaSqlExecutor(tx), {
          tenantId: input.tenantId,
          recordId: record.id,
          generation: checkRun.generation,
          checkRunId: checkRun.id,
        });
      }
      return { origin: LibraryRecordOrigin.EXTERNAL, record, external, checkRun };
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}

/**
 * Whether a unique violation came from the content-identity index. Prisma
 * reports the target as the constraint name for an index created in raw SQL
 * and as the field list for one it generated, so both shapes are accepted.
 * The error code alone would also catch the idempotency and record indexes,
 * whose collisions mean something else entirely.
 */
function isContentDigestUniqueViolation(error: unknown): boolean {
  if (!isUniqueConstraintViolation(error)) return false;
  const meta = (error as { meta?: { target?: unknown } }).meta;
  const target = meta?.target;
  if (target === CONTENT_DIGEST_UNIQUE_INDEX) return true;
  return Array.isArray(target) && target.length === 2 && target[0] === 'tenantId' && target[1] === 'contentDigest';
}

/** Reads the record now holding a digest, keeping the collision that prompted the read on any failure. */
async function findWinnerAfterCollision(tenantId: string, contentDigest: string, collision: unknown) {
  try {
    return await findExternalByContentDigest(tenantId, contentDigest);
  } catch (error) {
    // The database is what has just rejected the insert, so a failure here
    // is likely the same fault. The collision travels with it rather than
    // being replaced by it.
    if (error instanceof Error && error.cause === undefined) error.cause = collision;
    throw error;
  }
}

/**
 * Creates an external credential: its library record, its `ExternalCredential`
 * child and its generation 1 check run (ADR-053 decisions 1, 2 and 3), linking
 * the idempotency claim and, for a PENDING run, running the run's `enqueue`
 * inside the same transaction.
 *
 * Most database errors are not translated here, unlike `createCredential`. A
 * minted record id cannot collide, a first generation cannot collide, and a
 * tenant or claim foreign key failing is a defect, so a sanitised 500 and a
 * log line are the honest answer, which the route owes by mapping these and
 * the repository's own invariant errors rather than echoing them.
 *
 * The one caller-caused violation is the content-identity index, which two
 * concurrent registrations of the same credential can hit. It is read back
 * under the tenant and thrown as `DuplicateCredentialError` naming the
 * winner. When the winner has disappeared before it could be read, the
 * create is attempted once more, and a second collision is read back the
 * same way. Only a collision whose winner cannot be found either time
 * escapes as the raw database error.
 */
export async function createExternalCredential(
  input: CreateExternalCredentialInput,
): Promise<ExternalLibraryRecordView> {
  const contentDigest = input.contentDigest ?? undefined;
  let firstCollision: unknown;
  try {
    return await createExternalCredentialOnce(input);
  } catch (error) {
    if (!isContentDigestUniqueViolation(error) || contentDigest === undefined) throw error;
    firstCollision = error;
  }

  const firstWinner = await findWinnerAfterCollision(input.tenantId, contentDigest, firstCollision);
  if (firstWinner !== null) throw new DuplicateCredentialError(firstWinner);

  logger.info(
    { tenantId: input.tenantId },
    'Content identity collided and no record holds it after rollback; retrying the registration once',
  );
  try {
    return await createExternalCredentialOnce(input);
  } catch (error) {
    if (!isContentDigestUniqueViolation(error)) {
      // The retry failed for another reason, and the collision that caused
      // the retry is the context that failure would otherwise lose.
      if (error instanceof Error && error.cause === undefined) error.cause = firstCollision;
      throw error;
    }
    const secondWinner = await findWinnerAfterCollision(input.tenantId, contentDigest, error);
    if (secondWinner !== null) throw new DuplicateCredentialError(secondWinner);
    // Two collisions and no holder either time means records under this
    // content are being created and removed as fast as this request runs.
    // The caller gets the sanitised 500; this is the line an operator needs.
    logger.error(
      { error: safeError(error), tenantId: input.tenantId },
      'Content identity collided twice and no record holds it after rollback',
    );
    throw error;
  }
}

/**
 * Finds the external record in one tenant holding this content identity.
 * Native records are never considered, and an optional current id supports
 * recovery without treating a record's own content as a duplicate (#957).
 *
 * The partial unique index means at most one row can hold the digest, so the
 * ordering is a tie-break for the window in which a promotion is in flight
 * rather than a choice between rows that are expected to coexist.
 */
export async function findExternalByContentDigest(
  tenantId: string,
  contentDigest: string,
  currentRecordId?: string,
): Promise<string | null> {
  const row = await prisma.externalCredential.findFirst({
    where: {
      tenantId,
      contentDigest,
      ...(currentRecordId === undefined ? {} : { id: { not: currentRecordId } }),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return row?.id ?? null;
}

/** The record relinquishing a content identity, and the identity it is giving up. */
export type PromoteExternalCredentialDigestInput = {
  tenantId: string;
  recordId: string;
  contentDigest: string;
};

/**
 * Where the relinquished identity ended up. `promoted` names the row that
 * took it and counts the other advisory rows moved to point at that row;
 * `none` means no advisory row was waiting for it.
 */
export type DigestPromotion = { outcome: 'promoted'; recordId: string; repointed: number } | { outcome: 'none' };

/**
 * Gives a relinquished digest to the oldest advisory row that points at its
 * former owner, and moves every other advisory row of that owner to point at
 * the promoted row. Callers run this in the same transaction as the delete or
 * digest change, before the foreign key can clear the pointer (#956, D2).
 *
 * The repoint is what keeps the identity whole. Without it a second advisory
 * row still points at the former owner, so deleting that owner nulls the
 * pointer and leaves the row with no identity at all, and giving that owner a
 * different digest later would hand the second row a digest for content it
 * does not hold.
 *
 * Throws rather than reporting a partial result. A record that does not hold
 * the digest means the caller's premise is wrong, and an advisory row that
 * changed between the read and the write would leave the identity released
 * with nobody holding it. Both roll the caller's transaction back, so the
 * digest stays where it is and the next registration still collides with it.
 *
 * Locking is shared with the callers. A writer attaching a new advisory row
 * to a record must revalidate, under its own lock, that the target still
 * holds the digest it observed, because a promotion may have moved that
 * digest to another row in between.
 */
export async function promoteExternalCredentialDigest(
  client: Prisma.TransactionClient,
  input: PromoteExternalCredentialDigestInput,
): Promise<DigestPromotion> {
  // Release the canonical row first. The partial unique index otherwise
  // rejects the advisory promotion while both rows briefly carry the
  // digest. The caller deletes or changes this row in the same transaction.
  const released = await client.externalCredential.updateMany({
    where: {
      id: input.recordId,
      tenantId: input.tenantId,
      contentDigest: input.contentDigest,
    },
    data: { contentDigest: null },
  });
  if (released.count !== 1) throw new ContentDigestNotHeldError(input.recordId, input.tenantId);

  const advisory = await client.externalCredential.findFirst({
    where: {
      tenantId: input.tenantId,
      duplicateOfRecordId: input.recordId,
      contentDigest: null,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (advisory === null) return { outcome: 'none' };

  const updated = await client.externalCredential.updateMany({
    where: {
      id: advisory.id,
      tenantId: input.tenantId,
      duplicateOfRecordId: input.recordId,
      contentDigest: null,
    },
    data: { contentDigest: input.contentDigest, duplicateOfRecordId: null },
  });
  if (updated.count !== 1) throw new ContentDigestPromotionRacedError(advisory.id);

  // Every other advisory row of the former owner now points at the row
  // holding the identity, so it survives the owner's deletion and cannot be
  // handed a later, unrelated digest of that owner's.
  const repointed = await client.externalCredential.updateMany({
    where: {
      tenantId: input.tenantId,
      duplicateOfRecordId: input.recordId,
      contentDigest: null,
    },
    data: { duplicateOfRecordId: advisory.id },
  });
  return { outcome: 'promoted', recordId: advisory.id, repointed: repointed.count };
}

/**
 * An external credential with its newest check run, scoped to the tenant so
 * an id from another tenant, or a native record's id, reads as absent.
 */
export async function getExternalCredentialById(
  id: string,
  tenantId: string,
): Promise<ExternalLibraryRecordView | null> {
  const row = await prisma.libraryRecord.findFirst({
    where: { id, tenantId, origin: LibraryRecordOrigin.EXTERNAL },
    include: { externalCredential: true, checkRuns: { orderBy: { generation: 'desc' }, take: 1 } },
  });
  if (!row) return null;
  const { checkRuns, ...withChild } = row;
  const view = narrowExternalRecord(withChild);
  const checkRun = checkRuns[0];
  // Registration writes generation 1 in the same transaction as the record,
  // and nothing deletes a run on its own, so a record with none is a broken
  // invariant rather than an empty state.
  if (!checkRun) {
    throw new LibraryRecordShapeError(id, 'is EXTERNAL but has no check run');
  }
  return { ...view, checkRun };
}

/**
 * Replaces an external record's complete custody tuple in one transaction, so
 * a concurrent reader sees the whole old copy or the whole new one and never a
 * half-written mixture. The parent timestamp moves with the tuple, while
 * annotations and the descriptive fields remain untouched.
 *
 * There is no clearing form. A copy proven lost leaves the record's custody
 * exactly as it is, and the newest generation's failure is the record's
 * statement that the copy is gone (ADR-055).
 *
 * Called by the re-fetch recovery branch, which lands with the shared
 * recover-mode helper of
 * [uncefact/tests-untp#956](https://github.com/uncefact/tests-untp/issues/956).
 */
export async function replaceCustody(
  tx: Prisma.TransactionClient,
  input: ReplaceCustodyInput,
): Promise<ExternalLibraryRecordView['external']> {
  const now = new Date(Date.now());
  const storage = input.storage;
  const external = await tx.externalCredential.update({
    where: {
      id_tenantId_origin: {
        id: input.recordId,
        tenantId: input.tenantId,
        origin: LibraryRecordOrigin.EXTERNAL,
      },
    },
    data: {
      storageUri: storage.uri,
      storageDigestMultibase: storage.digestMultibase,
      storageServiceInstanceId: storage.serviceInstanceId,
      storageExternalId: storage.externalId,
      storageBucket: storage.bucket ?? null,
      decryptionKey: storage.decryptionKey ?? null,
    },
  });
  await tx.libraryRecord.update({
    where: { id_tenantId: { id: input.recordId, tenantId: input.tenantId } },
    data: { updatedAt: now },
  });
  return external;
}
