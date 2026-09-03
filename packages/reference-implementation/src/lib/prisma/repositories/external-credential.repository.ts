import {
  CheckRunState,
  CredentialDetailsStatus,
  IdempotencyOperation,
  LibraryRecordOrigin,
  type CheckRun,
  type CoreCredentialType,
  type CredentialDetailsError,
  type ExternalContentKind,
} from '../generated';
import { prisma } from '../prisma';
import { linkClaimToRecord } from './idempotency-key.repository';
import { noChecksRun, type CheckResults, type CheckRunFailure } from './check-run.repository';
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
  type ExternalRecordView,
} from '@/lib/library/library-record-view';

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
 * An external credential as its callers see it: the library record (identity
 * and the extracted fields) narrowed to its external child (source, custody,
 * annotations), and its newest check run.
 */
export type ExternalCredentialRecord = ExternalRecordView & { checkRun: CheckRun };

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

/**
 * Creates an external credential: its library record, its `ExternalCredential`
 * child and its generation 1 check run (ADR-053 decisions 1, 2 and 3), linking
 * the idempotency claim and, for a PENDING run, running the run's `enqueue`
 * inside the same transaction.
 *
 * Database errors are not translated here, unlike `createCredential`: no
 * violation on this path is caller-caused (the record id is minted, a first
 * generation cannot collide, and a tenant or claim foreign key failing is a
 * defect), so a sanitised 500 and a log line are the honest answer, which the
 * route owes by mapping these and the repository's own invariant errors
 * rather than echoing them. The duplicate-content 409 the surface will gain
 * is #956's, not this path's.
 */
export async function createExternalCredential(
  input: CreateExternalCredentialInput,
): Promise<ExternalCredentialRecord> {
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
 * An external credential with its newest check run, scoped to the tenant so
 * an id from another tenant, or a native record's id, reads as absent.
 */
export async function getExternalCredentialById(
  id: string,
  tenantId: string,
): Promise<ExternalCredentialRecord | null> {
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
