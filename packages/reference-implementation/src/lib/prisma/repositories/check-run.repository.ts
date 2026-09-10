import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CredentialDetailsStatus,
  ExternalContentKind,
  LibraryRecordOrigin,
  Prisma,
  type CheckRun,
} from '../generated';
import { prisma } from '../prisma';
import { isTransactionDeadlock, isUniqueConstraintViolation } from '@/lib/prisma/db-errors';
import { lockLibraryRecordForUpdate, lockLibraryRecordsForUpdate } from './library-record.repository';
import { prismaSqlExecutor } from '@/lib/jobs/prisma-sql-executor';
import type { SqlExecutor } from '@/lib/jobs/types';
import type { VerifyJobReference } from './external-credential.repository';
import {
  EXTRACTED_DETAILS_NULL_COLUMNS,
  extractedDetailsColumns,
  findExternalByContentDigest,
  isContentDigestUniqueViolation,
  promoteExternalCredentialDigest,
  replaceCustody,
  type ExternalDetailsCapture,
  type ExternalStorageInput,
} from './external-credential.repository';
import { apiLogger } from '@/lib/api/logger';
import { safeError } from '@/lib/api/safe-error';
import {
  ABANDONED_CUSTODY_UNKNOWN_MESSAGE,
  ABANDONED_RUN_MESSAGE,
  ABANDONED_UNOPENED_COPY_MESSAGE,
  cannotAcceptSupplierKey,
  holdsUnopenedCopy,
} from '@/lib/library/reverify-messages';
import { CHECK_NAMES, type LibraryCheckName } from '@/lib/library/check-rules';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
export { CHECK_NAMES } from '@/lib/library/check-rules';
import type { CredentialOutcome, RecoverInRequestOutcome } from '@/lib/library/register-external-credential';

const logger = apiLogger.child({ module: 'check-run.repository' });

// CHECK_NAMES is owned by check-rules.ts so the projection and list SQL share it.
export type CheckName = LibraryCheckName;

export type CheckResults = Record<CheckName, CheckResult>;

/**
 * The three checks an acquisition can earn before the shared pipeline runs:
 * reaching the bytes, proving them intact against the digest recorded for
 * them, and opening them. Named once over the same vocabulary every other
 * check projection uses, so a caller carrying a partial result cannot invent
 * a fourth name or a value outside {@link CheckResult}.
 *
 * A `Partial`, not a full {@link CheckResults}: an acquisition reports only
 * the checks it actually ran, and the settlement it feeds merges them over
 * {@link noChecksRun}.
 */
export type AcquisitionChecks = Partial<Pick<CheckResults, 'retrieval' | 'digest' | 'decryption'>>;

export function noChecksRun(): CheckResults {
  return Object.fromEntries(CHECK_NAMES.map((name) => [name, CheckResult.NOT_RUN])) as CheckResults;
}

/**
 * A stored run's check results, lifted off the row. Every settlement states
 * all seven, so this is the base a caller merges its own results into, and
 * the value a settlement that produced none writes back unchanged.
 */
export function checksOf(run: Pick<CheckRun, CheckName>): CheckResults {
  return Object.fromEntries(CHECK_NAMES.map((name) => [name, run[name]])) as CheckResults;
}

export type CheckRunFailure = {
  code: CheckRunFailureCode;
  /** In the caller's terms: what happened and what to do next, never an internal component. */
  message: string;
  /**
   * False when the exact same request, unmodified, will not succeed unless
   * the source itself changes (a deterministic refusal: a malformed source,
   * a blocked host, a 404); true when a later attempt, unchanged or after a
   * correction, may plausibly succeed. This is the register operation's
   * definition in the discovery contract's `openapi-draft.yaml`, and it is
   * a classification of what was observed, never a promise about the source.
   */
  retryable: boolean;
};

/**
 * A run is addressed by its id under its record's tenant, the same key every
 * read here uses, so a run id from a request can never settle another
 * tenant's run.
 */
export type CheckRunRef = { id: string; tenantId: string };

export type SettleCheckRunCompleteInput = CheckRunRef & { checks: CheckResults };

/**
 * Every check is stated on failure too, so an omitted check can never keep a
 * stale value beside a new failure code. Which check a code names, and that
 * it is not left PASS, is the caller's rule: the caller has the run in hand
 * (it read it under the tenant to get here) and passes the merged set.
 */
export type SettleCheckRunFailedInput = CheckRunRef & { checks: CheckResults; failure: CheckRunFailure };

/**
 * `applied`: this call settled the run. `superseded`: the run was no longer
 * PENDING (a duplicate delivery of the same job, or a job that outlived a
 * newer settlement) and nothing changed. `missing`: no run with this id
 * exists under this tenant (deleted with its record, or a wrong reference)
 * and nothing changed. The caller decides which of the last two to log.
 */
export type CheckRunSettleOutcome = { outcome: 'applied' } | { outcome: 'superseded' } | { outcome: 'missing' };

/**
 * The coordinates {@link sameCustody} compares, and the roster the comparison
 * iterates. A coordinate added to {@link ReverificationCustodySnapshot} and
 * not added here fails to compile against the assertion below, so the
 * comparison can never silently stop covering a field the type carries.
 */
const CUSTODY_FIELDS = [
  'storageUri',
  'storageDigestMultibase',
  'storageExternalId',
  'decryptionKeyPresent',
  'encrypted',
] as const;

/**
 * The custody coordinates a re-verification compares before it appends a
 * generation. {@link CUSTODY_FIELDS} is the roster {@link sameCustody}
 * iterates, and the assertion below binds the two, so a coordinate added here
 * is compared without any further edit or does not compile.
 *
 * The key ENVELOPE is deliberately absent, so a rewrap during preparation
 * does not read as a replaced copy; its PRESENCE is a coordinate, because a
 * copy acquiring a receiver key between the reservation and finalisation is
 * exactly the custody move this fence exists to catch. Every field is
 * required: a snapshot that never learned key presence must not compare equal
 * to one that positively observed none.
 */
export type ReverificationCustodySnapshot = {
  storageUri: string | null;
  storageDigestMultibase: string | null;
  storageExternalId: string | null;
  decryptionKeyPresent: boolean;
  encrypted: boolean | null;
};

// The roster and the type name exactly the same coordinates. A field added to
// one and not the other makes this line the compile error.
type UncomparedCustodyField = Exclude<keyof ReverificationCustodySnapshot, (typeof CUSTODY_FIELDS)[number]>;
type UnknownCustodyField = Exclude<(typeof CUSTODY_FIELDS)[number], keyof ReverificationCustodySnapshot>;
const _custodyRosterMatchesSnapshot: [UncomparedCustodyField, UnknownCustodyField] extends [never, never]
  ? true
  : never = true;
void _custodyRosterMatchesSnapshot;

/**
 * The result of the in-request comparison against the supplier source, and
 * when it was made. The two travel together because the wire contract
 * publishes the pair from the timestamp alone, so a result with no timestamp
 * would be recorded and then hidden for ever. `sourceChanged` is null when
 * the comparison was attempted and the source could not be read.
 */
export type SourceFreshness = { sourceChanged: boolean | null; checkedAt: Date };

type CreateReverificationGenerationBase = {
  recordId: string;
  tenantId: string;
  expectedGeneration: number;
  expectedCustody: ReverificationCustodySnapshot;
  enqueue: (sql: SqlExecutor, job: VerifyJobReference) => Promise<void>;
};

/**
 * Freshness is a fact about a supplier source, so only the external arm
 * carries it: a native record has no source to compare and its projection
 * would drop the values anyway.
 *
 * The recovery branch does not use this function at all, in either
 * acquisition mode: it reserves and finalises its own generation through
 * {@link reserveRecoveryGeneration} and {@link finaliseRecoveryGeneration}, so
 * this input carries no `prepared` arm any more. This function still serves
 * the native branch and the protected-copy freshness-only branch.
 */
export type CreateReverificationGenerationInput = CreateReverificationGenerationBase &
  (
    | { expectedOrigin: typeof LibraryRecordOrigin.NATIVE }
    | { expectedOrigin: typeof LibraryRecordOrigin.EXTERNAL; freshness?: SourceFreshness }
  );

export type CreateReverificationGenerationResult =
  | { outcome: 'created'; generation: number; checkRunId: string }
  | { outcome: 'joined' }
  | { outcome: 'superseded'; generation: number | null }
  | { outcome: 'missing' };

type ReverificationRow = {
  id: string;
  tenantId: string;
  origin: LibraryRecordOrigin;
  credential: { storageUri: string; digestMultibase: string } | null;
  externalCredential: {
    storageUri: string | null;
    storageDigestMultibase: string | null;
    storageServiceInstanceId: string | null;
    storageExternalId: string | null;
    storageBucket: string | null;
    sourceDigest: string | null;
    contentDigest: string | null;
    duplicateOfRecordId: string | null;
    encrypted: boolean | null;
  } | null;
  checkRuns: Array<{ id: string; generation: number; state: CheckRunState; lastEnqueuedAt: Date | null }>;
};

/**
 * Neither child's `decryptionKey` is selected. Custody compares key
 * PRESENCE, and that boolean is read separately as `IS NOT NULL`
 * ({@link readKeyPresence}), so the key envelope never enters a row object
 * the reservation and finalisation transactions hold, and cannot reach a log
 * through one (ADR-055 decision 1).
 *
 * The claim is about those transactions, not about the whole module: reads
 * elsewhere in the codebase (the record's detail view, which the projection
 * and the route both use) do carry the envelope by design. What this include
 * guarantees is that the locked decisions here are made without it.
 */
const REVERIFICATION_ROW_INCLUDE = {
  credential: { select: { storageUri: true, digestMultibase: true } },
  externalCredential: {
    select: {
      storageUri: true,
      storageDigestMultibase: true,
      storageServiceInstanceId: true,
      storageExternalId: true,
      storageBucket: true,
      sourceDigest: true,
      contentDigest: true,
      duplicateOfRecordId: true,
      encrypted: true,
    },
  },
  checkRuns: {
    orderBy: { generation: 'desc' } as const,
    take: 1,
    select: { id: true, generation: true, state: true, lastEnqueuedAt: true },
  },
} satisfies Prisma.LibraryRecordInclude;

/** Whether each custody child holds a key, without either envelope. */
type KeyPresence = { credential: boolean; external: boolean };

const NO_KEY_PRESENT: KeyPresence = { credential: false, external: false };

/**
 * The key-presence half of the custody tuple, projected in SQL rather than
 * selected and reduced in JavaScript. Read on the same client as the row it
 * accompanies, so inside a transaction it sees the same locked state.
 */
async function readKeyPresence(
  client: Pick<Prisma.TransactionClient, '$queryRawUnsafe'>,
  recordId: string,
  tenantId: string,
): Promise<KeyPresence> {
  const rows = await client.$queryRawUnsafe<Array<{ credential: boolean; external: boolean }>>(
    `SELECT COALESCE(c."decryptionKey" IS NOT NULL, false) AS "credential",
            COALESCE(e."decryptionKey" IS NOT NULL, false) AS "external"
       FROM "LibraryRecord" r
       LEFT JOIN "Credential" c ON c."id" = r."id" AND c."tenantId" = r."tenantId"
       LEFT JOIN "ExternalCredential" e ON e."id" = r."id" AND e."tenantId" = r."tenantId"
      WHERE r."id" = $1 AND r."tenantId" = $2`,
    recordId,
    tenantId,
  );
  return rows[0] ?? NO_KEY_PRESENT;
}

/**
 * Locks and rechecks the parent before adding a generation. The transaction
 * deliberately uses Read Committed because each query must see the row after
 * the parent lock is acquired, including a custody change made during
 * preparation. The key envelope is not part of the comparison, so a rewrap
 * does not create a competing generation.
 *
 * Serves the native branch and the protected-copy freshness-only branch of
 * `reverifyLibraryRecord`. The recovery branch is a separate
 * reserve-then-finalise pair: it needs the acquisition to happen
 * outside any transaction, which this single-transaction function cannot do.
 */
export async function createReverificationGeneration(
  input: CreateReverificationGenerationInput,
): Promise<CreateReverificationGenerationResult> {
  try {
    return await createReverificationGenerationOnce(input);
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    // Lost the pending-index or generation-key race; another request won.
    // The failed transaction is rolled back before this read, so it sees the
    // winner rather than the state this attempt started from.
    logger.warn(
      { err: error, recordId: input.recordId, tenantId: input.tenantId },
      'Re-verification insert lost a unique race; reading the winner',
    );
    const result = await resolveCheckRunRaceOutcome(input.recordId, input.tenantId);
    if (result.outcome === 'reserved' || result.outcome === 'conflict' || result.outcome === 'not-applicable') {
      return { outcome: 'superseded', generation: null };
    }
    return result;
  }
}

async function createReverificationGenerationOnce(
  input: CreateReverificationGenerationInput,
): Promise<CreateReverificationGenerationResult> {
  return prisma.$transaction(
    async (tx): Promise<CreateReverificationGenerationResult> => {
      if (!(await lockLibraryRecordForUpdate(tx, input.recordId, input.tenantId))) return { outcome: 'missing' };

      const row = (await tx.libraryRecord.findFirst({
        where: { id: input.recordId, tenantId: input.tenantId },
        include: REVERIFICATION_ROW_INCLUDE,
      })) satisfies ReverificationRow | null;
      if (row === null) return { outcome: 'missing' };

      const newest = row.checkRuns[0] ?? null;
      const currentGeneration = newest?.generation ?? (row.origin === LibraryRecordOrigin.NATIVE ? 1 : 0);
      const currentCustody = custodyOf(row, await readKeyPresence(tx, input.recordId, input.tenantId));
      if (newest?.state === CheckRunState.PENDING) return { outcome: 'joined' };
      if (
        row.origin !== input.expectedOrigin ||
        currentGeneration !== input.expectedGeneration ||
        !sameCustody(currentCustody, input.expectedCustody)
      ) {
        logger.warn(
          {
            recordId: input.recordId,
            tenantId: input.tenantId,
            expectedOrigin: input.expectedOrigin,
            observedOrigin: row.origin,
            expectedGeneration: input.expectedGeneration,
            observedGeneration: currentGeneration,
            expectedCustody: input.expectedCustody,
            observedCustody: currentCustody,
          },
          'Re-verification was superseded while it was being prepared; no generation was added',
        );
        return { outcome: 'superseded', generation: currentGeneration };
      }

      const generation = currentGeneration + 1;
      const freshness = input.expectedOrigin === LibraryRecordOrigin.EXTERNAL ? input.freshness : undefined;
      const now = new Date(Date.now());

      const checkRun = await tx.checkRun.create({
        data: {
          recordId: input.recordId,
          tenantId: input.tenantId,
          generation,
          state: CheckRunState.PENDING,
          ...noChecksRun(),
          sourceChanged: freshness?.sourceChanged ?? null,
          lastSourceCheckAt: freshness?.checkedAt ?? null,
          requestedAt: now,
          lastEnqueuedAt: now,
        },
        select: { id: true, generation: true },
      });
      await input.enqueue(prismaSqlExecutor(tx), {
        tenantId: input.tenantId,
        recordId: input.recordId,
        generation: checkRun.generation,
        checkRunId: checkRun.id,
      });
      return { outcome: 'created', generation: checkRun.generation, checkRunId: checkRun.id };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    },
  );
}

// ---------------------------------------------------------------------------
// Recovery: reserve, fetch (outside any transaction, by the caller), finalise
// ---------------------------------------------------------------------------

/**
 * Runs a parent-locking transaction (recovery's reserve and finalise, and the
 * library delete) once, and once more if Postgres itself reports a deadlock
 * or write conflict. The shared ascending lock order the multi-parent
 * transactions use is what keeps a genuine deadlock rare; this is the bounded fallback for
 * the case two transactions still deadlock despite that ordering, since
 * Postgres (not this code) decides which side to abort. Any other error, and
 * a second deadlock in a row, propagates. `context.op` names the caller in
 * the log line's fields.
 */
export async function withDeadlockRetry<T>(
  attempt: () => Promise<T>,
  context: { recordId: string; tenantId: string; op: string },
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!isTransactionDeadlock(error)) throw error;
    logger.warn(
      { recordId: context.recordId, tenantId: context.tenantId, op: context.op },
      'Transaction deadlocked; retrying once',
    );
    return attempt();
  }
}

export type ReserveRecoveryGenerationInput = {
  recordId: string;
  tenantId: string;
  expectedGeneration: number;
  /** The custody observed before the lock. Key-bearing eligible records may be rebased from the locked state. */
  expectedCustody: ReverificationCustodySnapshot;
  keyBearing?: boolean;
};

/** The identity facts read under the reservation's own row lock, at the exact moment generation N+1 was claimed. */
export type ReservedIdentitySnapshot = { contentDigest: string | null; duplicateOfRecordId: string | null };

export type ReserveRecoveryGenerationResult =
  | {
      outcome: 'reserved';
      generation: number;
      checkRunId: string;
      identity: ReservedIdentitySnapshot;
      /**
       * The custody this reservation observed under its own parent lock. The
       * caller selects its acquisition mode from this and hands it back as
       * the finalisation fence, so it is never optional: falling back to the
       * pre-lock read is precisely the read this snapshot exists to replace.
       */
      custody: ReverificationCustodySnapshot;
    }
  | { outcome: 'joined' }
  /**
   * A key-bearing request that cannot be carried out as sent. `reason`
   * separates the two states behind that, because the caller's next move
   * differs: `pending` means a generation is running right now and cannot
   * consume this key, so wait for it; `race-lost` means this request lost the
   * generation-index race twice and the winner had already settled by the
   * time it was read, so nothing is running and the key, never consumed, can
   * go again at once.
   *
   * `generation` is the run that caused the refusal, for the operator log
   * line the route writes; it is not published to the caller.
   */
  | { outcome: 'conflict'; reason: RecoveryConflictReason; generation: number }
  | { outcome: 'not-applicable' }
  | { outcome: 'superseded'; generation: number | null }
  | { outcome: 'missing' };

/** Why a key-bearing recovery could not be carried out as sent. See {@link ReserveRecoveryGenerationResult}. */
export type RecoveryConflictReason = 'pending' | 'race-lost';

/**
 * Step 1 of recovery: claims generation N+1 as `PENDING`
 * with `lastEnqueuedAt` null, no checks, no job and no custody change, then
 * commits. A concurrent caller that reads the reservation joins it instead of
 * starting its own fetch (criterion 5). The reservation is itself the claim;
 * no second table is introduced.
 *
 * Only the reserving caller proceeds to fetch and, on success, calls
 * {@link finaliseRecoveryGeneration} against the exact run this returns. A
 * caller whose fetch never runs (a crash, a queue that will not start) leaves
 * a `PENDING` run with no job; the reconciliation sweep settles it as
 * `VERIFICATION_UNAVAILABLE` once its `requestedAt`/`lastEnqueuedAt` crosses
 * the abandonment cutoff (`findAbandonedPendingCheckRuns`), exactly as an
 * enqueued generation whose worker never answered.
 */
export async function reserveRecoveryGeneration(
  input: ReserveRecoveryGenerationInput,
): Promise<ReserveRecoveryGenerationResult> {
  return reserveRecoveryGenerationAttempt(input, false);
}

/**
 * `raceRetried` is this function's own one-shot budget for re-entering the
 * locked decision after a unique-index loss, not something a caller
 * chooses: passing it in would let a caller disable the re-entry or unbound
 * the recursion, so it stays a private parameter.
 */
async function reserveRecoveryGenerationAttempt(
  input: ReserveRecoveryGenerationInput,
  raceRetried: boolean,
): Promise<ReserveRecoveryGenerationResult> {
  try {
    return await withDeadlockRetry(
      () =>
        prisma.$transaction(
          async (tx): Promise<ReserveRecoveryGenerationResult> => {
            if (!(await lockLibraryRecordForUpdate(tx, input.recordId, input.tenantId))) {
              return { outcome: 'missing' };
            }

            const row = (await tx.libraryRecord.findFirst({
              where: { id: input.recordId, tenantId: input.tenantId },
              include: REVERIFICATION_ROW_INCLUDE,
            })) satisfies ReverificationRow | null;
            if (row === null || row.origin !== LibraryRecordOrigin.EXTERNAL) return { outcome: 'missing' };

            const newest = row.checkRuns[0] ?? null;
            const currentGeneration = newest?.generation ?? 0;
            const currentCustody = custodyOf(row, await readKeyPresence(tx, input.recordId, input.tenantId));
            // The published precedence puts rule 4 (a key against a durable
            // copy that is already receiver-protected, 400) ahead of rule 5 (a
            // key against a pending generation, 409), and this is the one
            // place both can be true at once: custody became protected between
            // the caller's entry read and this lock while a generation was
            // also pending. Ordered the same way here, so the answer a caller
            // gets does not depend on which of two concurrent writers happened
            // to land first. A key that can never be applied to this record is
            // a permanent refusal; a pending generation is a temporary one,
            // and telling a caller to wait for something that will not help
            // them afterwards is the worse of the two answers.
            if (input.keyBearing === true && cannotAcceptSupplierKey(currentCustody)) {
              return { outcome: 'not-applicable' };
            }
            if (newest?.state === CheckRunState.PENDING) {
              return input.keyBearing === true
                ? { outcome: 'conflict', reason: 'pending', generation: newest.generation }
                : { outcome: 'joined' };
            }
            if (
              currentCustody.storageUri !== null &&
              !currentCustody.decryptionKeyPresent &&
              currentCustody.encrypted !== true
            ) {
              throw new LibraryRecordShapeError(
                input.recordId,
                'holds a stored copy that is neither encrypted nor keyed',
              );
            }
            if (
              input.keyBearing !== true &&
              (currentGeneration !== input.expectedGeneration || !sameCustody(currentCustody, input.expectedCustody))
            ) {
              return { outcome: 'superseded', generation: currentGeneration };
            }

            const now = new Date(Date.now());
            const checkRun = await tx.checkRun.create({
              data: {
                recordId: input.recordId,
                tenantId: input.tenantId,
                generation: currentGeneration + 1,
                state: CheckRunState.PENDING,
                ...noChecksRun(),
                requestedAt: now,
              },
              select: { id: true, generation: true },
            });
            // Read under the same row lock the reservation itself just took,
            // not from whatever snapshot the caller entered with: the caller's
            // entry read and this lock can straddle a concurrent identity
            // change, and it is this lock's own view that the fetch this
            // reservation authorises must treat as authoritative.
            return {
              outcome: 'reserved',
              generation: checkRun.generation,
              checkRunId: checkRun.id,
              identity: {
                contentDigest: row.externalCredential?.contentDigest ?? null,
                duplicateOfRecordId: row.externalCredential?.duplicateOfRecordId ?? null,
              },
              custody: currentCustody,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 15_000 },
        ),
      { recordId: input.recordId, tenantId: input.tenantId, op: 'reserve' },
    );
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    // Lost the pending-index or generation-key race; another request reserved
    // (or created) first. Read the winner the same way the finalisation
    // catch does.
    // `error` rather than `err`, reduced by `safeError`: this line is on the
    // key-bearing path, and pino's error serialiser expands an `err` binding
    // and walks its whole `cause` chain, which on this path has run with the
    // supplier's key in scope (ADR-055 decision 1). The thrown value here is
    // in practice a Prisma unique-constraint violation, which carries no key
    // material, but the rule holds with no exceptions to remember, and the
    // surrounding ids and message already make the failure findable.
    logger.warn(
      { error: safeError(error), recordId: input.recordId, tenantId: input.tenantId },
      'Recovery reservation insert lost a unique race; reading the winner',
    );
    if (!raceRetried) {
      return reserveRecoveryGenerationAttempt(input, true);
    }
    return resolveCheckRunRaceOutcome(input.recordId, input.tenantId, input.keyBearing === true);
  }
}

/**
 * The durable copy a successful key-bearing recovery displaced. Returned so
 * the caller can remove it once the replacement is committed: it is no longer
 * named by any row, so nothing else will ever reach it. `storageUri` is a
 * string because a recovery that replaced nothing reports no retired copy at
 * all.
 */
export type RetiredRecoveryStorage = {
  storageUri: string;
  storageServiceInstanceId: string | null;
  storageExternalId: string | null;
  storageBucket: string | null;
};

/**
 * A finalisation result, plus the retired copy when this call actually
 * replaced one. Only a `created` outcome can carry it, because only the
 * branch that commits a custody replacement retires anything, and saying so
 * in the type is what stops a caller reaching for the field on an outcome
 * that could never hold it. The property is optional, so a caller that never
 * looks at it behaves exactly as it did before.
 */
export type FinaliseRecoveryGenerationResult =
  | (Extract<CreateReverificationGenerationResult, { outcome: 'created' }> & {
      retiredStorage?: RetiredRecoveryStorage;
    })
  | Exclude<CreateReverificationGenerationResult, { outcome: 'created' }>;

export type FinaliseRecoveryGenerationInput = {
  recordId: string;
  tenantId: string;
  /** The exact run {@link reserveRecoveryGeneration} returned. */
  checkRunId: string;
  generation: number;
  /**
   * Exactly the tuple {@link reserveRecoveryGeneration} returned from under
   * its own lock, never the caller's pre-lock read: this is the fence the
   * finalisation compares the row against, so defaulting it would fence
   * against a state nobody observed.
   */
  expectedCustody: ReverificationCustodySnapshot;
  freshness?: SourceFreshness;
  prepared: RecoverInRequestOutcome;
  enqueue: (sql: SqlExecutor, job: VerifyJobReference) => Promise<void>;
};

/**
 * Test-only interleaving seam for {@link finaliseRecoveryGeneration}.
 * `afterParentLock`, when set, is awaited immediately after the
 * parent-lock query commits, before any further statement in the
 * transaction, the exact point a genuine two-connection lock-order test
 * needs to hold one finalisation open while a second, real connection
 * attempts to lock the same parent. Left unset (the default) this is a
 * no-op; production code never sets it.
 */
export const recoveryFinaliseTestHooks: { afterParentLock?: (recordId: string) => Promise<void> } = {};

type PreparedStorageDiscardReason =
  | 'joined'
  | 'superseded'
  | 'missing'
  | 'transaction-failed'
  | 'rejected-replacement'
  | 'conflict'
  | 'not-applicable';

/**
 * How many lock-discovery restarts one finalisation may spend in total,
 * across every distinct id that turns out to be missing. Sized for the
 * concurrent racers a single content digest can genuinely have, not just
 * two: N records independently recovering the same new content can each, in
 * the worst case, move the digest's holder once as they settle in some
 * order, so a finalisation that starts last among N racers may need up to
 * N-1 restarts to catch up to a holder that kept moving out from under its
 * pre-plan. Three restarts covers up to four concurrent racers on one
 * digest; a fifth restart still exhausts, because a set that keeps moving
 * past that many concurrent writers is treated as pathological rather than
 * given an unbounded retry budget.
 */
const MAX_LOCK_DISCOVERY_RESTARTS = 3;

/** Thrown inside a finalisation transaction when the lock set discovered under lock needs an id this attempt did not pre-lock. Caught only by {@link finaliseRecoveryGenerationAttempt}, which restarts up to {@link MAX_LOCK_DISCOVERY_RESTARTS} times, in total, with that id added each time. */
class RecoveryLockDiscoveryMismatchError extends Error {
  readonly missingId: string;
  constructor(missingId: string) {
    super(`Recovery finalisation needs a lock on record ${missingId}, discovered only after locking`);
    this.name = 'RecoveryLockDiscoveryMismatchError';
    this.missingId = missingId;
  }
}

/**
 * Thrown when this finalisation has already spent all
 * {@link MAX_LOCK_DISCOVERY_RESTARTS} of its lock-discovery restarts and a
 * further mismatch still occurs: the set of records this recovery needs to
 * lock kept changing (a holder or an advisory set moving under it) rather
 * than settling within that bound. `recoverExternalRecord` in
 * `reverify-library-record.ts` catches it and settles the reservation
 * `FAILED` and retryable, naming a moving identity set. This message states
 * only what happened: the next step is appended by that caller from the
 * reserved custody, because a record still holding an unopened copy cannot be
 * taken forward by a plain re-verify. When that settle
 * write is confirmed the request answers 202 with the settled generation,
 * so the caller's next re-verify tries again against whatever the set looks
 * like next; an unconfirmed settle rethrows to the sanitised 500.
 */
export class RecoveryLockDiscoveryExhaustedError extends Error {
  constructor() {
    super(
      'The records this recovery needs to lock kept changing across a restart; a moving identity set prevented finalisation from acquiring a stable lock set.',
    );
    this.name = 'RecoveryLockDiscoveryExhaustedError';
  }
}

/**
 * Thrown inside a finalisation transaction, at the exact write that hit a
 * content-digest unique violation, so the outer catch never has to guess
 * which write it was from. `promotion` is the write
 * that gives up a digest this row is relinquishing to an advisory row;
 * `acquisition` is the write that claims a digest for this row itself.
 * `digest` is the identity that collided: the old digest being relinquished
 * for a promotion, the new digest being claimed for an acquisition. Neither
 * phase implies the other is absent: an ordinary recovery that both
 * relinquishes an old digest and acquires a new one can collide on either
 * write, and only the write that actually collided is the one reported.
 */
class RecoveryCollisionError extends Error {
  readonly phase: 'promotion' | 'acquisition';
  readonly digest: string;
  override readonly cause: unknown;
  constructor(phase: 'promotion' | 'acquisition', digest: string, cause: unknown) {
    super(`Recovery ${phase} collided with a concurrent writer for content digest ${digest}`);
    this.name = 'RecoveryCollisionError';
    this.phase = phase;
    this.digest = digest;
    this.cause = cause;
  }
}

/**
 * Thrown when a write meant for the claimed reservation matches no row.
 * Under the `FOR UPDATE` claim this transaction takes on that row before any
 * child write, this should never actually happen while the transaction still
 * holds that lock; it exists as defence in depth, and as the one signal every
 * write to the run shares regardless of which branch made it. Caught only by
 * {@link finaliseRecoveryGenerationAttempt}'s outer catch, which reports the
 * outcome as `superseded` and rolls the whole transaction back rather than
 * leaving a partial write committed beside a run it could not actually claim.
 */
class RecoveryReservationLostError extends Error {
  constructor() {
    super('Recovery reservation is no longer the exact pending run this attempt claimed');
    this.name = 'RecoveryReservationLostError';
  }
}

/**
 * Every write to the claimed run's `CheckRun` row goes through here,
 * whichever branch made it: the terminal-acquisition settlement and the
 * moved-identity settlement, which both return before the fetched-content
 * rule runs at all, as well as that rule's own two branches.
 *
 * An `updateMany` predicated on the run's whole identity (id, record,
 * generation and tenant) and on the same pending, unenqueued state the claim
 * already confirmed, so a write that somehow matches no row (it should not,
 * under the claim's lock) is reported rather than silently doing nothing.
 * Binding the record and the generation, not the id alone, is what stops a
 * write landing on a run belonging to another record of the same tenant or
 * to another generation of this one.
 */
/**
 * The sticky `decryptionKeyUnused` flag, written from a branch that settles a
 * failed run and deliberately changes nothing else.
 *
 * The flag records that a caller supplied a decryption key an attempt never
 * needed, and it stays set so the record projection keeps saying so on every
 * later read (ADR-055). The rejected-replacement and identity-cleared
 * branches both settle FAILED and return before the finalisation's main
 * external-row write, so without this call the fact is discarded and the
 * caller who sent an unnecessary key is never told. That column only: leaving
 * custody, identity and details exactly as they were is the whole point of
 * those branches. In the same transaction as the failed run, so the run and
 * the flag commit together or not at all, and a superseded finalisation (which
 * rolls its transaction back before reaching either branch) writes neither.
 */
async function markDecryptionKeyUnused(
  tx: Prisma.TransactionClient,
  input: { recordId: string; tenantId: string },
  prepared: RecoverInRequestOutcome,
): Promise<void> {
  if (prepared.decryptionKeyUnused !== true) return;
  await tx.externalCredential.update({
    where: {
      id_tenantId_origin: { id: input.recordId, tenantId: input.tenantId, origin: LibraryRecordOrigin.EXTERNAL },
    },
    data: { decryptionKeyUnused: true },
  });
}

async function updateClaimedRun(
  tx: Prisma.TransactionClient,
  input: { recordId: string; generation: number; checkRunId: string; tenantId: string },
  data: Prisma.CheckRunUpdateManyMutationInput,
): Promise<void> {
  const result = await tx.checkRun.updateMany({
    where: {
      id: input.checkRunId,
      recordId: input.recordId,
      generation: input.generation,
      tenantId: input.tenantId,
      state: CheckRunState.PENDING,
      lastEnqueuedAt: null,
    },
    data,
  });
  if (result.count !== 1) throw new RecoveryReservationLostError();
}

/**
 * Step 3 of recovery. Locks the reserved run's parent (and every other
 * `LibraryRecord` the identity reconciliation touches, in id order) and
 * re-fences before writing anything: the run must still be `PENDING` with
 * `lastEnqueuedAt` null, and custody must still match `expectedCustody`,
 * which is the exact tuple the reservation observed under its own lock. That
 * is empty for a no-copy recovery and the raw copy's coordinates for a
 * key-bearing one, so the same fence covers both without either caller
 * stating a rule of its own. If the fence fails (the sweep settled the
 * reservation as abandoned, or the record's custody moved), any copy this
 * attempt stored is orphan-logged and the current generation is returned
 * rather than attached.
 *
 * Two acquisition modes reach here. Mode A fetched the supplier source and
 * observed provenance; mode B read the record's own durable copy and
 * observed no supplier at all, so it writes no `sourceDigest` and no
 * freshness pair. An acquisition that ended in its own failure (a copy that
 * could not be read, could not be proven intact, or would not open) settles
 * that failure's own code, message, retryability and checks and returns
 * before any content rule applies, so a wrong key is never rewritten as
 * `DECRYPTION_REQUIRED` and no identity, details or custody column is
 * touched.
 *
 * Otherwise applies the fetched-content rule: an opened credential's identity
 * and details always replace the row's (promoting a relinquished digest's
 * oldest advisory in the same transaction, which bumps every promoted and
 * repointed parent's `updatedAt`); a body that did not open a credential on a
 * row that already holds a content identity is refused without touching that
 * identity, custody or details; a body that did not open a credential on a
 * row with no identity is stored as acquired, exactly as registration does.
 */
export async function finaliseRecoveryGeneration(
  input: FinaliseRecoveryGenerationInput,
): Promise<FinaliseRecoveryGenerationResult> {
  return finaliseRecoveryGenerationAttempt(input, true, [], false, 0);
}

async function finaliseRecoveryGenerationAttempt(
  input: FinaliseRecoveryGenerationInput,
  retryContentDigestCollision: boolean,
  forcedLockIds: string[],
  /** A promotion collision retries once, bounded independently of `retryContentDigestCollision`. */
  promotionRetried: boolean,
  /** Total lock-discovery restarts spent so far, bounded to {@link MAX_LOCK_DISCOVERY_RESTARTS} for the whole finalisation regardless of how many distinct ids triggered it. */
  discoveryRestarts: number,
): Promise<FinaliseRecoveryGenerationResult> {
  const observedDigest = input.prepared.contentDigest ?? input.prepared.observedContentDigest;
  // Set by the one branch that replaces custody, and read after the
  // transaction commits: a copy is only retired once the write that displaced
  // it is durable.
  let retired: RetiredRecoveryStorage | undefined;
  try {
    // Planned with plain (unlocked) reads on the global client, before any
    // transaction opens: this is a caller with no transaction of its own, and
    // running it here rather than inside `$transaction` means finalisation
    // never holds a transaction's own connection idle while the global client
    // borrows a second one from the pool for this same read. Merged below with
    // any id a previous attempt discovered it needed too late. Re-derivation
    // under lock, on the transaction client, either confirms this set is
    // enough or restarts with the id it was missing (bounded to
    // `MAX_LOCK_DISCOVERY_RESTARTS` restarts). Deliberately inside this try: a preliminary read that rejects (after
    // this attempt's own caller already stored a copy) must still orphan-log
    // that copy's coordinates before rethrowing, exactly as a failure from
    // inside the transaction itself does, rather than escaping uncaught with
    // the copy's coordinates never reported. The recursive retry below
    // re-enters this same function, so its own pre-plan read is covered by
    // its own try the same way.
    const planned = await planRecoveryLockCandidates(input.tenantId, input.recordId, input.prepared, observedDigest);
    const result = await withDeadlockRetry(
      () =>
        prisma.$transaction(
          async (tx): Promise<CreateReverificationGenerationResult> => {
            // First statement in the callback, because `withDeadlockRetry`
            // re-runs this whole callback after a deadlock and the previous
            // attempt's writes have been rolled back with it. Without the
            // reset, an attempt that replaced custody and then deadlocked
            // leaves this set; a retry that takes a different branch (a
            // concurrent writer having given the row a content identity in
            // between) returns 'created' without replacing anything, and the
            // caller would otherwise receive the first attempt's retired
            // tuple and remove the record's LIVE copy.
            retired = undefined;
            const lockIds = [...new Set([input.recordId, ...planned, ...forcedLockIds])].sort();
            // The requirement is that every writer which locks more than
            // one parent (this finalisation, the library delete) acquires
            // them in one consistent global order: that is what the
            // deadlock-freedom argument for these transactions depends on.
            // The shared helper issues one statement, ascending by id, so
            // the order lives in exactly one place and a change to it is a
            // visible edit there rather than a race under contention.
            const lockedIds = await lockLibraryRecordsForUpdate(tx, lockIds, input.tenantId);
            if (!lockedIds.has(input.recordId)) return { outcome: 'missing' };

            // Test-only seam: lets an integration test hold
            // this transaction open exactly here, between the parent lock
            // above and every later statement, to drive a genuine two-connection
            // interleaving deterministically instead of hoping two concurrent
            // calls happen to race. A no-op unless a test sets it; never
            // invoked in production.
            if (recoveryFinaliseTestHooks.afterParentLock)
              await recoveryFinaliseTestHooks.afterParentLock(input.recordId);

            // The atomic claim: the first statement after the parent locks,
            // before any child write. A plain read here (as this used to be)
            // leaves a window between the read and this transaction's own
            // later write in which a sweep (or any other settler) can commit
            // its own `UPDATE` of this exact row; a finalisation that then
            // writes unconditionally resurrects a run the sweep already
            // failed and attaches custody to a generation nobody is
            // reserving any more. `FOR UPDATE` on the run itself, with the
            // same predicate the fence used to only read, closes that window:
            // a concurrent settler's own write blocks on this lock until this
            // transaction commits or rolls back, and then finds nothing left
            // to match.
            const claimedRun = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT "id" FROM "CheckRun" WHERE "id" = $1 AND "recordId" = $2 AND "tenantId" = $3 AND "generation" = $4 AND "state" = 'PENDING' AND "lastEnqueuedAt" IS NULL FOR UPDATE`,
              input.checkRunId,
              input.recordId,
              input.tenantId,
              input.generation,
            );

            const row = (await tx.libraryRecord.findFirst({
              where: { id: input.recordId, tenantId: input.tenantId },
              include: REVERIFICATION_ROW_INCLUDE,
            })) satisfies ReverificationRow | null;
            if (row === null || row.origin !== LibraryRecordOrigin.EXTERNAL || row.externalCredential === null) {
              return { outcome: 'missing' };
            }
            const current = row.externalCredential;
            const newest = row.checkRuns[0] ?? null;

            // Anything the claim above did not confirm, or custody that
            // moved under this reservation, means the sweep or another actor
            // already settled it, or the record moved.
            const observedCustody = custodyOf(row, await readKeyPresence(tx, input.recordId, input.tenantId));
            if (claimedRun.length === 0 || !sameCustody(observedCustody, input.expectedCustody)) {
              return { outcome: 'superseded', generation: newest?.generation ?? null };
            }

            // Re-derive the actual lock requirement under lock. If it needs an id
            // this attempt did not pre-lock, abort and restart rather than write
            // beside an unlocked parent.
            const required = await planRecoveryLockCandidates(
              input.tenantId,
              input.recordId,
              input.prepared,
              observedDigest,
              tx,
            );
            for (const id of required) {
              if (!lockedIds.has(id)) throw new RecoveryLockDiscoveryMismatchError(id);
            }

            const prepared = input.prepared;
            // Two different observations, deliberately split, because
            // mode B makes one of them and never the other.
            //
            // `sourceObserved` means a SUPPLIER was read, which is what
            // licenses the `sourceDigest` overwrite and the `sourceChanged` /
            // `lastSourceCheckAt` freshness pair. Only an acquisition whose
            // mode is `source` carries a digest, so a stored-copy attempt
            // cannot reach those writes at all.
            //
            // `contentObserved` means a BODY was classified, which is what
            // licenses the identity, `encrypted`, `contentKind` and details
            // writes. Mode B does make this observation on a successful
            // decrypt, so it does write those. An outcome that reached no
            // body (a failed fetch, a failed or unprovable stored read) and
            // one that reached a body it could not open (a wrong key, a
            // corrupt envelope) both leave `contentKind` undefined, and both
            // fall through to a branch that reads the failure straight off
            // `prepared.checkRun` and touches no custody, identity or detail
            // column. Gating on this first is what stops a retrieval failure
            // on an identity-holding row being misreported as
            // `SOURCE_NOT_CREDENTIAL` with `retrieval: PASS`.
            const sourceObserved = prepared.acquisition.mode === 'source';
            const contentObserved = prepared.contentKind !== undefined;
            const holdsIdentity = current.contentDigest !== null || current.duplicateOfRecordId !== null;

            // A stored-copy read, integrity or decrypt failure is already
            // classified by the recovery attempt. It must not be
            // reinterpreted as a source replacement failure, and it cannot
            // have earned any content metadata or freshness observation.
            //
            // Defence in depth, and deliberately not mutation-provable today:
            // the rejected-replacement branch below already defers to
            // `prepared.checkRun.failure` for a FAILED run, and its freshness
            // writes are gated on `sourceObserved`, which a stored-copy
            // acquisition can never set. Removing this branch therefore writes
            // the same row for every input the types admit. It earns its place
            // by making the rule explicit rather than a coincidence of two
            // other branches, and it is the type predicate below, not a test,
            // that enforces reading `failure` off a narrowed FAILED run.
            if (isTerminalAcquisitionFailure(prepared)) {
              const now = new Date(Date.now());
              await updateClaimedRun(tx, input, {
                state: CheckRunState.FAILED,
                ...noChecksRun(),
                ...prepared.checkRun.checks,
                failureCode: prepared.checkRun.failure.code,
                failureMessage: prepared.checkRun.failure.message,
                failureRetryable: prepared.checkRun.failure.retryable,
                sourceChanged: null,
                lastSourceCheckAt: null,
                completedAt: now,
              });
              return { outcome: 'created' as const, generation: input.generation, checkRunId: input.checkRunId };
            }

            const notOpened = contentObserved && prepared.contentKind !== ExternalContentKind.CREDENTIAL;

            // The store was skipped in-request because the reservation's own
            // snapshot already held an identity, so this prepared failure was
            // never earned on its own terms: it exists only because storing
            // it would have been discarded anyway. If that identity has since
            // been cleared (a concurrent write during the fetch), the premise
            // this failure was built on no longer holds, and consuming it
            // (via the rejected-replacement branch below, keyed on
            // `holdsIdentity`, which is now false) would misreport a genuine
            // fetch as a rejection rather than as the moved-identity race it
            // actually is. Settled as its own failure instead, writing
            // nothing else, so a re-verify's honest retry is what actually
            // fetches this source again.
            if (prepared.storageSkipped === 'identity-held' && !holdsIdentity) {
              if (prepared.acquisition.mode === 'stored-copy' && prepared.checkRun.state === CheckRunState.FAILED) {
                const now = new Date(Date.now());
                await updateClaimedRun(tx, input, {
                  state: CheckRunState.FAILED,
                  ...noChecksRun(),
                  ...prepared.checkRun.checks,
                  failureCode: prepared.checkRun.failure.code,
                  failureMessage: prepared.checkRun.failure.message,
                  failureRetryable: prepared.checkRun.failure.retryable,
                  sourceChanged: null,
                  lastSourceCheckAt: null,
                  completedAt: now,
                });
                await markDecryptionKeyUnused(tx, input, prepared);
                return { outcome: 'created' as const, generation: input.generation, checkRunId: input.checkRunId };
              }
              const now = new Date(Date.now());
              await updateClaimedRun(tx, input, {
                state: CheckRunState.FAILED,
                ...noChecksRun(),
                ...prepared.checkRun.checks,
                // "Nothing else written" for this branch means no custody,
                // identity or details column, not the freshness pair. This
                // is reached only after the stored-copy sub-branch above has
                // returned, so a supplier fetch genuinely ran and was
                // observed, exactly as in the rejected-replacement branch
                // below, and the same pair is stamped the same way. If that
                // guard above is ever relaxed, this stamp stops being true
                // and has to move behind `sourceObserved` as the
                // rejected-replacement branch's already does.
                sourceChanged:
                  input.freshness === undefined
                    ? sourceObserved && sourceDigestOf(prepared) !== current.sourceDigest
                    : input.freshness.sourceChanged,
                lastSourceCheckAt: input.freshness?.checkedAt ?? now,
                failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
                failureMessage:
                  "The record's identity changed while its source was being fetched. Re-verify to fetch again.",
                failureRetryable: true,
                completedAt: now,
              });
              await markDecryptionKeyUnused(tx, input, prepared);
              return { outcome: 'created' as const, generation: input.generation, checkRunId: input.checkRunId };
            }

            if (notOpened && holdsIdentity) {
              // Reject the replacement (cases b/d of the fetched-content rule): the source
              // returned bytes, but not the credential this row already holds an
              // identity for, and not unopened ciphertext with no identity to
              // protect either. Custody, identity and details are left exactly
              // as they were; the copy the caller may have stored is an orphan.
              const now = new Date(Date.now());
              const failure =
                prepared.checkRun.state === CheckRunState.FAILED
                  ? prepared.checkRun.failure
                  : rejectedReplacementFailure(prepared);
              await updateClaimedRun(tx, input, {
                state: CheckRunState.FAILED,
                ...noChecksRun(),
                ...prepared.checkRun.checks,
                sourceChanged: sourceObserved
                  ? input.freshness === undefined
                    ? sourceDigestOf(prepared) !== current.sourceDigest
                    : input.freshness.sourceChanged
                  : null,
                lastSourceCheckAt: sourceObserved ? input.freshness?.checkedAt ?? now : null,
                failureCode: failure.code,
                failureMessage: failure.message,
                failureRetryable: failure.retryable,
                completedAt: now,
              });
              await markDecryptionKeyUnused(tx, input, prepared);
              // The generation itself is created successfully (outcome
              // 'created'), so the generic post-transaction orphan report below
              // (gated on a non-'created' outcome) never runs for this branch.
              // A copy may still have been stored and then deliberately not
              // attached, which is exactly what that report exists to catch.
              reportPreparedStorage(input, prepared, 'rejected-replacement');
              return { outcome: 'created' as const, generation: input.generation, checkRunId: input.checkRunId };
            }
            if (prepared.storage !== undefined) {
              await replaceCustody(tx, {
                recordId: input.recordId,
                tenantId: input.tenantId,
                storage: prepared.storage,
              });
              // Captured inside the branch that actually replaced custody,
              // never from the outcome alone: the rejected-replacement branch
              // above also reaches a 'created' outcome with a stored copy,
              // and there the record KEEPS its existing copy. Capturing it
              // there would name a live copy as retired, and the caller
              // REMOVES what this names, so it would delete the record's only
              // copy.
              retired = retiredCopyOf(current, prepared.storage);
            }

            const identity =
              contentObserved && prepared.contentKind === ExternalContentKind.CREDENTIAL
                ? await reconcileIdentity(tx, input, current, prepared, lockedIds)
                : undefined;
            const externalData = {
              ...(contentObserved
                ? {
                    ...(sourceObserved ? { sourceDigest: sourceDigestOf(prepared) } : {}),
                    encrypted: prepared.encrypted,
                    contentKind: prepared.contentKind,
                  }
                : {}),
              ...(prepared.decryptionKeyUnused === true ? { decryptionKeyUnused: true } : {}),
              ...(identity ?? {}),
            };
            if (Object.keys(externalData).length > 0) {
              try {
                await tx.externalCredential.update({
                  where: {
                    id_tenantId_origin: {
                      id: input.recordId,
                      tenantId: input.tenantId,
                      origin: LibraryRecordOrigin.EXTERNAL,
                    },
                  },
                  data: externalData,
                });
              } catch (error) {
                // This is the write that claims a digest for this row itself
                // tagged 'acquisition' so the outer catch never has
                // to infer the phase from `observedDigest`'s definedness, which
                // is defined on the ordinary path regardless of which write, if
                // either, actually collided.
                if (isContentDigestUniqueViolation(error) && observedDigest !== undefined) {
                  throw new RecoveryCollisionError('acquisition', observedDigest, error);
                }
                throw error;
              }
            }
            // An unobserved outcome (the re-fetch failed outright) leaves the
            // LibraryRecord row alone entirely: the failed attempt is recorded by
            // the generation row, not by touching descriptive fields or the
            // details status on a record whose source was never actually read.
            if (contentObserved) {
              const details = detailsColumns(prepared.details);
              await tx.libraryRecord.update({
                where: { id_tenantId: { id: input.recordId, tenantId: input.tenantId } },
                data: { ...details, updatedAt: new Date(Date.now()) },
              });
            }

            const now = new Date(Date.now());
            const checkRunData = {
              state: prepared.checkRun.state,
              ...noChecksRun(),
              ...prepared.checkRun.checks,
              // Gated on the freshness pair the caller passed, not on what
              // the acquisition observed: a mode A fetch that returned
              // nothing still ATTEMPTED a supplier read, and the contract
              // records that attempt as `sourceChanged: null` with a
              // timestamp. Mode B passes no freshness at all, so both stay
              // null there, which is what R1 requires.
              sourceChanged: input.freshness?.sourceChanged ?? null,
              lastSourceCheckAt: input.freshness?.checkedAt ?? null,
              ...(prepared.checkRun.state === CheckRunState.FAILED
                ? {
                    failureCode: prepared.checkRun.failure.code,
                    failureMessage: prepared.checkRun.failure.message,
                    failureRetryable: prepared.checkRun.failure.retryable,
                    completedAt: now,
                  }
                : // The claim above only ever admits a genuinely `PENDING` run,
                  // whose failure and completion columns are already null, but
                  // a successful settlement states them explicitly anyway
                  // rather than relying on that invariant holding forever.
                  {
                    lastEnqueuedAt: now,
                    failureCode: null,
                    failureMessage: null,
                    failureRetryable: null,
                    completedAt: null,
                  }),
            };
            await updateClaimedRun(tx, input, checkRunData);
            if (prepared.checkRun.state !== CheckRunState.FAILED) {
              await input.enqueue(prismaSqlExecutor(tx), {
                tenantId: input.tenantId,
                recordId: input.recordId,
                generation: input.generation,
                checkRunId: input.checkRunId,
              });
            }
            return { outcome: 'created', generation: input.generation, checkRunId: input.checkRunId };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 15_000 },
        ),
      { recordId: input.recordId, tenantId: input.tenantId, op: 'finalise' },
    );
    if (result.outcome !== 'created') reportPreparedStorage(input, input.prepared, result.outcome);
    else if (retired !== undefined) return { ...result, retiredStorage: retired };
    return result;
  } catch (error) {
    if (error instanceof RecoveryReservationLostError) {
      // The claim's own lock should make this unreachable while it is held;
      // reported the same way a failed claim is, with no generation number
      // to report since the write that would have supplied it rolled back.
      reportPreparedStorage(input, input.prepared, 'superseded');
      return { outcome: 'superseded', generation: null };
    }
    if (error instanceof RecoveryLockDiscoveryMismatchError) {
      if (discoveryRestarts >= MAX_LOCK_DISCOVERY_RESTARTS) {
        // Bounded total for the whole finalisation, not per distinct id: a
        // changing holder or advisory set could otherwise keep supplying a
        // new missing id and extending the operation indefinitely, each
        // attempt getting its own fresh transaction timeout and
        // deadlock-retry allowance.
        reportPreparedStorage(input, input.prepared, 'transaction-failed');
        throw new RecoveryLockDiscoveryExhaustedError();
      }
      return finaliseRecoveryGenerationAttempt(
        input,
        retryContentDigestCollision,
        [...forcedLockIds, error.missingId],
        promotionRetried,
        discoveryRestarts + 1,
      );
    }
    if (error instanceof RecoveryCollisionError) {
      const { phase, digest, cause } = error;
      if (phase === 'promotion') {
        // A promotion collision: the digest this row was relinquishing was
        // claimed by a concurrent writer before this transaction's own
        // release-then-hand-to-the-advisory-row promotion could complete.
        // Retried once, bounded independently of
        // `retryContentDigestCollision`: the restart re-reads `current`
        // fresh under lock, and either the promotion is no longer needed
        // (another writer already moved the digest on) or it is attempted
        // again against whatever now holds it.
        if (!promotionRetried) {
          let winner: string | null;
          try {
            winner = await findExternalByContentDigest(input.tenantId, digest, input.recordId);
          } catch (lookupError) {
            reportPreparedStorage(input, input.prepared, 'transaction-failed');
            throw lookupError;
          }
          logger.warn(
            { recordId: input.recordId, tenantId: input.tenantId, digest, winner },
            'Content identity promotion collided with a concurrent writer; retrying once',
          );
          return finaliseRecoveryGenerationAttempt(
            input,
            retryContentDigestCollision,
            [...forcedLockIds, ...(winner === null ? [] : [winner])],
            true,
            discoveryRestarts,
          );
        }
        logger.error(
          { recordId: input.recordId, tenantId: input.tenantId, digest },
          'Content identity promotion collided twice with a concurrent writer',
        );
        reportPreparedStorage(input, input.prepared, 'transaction-failed');
        throw cause;
      }
      // phase === 'acquisition': this row's own claim to a content digest
      // lost the race, exactly the case the pre-existing retry below already
      // handles, so it is reported the same way using the tagged cause.
      if (retryContentDigestCollision) {
        let winner: string | null;
        try {
          winner = await findExternalByContentDigest(input.tenantId, digest, input.recordId);
        } catch (lookupError) {
          reportPreparedStorage(input, input.prepared, 'transaction-failed');
          throw lookupError;
        }
        const prepared =
          winner === null
            ? asCanonicalIdentity(input.prepared, digest)
            : recoveredAsDuplicate(input.prepared, winner, digest);
        return finaliseRecoveryGenerationAttempt(
          { ...input, prepared },
          false,
          [...forcedLockIds, ...(winner === null ? [] : [winner])],
          promotionRetried,
          discoveryRestarts,
        );
      }
      let winner: string | null = null;
      let winnerLookupFailed = false;
      try {
        winner = await findExternalByContentDigest(input.tenantId, digest, input.recordId);
      } catch {
        winnerLookupFailed = true;
      }
      logger.error(
        { recordId: input.recordId, tenantId: input.tenantId, winner },
        winner !== null
          ? 'Content identity collided twice and another record now holds it'
          : winnerLookupFailed
            ? 'Content identity collided twice; the current holder could not be confirmed'
            : 'Content identity collided twice and no record holds it after rollback',
      );
      reportPreparedStorage(input, input.prepared, 'transaction-failed');
      throw cause;
    }
    if (isContentDigestUniqueViolation(error)) {
      // Defensive fallback only: every write that can hit this violation is
      // now wrapped and rethrows a tagged RecoveryCollisionError above, so
      // this branch should be unreachable in practice.
      reportPreparedStorage(input, input.prepared, 'transaction-failed');
      throw error;
    }
    if (!isUniqueConstraintViolation(error)) {
      reportPreparedStorage(input, input.prepared, 'transaction-failed');
      throw error;
    }
    // Lost the CheckRun-index race (the partial pending index or the
    // record-and-generation key); another request's write beat this one.
    // Wrapped so a throw from the post-rollback read still reports the
    // orphan before propagating.
    try {
      // Reduced for the same reason the reservation's own race line is: this
      // is the key-bearing path, and an unreduced `err` binding hands pino
      // the whole cause chain to expand (ADR-055 decision 1).
      logger.warn(
        { error: safeError(error), recordId: input.recordId, tenantId: input.tenantId },
        'Recovery finalisation insert lost a unique race; reading the winner',
      );
      // Called without `keyBearing`, so a pending winner reads as `joined`
      // even for a request that carried a key. That is deliberate and it is
      // not a dropped key: by this point the acquisition has already run and
      // the key has already been consumed, and this call neither reserves nor
      // re-acquires anything. The label is a projection of what the
      // caller should poll, not a statement that the key was refused. The
      // reservation path is the one that must distinguish them, and it passes
      // the flag.
      const result = await resolveCheckRunRaceOutcome(input.recordId, input.tenantId);
      reportPreparedStorage(
        input,
        input.prepared,
        result.outcome === 'reserved' ? 'transaction-failed' : result.outcome,
      );
      if (result.outcome === 'reserved' || result.outcome === 'conflict' || result.outcome === 'not-applicable') {
        return { outcome: 'superseded', generation: null };
      }
      return result;
    } catch (readError) {
      reportPreparedStorage(input, input.prepared, 'transaction-failed');
      throw readError;
    }
  }
}

/** Ids this finalisation needs a `LibraryRecord` lock on, beyond its own row: the digest holder (preferred, or by lookup) and the advisory taking a relinquished digest, plus every row that advisory's promotion repoints. Reused for the unlocked pre-plan and, passed `tx`, the locked re-derivation. */
async function planRecoveryLockCandidates(
  tenantId: string,
  recordId: string,
  prepared: RecoverInRequestOutcome,
  observedDigest: string | undefined,
  tx?: Prisma.TransactionClient,
): Promise<string[]> {
  const client = tx ?? prisma;
  const ids = new Set<string>();
  if (observedDigest !== undefined) {
    if (prepared.duplicateOfRecordId !== undefined) {
      if (tx === undefined) {
        // The unlocked pre-plan is optimistic: a preferred holder deleted
        // since preparation is dropped below instead, once the locked
        // re-derivation can actually confirm it is gone.
        ids.add(prepared.duplicateOfRecordId);
      } else {
        // Under lock: a preferred holder that no longer exists must not
        // become a permanently required lock (it can never be acquired, so
        // every re-derivation would demand it again and exhaust the bounded
        // discovery restart budget for no reason), so it is dropped and
        // reconciliation's own revalidation falls through to canonical
        // acquisition, exactly as it already does for a preferred holder
        // that lost the digest without being deleted.
        const stillExists = await client.externalCredential.findUnique({
          where: { id: prepared.duplicateOfRecordId },
          select: { id: true },
        });
        if (stillExists !== null) ids.add(prepared.duplicateOfRecordId);
      }
    }
    const holder = await findExternalByContentDigest(tenantId, observedDigest, recordId, client);
    if (holder !== null) ids.add(holder);
  }
  // The digest this row would relinquish, if any, is read under the row's
  // own lock when `tx` is given; the unlocked pre-plan does not have that
  // row locked yet, so it reads the same column with a plain query instead.
  // `client` is already `tx ?? prisma` (the two arms
  // this used to branch on were identical).
  const currentDigest =
    (await client.externalCredential.findUnique({ where: { id: recordId }, select: { contentDigest: true } }))
      ?.contentDigest ?? null;
  if (currentDigest !== null) {
    const advisory = await client.externalCredential.findFirst({
      where: { tenantId, duplicateOfRecordId: recordId, contentDigest: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (advisory !== null) {
      ids.add(advisory.id);
      const repointed = await client.externalCredential.findMany({
        where: { tenantId, duplicateOfRecordId: recordId, contentDigest: null, NOT: { id: advisory.id } },
        select: { id: true },
      });
      repointed.forEach((r) => ids.add(r.id));
    }
  }
  ids.delete(recordId);
  return [...ids];
}

/**
 * The supplier digest this attempt observed, or null when it observed no
 * supplier. Narrowing on the acquisition's own discriminant, so a
 * stored-copy attempt cannot reach a digest it never computed.
 */
function sourceDigestOf(prepared: RecoverInRequestOutcome): string | null {
  return prepared.acquisition.mode === 'source' ? prepared.acquisition.sourceDigest : null;
}

/**
 * An acquisition that reached its own end without producing a body to
 * classify: the reserved copy could not be read, could not be proven intact,
 * or would not open. Every one of those settles the code, message,
 * retryability and checks the attempt already decided, and nothing else.
 *
 * A type predicate rather than a hoisted boolean, so the settlement below
 * reads `failure` off a narrowed `FAILED` run instead of asserting it is
 * there three times.
 */
function isTerminalAcquisitionFailure(prepared: RecoverInRequestOutcome): prepared is RecoverInRequestOutcome & {
  checkRun: { state: typeof CheckRunState.FAILED; checks: AcquisitionChecks; failure: CheckRunFailure };
} {
  return (
    prepared.acquisition.mode === 'stored-copy' &&
    prepared.contentKind === undefined &&
    prepared.checkRun.state === CheckRunState.FAILED
  );
}

function rejectedReplacementFailure(prepared: RecoverInRequestOutcome): CheckRunFailure {
  if (prepared.encrypted === true) {
    return {
      code: CheckRunFailureCode.DECRYPTION_REQUIRED,
      message:
        "The re-fetched source is encrypted and this service holds no key that opens it. The record's existing content identity and details have been preserved unchanged; the fetched ciphertext was discarded rather than replacing them.",
      retryable: true,
    };
  }
  return {
    code: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL,
    message:
      'The re-fetched source did not return the credential this record already holds. Its content identity and details have been preserved unchanged; the fetched body was discarded rather than replacing them.',
    retryable: true,
  };
}

/**
 * The update-time twin of `detailsColumns` in `external-credential.repository.ts`.
 * That twin is a `create`, where an unset column is already null at the
 * schema default. This one is an `update` on a row that may already carry
 * EXTRACTED values from an earlier attempt, so a non-EXTRACTED status must
 * state every column's null explicitly to actually clear a stale value.
 */
function detailsColumns(capture: ExternalDetailsCapture) {
  switch (capture.status) {
    case CredentialDetailsStatus.EXTRACTED:
      return { ...extractedDetailsColumns(capture), detailsStatus: capture.status, detailsError: null };
    case CredentialDetailsStatus.EXTRACTION_FAILED:
      return { ...EXTRACTED_DETAILS_NULL_COLUMNS, detailsStatus: capture.status, detailsError: capture.error };
    case CredentialDetailsStatus.EXTRACTION_PENDING:
      return { ...EXTRACTED_DETAILS_NULL_COLUMNS, detailsStatus: capture.status, detailsError: null };
  }
}

/**
 * Revalidates a duplicate pointer, then finds the current holder if it moved.
 * Promotion (giving up a digest this row already held to its oldest
 * advisory) and this reconciliation both write only to ids the caller has
 * already locked, per `planRecoveryLockCandidates`.
 */
async function reconcileIdentity(
  tx: Prisma.TransactionClient,
  input: FinaliseRecoveryGenerationInput,
  current: NonNullable<ReverificationRow['externalCredential']>,
  prepared: RecoverInRequestOutcome,
  lockedIds: Set<string>,
): Promise<{ contentDigest: string | null; duplicateOfRecordId: string | null } | undefined> {
  const observedDigest = prepared.contentDigest ?? prepared.observedContentDigest;
  const newDigest = observedDigest ?? null;
  if (current.contentDigest !== null && current.contentDigest !== newDigest) {
    try {
      await promoteExternalCredentialDigest(tx, {
        recordId: input.recordId,
        tenantId: input.tenantId,
        contentDigest: current.contentDigest,
      });
    } catch (error) {
      // The write that hands the digest this row is relinquishing to an
      // advisory row: tagged 'promotion' so the outer catch
      // never has to infer the phase from `observedDigest`'s definedness,
      // which is defined on the ordinary path regardless of which write, if
      // either, actually collided.
      if (isContentDigestUniqueViolation(error)) {
        throw new RecoveryCollisionError('promotion', current.contentDigest, error);
      }
      throw error;
    }
  }
  if (observedDigest === undefined) return undefined;
  if (current.contentDigest === observedDigest && current.duplicateOfRecordId === null) {
    return { contentDigest: observedDigest, duplicateOfRecordId: null };
  }

  // Revalidate the preferred pointer first; only query for any holder at all
  // if that misses. (`lockedDigestHolder` used to run its own
  // fallback query internally on a preferred miss, so this caller's own
  // fallback below ran a second, redundant, all-tenant query whenever
  // neither found a holder. `lockedDigestHolder` now checks only the id it
  // is given, so each of these two calls has one job and this caller decides
  // whether the second is needed at all.)
  const preferred = prepared.duplicateOfRecordId;
  const holder =
    preferred === undefined ? null : await lockedDigestHolder(tx, input.tenantId, observedDigest, preferred);
  // `lockedAnyDigestHolder` discovers without locking first and validates the
  // candidate against `lockedIds` itself before ever taking a child lock, so
  // by the time it returns a non-null id, that id is already confirmed
  // locked; a mismatch throws from inside it instead. `holder` (the
  // preferred-pointer path, via `lockedDigestHolder`) is not independently
  // revalidated here: `planRecoveryLockCandidates`'s `required` check, just
  // above in the caller, already confirmed `prepared.duplicateOfRecordId` (if
  // it still exists) is locked before this function ever runs.
  const resolved =
    holder ?? (await lockedAnyDigestHolder(tx, input.tenantId, observedDigest, input.recordId, lockedIds));
  return resolved === null
    ? { contentDigest: observedDigest, duplicateOfRecordId: null }
    : { contentDigest: null, duplicateOfRecordId: resolved };
}

/** Revalidates a specific candidate still holds the digest, under lock. */
async function lockedDigestHolder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contentDigest: string,
  candidateRecordId: string,
): Promise<string | null> {
  const preferred = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "ExternalCredential" WHERE "id" = $1 AND "tenantId" = $2 AND "contentDigest" = $3 FOR UPDATE',
    candidateRecordId,
    tenantId,
    contentDigest,
  );
  return preferred[0]?.id ?? null;
}

/**
 * Finds whichever record in the tenant holds the digest, excluding the
 * recovering record itself: discover, validate, then lock, never lock first.
 * A plain (unlocked) read finds the live holder, if any. If that holder's
 * `LibraryRecord` parent is not one of `lockedIds`, this throws before any
 * `ExternalCredential` `FOR UPDATE` is ever issued: locking a child whose
 * parent this attempt has not confirmed locked is exactly the FK
 * key-share-vs-`FOR UPDATE` ordering that makes a deadlock reachable again,
 * and a single `SELECT ... FOR UPDATE` cannot discover a holder and validate
 * it against the lock set in one step. The validation has to happen on the
 * unlocked read's result, before the locking read is even issued. Only once
 * validated does the locking read run, and only against that exact
 * candidate id; if it returns a different row (the holder moved between the
 * two reads), that is treated as a mismatch too rather than silently locking
 * whatever now happens to hold the digest.
 */
async function lockedAnyDigestHolder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contentDigest: string,
  excludeRecordId: string,
  lockedIds: Set<string>,
): Promise<string | null> {
  const probe = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "ExternalCredential" WHERE "tenantId" = $1 AND "contentDigest" = $2 AND "id" <> $3 ORDER BY "createdAt" ASC, "id" ASC LIMIT 1',
    tenantId,
    contentDigest,
    excludeRecordId,
  );
  const candidate = probe[0]?.id ?? null;
  if (candidate === null) return null;
  if (!lockedIds.has(candidate)) {
    throw new RecoveryLockDiscoveryMismatchError(candidate);
  }
  const holders = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "ExternalCredential" WHERE "id" = $1 AND "tenantId" = $2 AND "contentDigest" = $3 FOR UPDATE',
    candidate,
    tenantId,
    contentDigest,
  );
  const locked = holders[0]?.id ?? null;
  if (locked !== candidate) {
    throw new RecoveryLockDiscoveryMismatchError(candidate);
  }
  return locked;
}

/**
 * Rewrites `prepared` to point at `winner` for `retryDigest`, whether or not
 * `prepared` already carried a duplicate pointer: a
 * second failure can mean the preferred holder from preparation vanished and
 * a different one has since claimed the digest, so the pointer this
 * transaction writes must always be the one it just confirmed under lock.
 */
/**
 * A digest collision (acquisition or promotion) only ever reaches these two
 * rewrites once a content identity was actually being written, which only a
 * `CredentialOutcome` carries. Narrowing here replaces
 * the `as RecoverInRequestOutcome` casts these two functions used to need:
 * their return type is exactly the arm of `CredentialOutcome` they build.
 */
function isCredentialOutcome(prepared: RecoverInRequestOutcome): prepared is CredentialOutcome {
  return prepared.contentKind === ExternalContentKind.CREDENTIAL;
}

function recoveredAsDuplicate(
  prepared: RecoverInRequestOutcome,
  winner: string,
  retryDigest: string,
): CredentialOutcome {
  if (!isCredentialOutcome(prepared)) {
    throw new Error('A content-digest collision can only occur while writing an opened credential outcome');
  }
  const { contentDigest: _drop, ...rest } = prepared;
  void _drop;
  return { ...rest, duplicateOfRecordId: winner, observedContentDigest: retryDigest };
}

/** No holder was found on retry: this row keeps the digest as canonical. */
function asCanonicalIdentity(prepared: RecoverInRequestOutcome, digest: string): CredentialOutcome {
  if (!isCredentialOutcome(prepared)) {
    throw new Error('A content-digest collision can only occur while writing an opened credential outcome');
  }
  const { duplicateOfRecordId: _drop, observedContentDigest: _drop2, ...rest } = prepared;
  void _drop;
  void _drop2;
  return { ...rest, contentDigest: digest };
}

function reportPreparedStorage(
  ref: { recordId: string; tenantId: string },
  prepared: RecoverInRequestOutcome,
  reason: PreparedStorageDiscardReason,
): void {
  if (prepared.storage === undefined) return;
  const storage = prepared.storage;
  logger.error(
    {
      recordId: ref.recordId,
      tenantId: ref.tenantId,
      reason,
      storageUri: storage.uri,
      storageExternalId: storage.externalId,
      storageBucket: storage.bucket ?? null,
    },
    'Prepared recovery copy is orphaned and needs operator cleanup',
  );
}

/**
 * The object a custody replacement displaced, or `undefined` when it
 * displaced nothing.
 *
 * Read from the row this transaction locked rather than from the caller's
 * pre-lock snapshot. The fence has already proved the two agree on the
 * coordinates it compares, but that snapshot carries neither the bucket nor
 * the service instance, and a removal cannot run without both.
 *
 * A replacement naming the object it displaced retires nothing: what the
 * caller does with this is delete it, so returning the live copy here would
 * destroy the record's only copy. The storage adapter mints a fresh object id
 * for every store, so this guards against a future adapter rather than an
 * observed case.
 */
function retiredCopyOf(
  current: {
    storageUri: string | null;
    storageServiceInstanceId: string | null;
    storageExternalId: string | null;
    storageBucket: string | null;
  },
  replacement: ExternalStorageInput,
): RetiredRecoveryStorage | undefined {
  if (current.storageUri === null) return undefined;
  if (current.storageExternalId === replacement.externalId && current.storageBucket === (replacement.bucket ?? null)) {
    return undefined;
  }
  return {
    storageUri: current.storageUri,
    storageServiceInstanceId: current.storageServiceInstanceId,
    storageExternalId: current.storageExternalId,
    storageBucket: current.storageBucket,
  };
}

/**
 * Reads the run that won a lost CheckRun-index race, and translates it to the
 * outcome a caller reports. Shared by {@link reserveRecoveryGeneration} and
 * {@link finaliseRecoveryGenerationAttempt}'s non-content-digest catch.
 * `'reserved'` never actually applies here (the winner is read after the
 * fact, never created by this call). It exists only so the shared return
 * type lines up; callers normalise it away.
 */
async function resolveCheckRunRaceOutcome(
  recordId: string,
  tenantId: string,
  keyBearing = false,
): Promise<
  | { outcome: 'joined' }
  | { outcome: 'conflict'; reason: RecoveryConflictReason; generation: number }
  | { outcome: 'not-applicable' }
  | { outcome: 'superseded'; generation: number | null }
  | { outcome: 'missing' }
  | {
      outcome: 'reserved';
      generation: number;
      checkRunId: string;
      identity: ReservedIdentitySnapshot;
      custody: ReverificationCustodySnapshot;
    }
> {
  const newest = await findLatestCheckRun(recordId, tenantId);
  if (newest === null) {
    return (await readRecordEligibility(recordId, tenantId)) === null
      ? { outcome: 'missing' }
      : { outcome: 'superseded', generation: null };
  }
  if (!keyBearing) {
    return newest.state === CheckRunState.PENDING
      ? { outcome: 'joined' }
      : { outcome: 'superseded', generation: newest.generation };
  }
  // Rule 4 before rule 5, matching the published precedence and the locked
  // reservation above: a key this record can never accept is answered as such
  // whether or not a generation also happens to be pending.
  const eligibility = await readRecordEligibility(recordId, tenantId);
  if (
    eligibility !== null &&
    eligibility.origin === LibraryRecordOrigin.EXTERNAL &&
    // This read is a key-presence projection with no custody beside it, so
    // it passes no `storageUri`. The predicate's docblock carries why that
    // is safe, and names the other two sites that decide the same rule.
    cannotAcceptSupplierKey({ decryptionKeyPresent: eligibility.keyPresent })
  ) {
    return { outcome: 'not-applicable' };
  }
  if (newest.state === CheckRunState.PENDING) {
    return { outcome: 'conflict', reason: 'pending', generation: newest.generation };
  }
  // The winner has settled and the record is still eligible, so this
  // request's key was never consumed by anything. `superseded` would be
  // answered `202` with the winner's envelope, which a caller cannot tell
  // apart from their own key having been applied. `conflict` says what
  // actually happened, and `race-lost` is what makes the caller's message
  // say the key was not used rather than telling them to wait for a
  // settlement that has already happened.
  return { outcome: 'conflict', reason: 'race-lost', generation: newest.generation };
}

/**
 * The two facts this resolver needs about the record itself: whether it still
 * exists, and whether an external row already holds a receiver key.
 *
 * Read through {@link readKeyPresence} and a narrow origin select rather than
 * through the record's detail view, which returns the full Prisma rows and so
 * loads both key envelopes into memory. Nothing here logs them, so the detail
 * view was a consistency gap rather than a leak; keeping every read of this
 * predicate on the same projection is what makes
 * {@link REVERIFICATION_ROW_INCLUDE}'s claim about this module true rather
 * than nearly true. Two statements on the pooled client, not one transaction:
 * this runs after a rolled-back attempt, holds no lock and decides nothing
 * that a lock would protect.
 */
async function readRecordEligibility(
  recordId: string,
  tenantId: string,
): Promise<{ origin: LibraryRecordOrigin; keyPresent: boolean } | null> {
  const record = await prisma.libraryRecord.findFirst({
    where: { id: recordId, tenantId },
    select: { origin: true },
  });
  if (record === null) return null;
  const keys = await readKeyPresence(prisma, recordId, tenantId);
  return {
    origin: record.origin,
    keyPresent: record.origin === LibraryRecordOrigin.NATIVE ? keys.credential : keys.external,
  };
}

function custodyOf(row: ReverificationRow, keys: KeyPresence): ReverificationCustodySnapshot {
  if (row.origin === LibraryRecordOrigin.NATIVE) {
    if (row.credential === null) return emptyCustody();
    return {
      storageUri: row.credential.storageUri,
      storageDigestMultibase: row.credential.digestMultibase,
      storageExternalId: null,
      decryptionKeyPresent: keys.credential,
      encrypted: null,
    };
  }
  if (row.externalCredential === null) return emptyCustody();
  return {
    storageUri: row.externalCredential.storageUri,
    storageDigestMultibase: row.externalCredential.storageDigestMultibase,
    storageExternalId: row.externalCredential.storageExternalId,
    decryptionKeyPresent: keys.external,
    encrypted: row.externalCredential.encrypted,
  };
}

function sameCustody(a: ReverificationCustodySnapshot, b: ReverificationCustodySnapshot): boolean {
  return CUSTODY_FIELDS.every((field) => a[field] === b[field]);
}

function emptyCustody(): ReverificationCustodySnapshot {
  return {
    storageUri: null,
    storageDigestMultibase: null,
    storageExternalId: null,
    decryptionKeyPresent: false,
    encrypted: null,
  };
}

/**
 * State-guarded: only a row still PENDING is written. Generations are
 * append-only, so this is the only transition a row ever takes; a settled
 * row is never written again.
 */
async function settle(ref: CheckRunRef, data: Prisma.CheckRunUpdateManyMutationInput): Promise<CheckRunSettleOutcome> {
  const updated = await prisma.checkRun.updateMany({
    where: { id: ref.id, tenantId: ref.tenantId, state: CheckRunState.PENDING },
    data,
  });
  if (updated.count > 0) {
    return { outcome: 'applied' };
  }
  const exists = await prisma.checkRun.count({ where: { id: ref.id, tenantId: ref.tenantId } });
  return { outcome: exists > 0 ? 'superseded' : 'missing' };
}

/** Settles a PENDING generation as COMPLETE with its checks. */
export async function settleCheckRunComplete(input: SettleCheckRunCompleteInput): Promise<CheckRunSettleOutcome> {
  return settle(input, {
    state: CheckRunState.COMPLETE,
    ...input.checks,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    completedAt: new Date(Date.now()),
  });
}

/** Settles a PENDING generation as FAILED with the reason the caller acts on. */
export async function settleCheckRunFailed(input: SettleCheckRunFailedInput): Promise<CheckRunSettleOutcome> {
  return settle(input, {
    state: CheckRunState.FAILED,
    ...input.checks,
    failureCode: input.failure.code,
    failureMessage: input.failure.message,
    failureRetryable: input.failure.retryable,
    completedAt: new Date(Date.now()),
  });
}

/**
 * Scoped by the tenant the run carries, the same key its record is read
 * under, so a record id from another tenant reads as absent rather than as
 * someone else's run.
 */
export async function findCheckRun(recordId: string, generation: number, tenantId: string): Promise<CheckRun | null> {
  return prisma.checkRun.findFirst({ where: { recordId, generation, tenantId } });
}

/** The newest stored run of a record, or null when it has none. Tenant-scoped like {@link findCheckRun}. */
export async function findLatestCheckRun(recordId: string, tenantId: string): Promise<CheckRun | null> {
  return prisma.checkRun.findFirst({
    where: { recordId, tenantId },
    orderBy: { generation: 'desc' },
  });
}

/**
 * Finds pending generations whose enqueue marker is absent or older than the
 * reconciliation cutoff. A missing marker is bounded by the row's own clock
 * too, so a run created without one is given the same grace as every other
 * run rather than being settled on the next tick.
 *
 * Crosses tenants, unlike every other read here. That is what a system sweep
 * is: it is reached only from the worker's scheduled job, never from a
 * request, and each row it settles carries its own tenant to the settle.
 *
 * Capped by `limit` rather than unbounded, so one tick over a large backlog
 * cannot load and settle every row inside one job attempt. The next tick
 * takes the rest, oldest first. The sweep resolves the limit from the
 * operator's setting and passes it in.
 */
export async function findAbandonedPendingCheckRuns(cutoff: Date, limit: number): Promise<CheckRun[]> {
  return prisma.checkRun.findMany({
    where: {
      state: CheckRunState.PENDING,
      OR: [{ lastEnqueuedAt: null, requestedAt: { lt: cutoff } }, { lastEnqueuedAt: { lt: cutoff } }],
    },
    orderBy: { requestedAt: 'asc' },
    take: limit,
  });
}

/**
 * The custody facts that decide what an abandoned run's caller should do
 * next, projected rather than selected: `decryptionKeyPresent` is the
 * key column's IS NOT NULL, so the envelope itself never enters this row
 * object and can never reach a log from here.
 */
type AbandonedRunCustody = {
  origin: LibraryRecordOrigin;
  storageUri: string | null;
  encrypted: boolean | null;
  decryptionKeyPresent: boolean;
};

/**
 * What to tell the caller of a generation the sweep is settling. A record
 * still holding an unopened encrypted copy cannot be taken forward by a plain
 * re-verify (that is refused `DECRYPTION_REQUIRED` before any fetch), so it
 * is told to send its key again. Every other record, native or already
 * receiver-protected included, gets the generic message: a native copy's key
 * is this service's own and a protected external copy's key is already held,
 * so neither caller has a key to resend and asking for one would be wrong.
 *
 * A record whose custody cannot be read at all is settled anyway, with a
 * third message that names both moves. The settlement must still happen: a
 * failed read of the parent is not a reason to leave the run PENDING for
 * ever. But the generic message would misdirect exactly the unopened-copy
 * record this feature exists for, and the resend message would misdirect
 * every native and receiver-protected one, so a message that covers both is
 * the honest projection of a read that established neither.
 */
async function abandonedRunMessage(run: CheckRun): Promise<string> {
  let custody: AbandonedRunCustody | undefined;
  try {
    const rows = await prisma.$queryRawUnsafe<AbandonedRunCustody[]>(
      `SELECT r."origin" AS "origin",
              e."storageUri" AS "storageUri",
              e."encrypted" AS "encrypted",
              (e."decryptionKey" IS NOT NULL) AS "decryptionKeyPresent"
         FROM "LibraryRecord" r
         LEFT JOIN "ExternalCredential" e ON e."id" = r."id" AND e."tenantId" = r."tenantId"
        WHERE r."id" = $1 AND r."tenantId" = $2`,
      run.recordId,
      run.tenantId,
    );
    custody = rows[0];
  } catch (error) {
    logger.warn(
      { error: safeError(error), recordId: run.recordId, tenantId: run.tenantId },
      "An abandoned run's custody could not be read; settling it with resume guidance that names both moves",
    );
    return ABANDONED_CUSTODY_UNKNOWN_MESSAGE;
  }
  if (custody === undefined) return ABANDONED_CUSTODY_UNKNOWN_MESSAGE;
  if (custody.origin !== LibraryRecordOrigin.EXTERNAL) return ABANDONED_RUN_MESSAGE;
  // The same predicate the request path's settled failures pick their own
  // guidance with, so the sweep and the request can never disagree about
  // which records have to resend a key.
  return holdsUnopenedCopy(custody) ? ABANDONED_UNOPENED_COPY_MESSAGE : ABANDONED_RUN_MESSAGE;
}

/**
 * Settles one abandoned generation with the state guard used by worker
 * results, and rechecks the abandonment predicate itself inside the UPDATE
 * (the sweep fix). Without that recheck, a reservation finalised
 * between this row's selection and this settlement (its `lastEnqueuedAt` just
 * refreshed by a real enqueue) would still be overwritten by a settlement
 * based on the stale selection. `cutoff` is the same value the caller
 * selected this run with.
 *
 * The resume guidance is chosen from the record's own custody
 * ({@link abandonedRunMessage}) rather than being one sentence for every
 * abandonment, because an interrupted key-bearing recovery leaves a record a
 * plain re-verify cannot take forward. The custody read is advisory and sits
 * outside the guarded UPDATE, whose predicate is unchanged: a reservation
 * finalised in the meantime still wins, and this settlement then writes
 * nothing at all.
 */
export async function settleAbandonedCheckRun(run: CheckRun, cutoff: Date): Promise<CheckRunSettleOutcome> {
  const failureMessage = await abandonedRunMessage(run);
  const updated = await prisma.checkRun.updateMany({
    where: {
      id: run.id,
      tenantId: run.tenantId,
      state: CheckRunState.PENDING,
      OR: [{ lastEnqueuedAt: null }, { lastEnqueuedAt: { lt: cutoff } }],
    },
    data: {
      state: CheckRunState.FAILED,
      ...checksOf(run),
      failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
      failureMessage,
      failureRetryable: true,
      completedAt: new Date(Date.now()),
    },
  });
  if (updated.count > 0) return { outcome: 'applied' };
  const exists = await prisma.checkRun.count({ where: { id: run.id, tenantId: run.tenantId } });
  return { outcome: exists > 0 ? 'superseded' : 'missing' };
}
