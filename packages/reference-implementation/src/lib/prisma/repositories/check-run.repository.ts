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
import { getLibraryRecordById, lockLibraryRecordsForUpdate } from './library-record.repository';
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
} from './external-credential.repository';
import { apiLogger } from '@/lib/api/logger';
import { CHECK_NAMES, type LibraryCheckName } from '@/lib/library/check-rules';
export { CHECK_NAMES } from '@/lib/library/check-rules';
import type { CredentialOutcome, RecoverInRequestOutcome } from '@/lib/library/register-external-credential';

const logger = apiLogger.child({ module: 'check-run.repository' });

// CHECK_NAMES is owned by check-rules.ts so the projection and list SQL share it.
export type CheckName = LibraryCheckName;

export type CheckResults = Record<CheckName, CheckResult>;

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
 * The custody coordinates a re-verification compares before it appends a
 * generation. The tuple is the roster: the type and {@link sameCustody}
 * both derive from it, so a coordinate added here is compared without any
 * further edit. The key envelope is deliberately absent, so a rewrap during
 * preparation does not read as a replaced copy.
 */
const CUSTODY_FIELDS = ['storageUri', 'storageDigestMultibase', 'storageExternalId'] as const;

export type ReverificationCustodySnapshot = Record<(typeof CUSTODY_FIELDS)[number], string | null>;

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
 * The no-copy recovery branch does not use this function at all:
 * it reserves and finalises its own generation through
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
    storageExternalId: string | null;
    sourceDigest: string | null;
    contentDigest: string | null;
    duplicateOfRecordId: string | null;
  } | null;
  checkRuns: Array<{ id: string; generation: number; state: CheckRunState; lastEnqueuedAt: Date | null }>;
};

const REVERIFICATION_ROW_INCLUDE = {
  credential: { select: { storageUri: true, digestMultibase: true } },
  externalCredential: {
    select: {
      storageUri: true,
      storageDigestMultibase: true,
      storageExternalId: true,
      sourceDigest: true,
      contentDigest: true,
      duplicateOfRecordId: true,
    },
  },
  checkRuns: {
    orderBy: { generation: 'desc' } as const,
    take: 1,
    select: { id: true, generation: true, state: true, lastEnqueuedAt: true },
  },
} satisfies Prisma.LibraryRecordInclude;

/**
 * Locks and rechecks the parent before adding a generation. The transaction
 * deliberately uses Read Committed because each query must see the row after
 * the parent lock is acquired, including a custody change made during
 * preparation. The key envelope is not part of the comparison, so a rewrap
 * does not create a competing generation.
 *
 * Serves the native branch and the protected-copy freshness-only branch of
 * `reverifyLibraryRecord`. The no-copy recovery branch is a separate
 * reserve-then-finalise pair: it needs the fetch to happen
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
    return result.outcome === 'reserved' ? { outcome: 'superseded', generation: null } : result;
  }
}

async function createReverificationGenerationOnce(
  input: CreateReverificationGenerationInput,
): Promise<CreateReverificationGenerationResult> {
  return prisma.$transaction(
    async (tx): Promise<CreateReverificationGenerationResult> => {
      const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "LibraryRecord" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE',
        input.recordId,
        input.tenantId,
      );
      if (locked.length === 0) return { outcome: 'missing' };

      const row = (await tx.libraryRecord.findFirst({
        where: { id: input.recordId, tenantId: input.tenantId },
        include: REVERIFICATION_ROW_INCLUDE,
      })) satisfies ReverificationRow | null;
      if (row === null) return { outcome: 'missing' };

      const newest = row.checkRuns[0] ?? null;
      const currentGeneration = newest?.generation ?? (row.origin === LibraryRecordOrigin.NATIVE ? 1 : 0);
      const currentCustody = custodyOf(row);
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
  /** Must still be the empty (no-copy) tuple; the caller only reserves for a record it read with no durable copy. */
  expectedCustody: ReverificationCustodySnapshot;
};

/** The identity facts read under the reservation's own row lock, at the exact moment generation N+1 was claimed. */
export type ReservedIdentitySnapshot = { contentDigest: string | null; duplicateOfRecordId: string | null };

export type ReserveRecoveryGenerationResult =
  | { outcome: 'reserved'; generation: number; checkRunId: string; identity: ReservedIdentitySnapshot }
  | { outcome: 'joined' }
  | { outcome: 'superseded'; generation: number | null }
  | { outcome: 'missing' };

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
  try {
    return await withDeadlockRetry(
      () =>
        prisma.$transaction(
          async (tx): Promise<ReserveRecoveryGenerationResult> => {
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "LibraryRecord" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE',
              input.recordId,
              input.tenantId,
            );
            if (locked.length === 0) return { outcome: 'missing' };

            const row = (await tx.libraryRecord.findFirst({
              where: { id: input.recordId, tenantId: input.tenantId },
              include: REVERIFICATION_ROW_INCLUDE,
            })) satisfies ReverificationRow | null;
            if (row === null || row.origin !== LibraryRecordOrigin.EXTERNAL) return { outcome: 'missing' };

            const newest = row.checkRuns[0] ?? null;
            const currentGeneration = newest?.generation ?? 0;
            if (newest?.state === CheckRunState.PENDING) return { outcome: 'joined' };
            const currentCustody = custodyOf(row);
            if (currentGeneration !== input.expectedGeneration || !sameCustody(currentCustody, input.expectedCustody)) {
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
    logger.warn(
      { err: error, recordId: input.recordId, tenantId: input.tenantId },
      'Recovery reservation insert lost a unique race; reading the winner',
    );
    return resolveCheckRunRaceOutcome(input.recordId, input.tenantId);
  }
}

export type FinaliseRecoveryGenerationInput = {
  recordId: string;
  tenantId: string;
  /** The exact run {@link reserveRecoveryGeneration} returned. */
  checkRunId: string;
  generation: number;
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

type PreparedStorageDiscardReason = 'joined' | 'superseded' | 'missing' | 'transaction-failed' | 'rejected-replacement';

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
 * than settling within that bound. `recoverNoCopyRecord` in
 * `reverify-library-record.ts` catches it and settles the reservation
 * `FAILED` and retryable, naming a moving identity set. When that settle
 * write is confirmed the request answers 202 with the settled generation,
 * so the caller's next re-verify tries again against whatever the set looks
 * like next; an unconfirmed settle rethrows to the sanitised 500.
 */
export class RecoveryLockDiscoveryExhaustedError extends Error {
  constructor() {
    super(
      'The records this recovery needs to lock kept changing across a restart; a moving identity set prevented finalisation from acquiring a stable lock set. Re-verify to try again.',
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
 * Every write to the claimed run's `CheckRun` row, from either branch of the
 * fetched-content rule, goes through here: an `updateMany` predicated on the
 * same pending state the claim already confirmed, so a write that somehow
 * matches no row (it should not, under the claim's lock) is reported rather
 * than silently doing nothing.
 */
async function updateClaimedRun(
  tx: Prisma.TransactionClient,
  input: { checkRunId: string; tenantId: string },
  data: Prisma.CheckRunUpdateManyMutationInput,
): Promise<void> {
  const result = await tx.checkRun.updateMany({
    where: {
      id: input.checkRunId,
      tenantId: input.tenantId,
      state: CheckRunState.PENDING,
      lastEnqueuedAt: null,
    },
    data,
  });
  if (result.count !== 1) throw new RecoveryReservationLostError();
}

/**
 * Step 3 of recovery. Locks the reserved run's parent (and
 * every other `LibraryRecord` the identity reconciliation touches, in id
 * order) and re-fences before writing anything: the run must still
 * be `PENDING` with `lastEnqueuedAt` null, and custody must still be empty.
 * If the fence fails (the sweep settled the reservation as abandoned, or the
 * record moved), any copy the caller's fetch stored is orphan-logged and the
 * current generation is returned rather than attached.
 *
 * Otherwise applies the fetched-content rule: an opened
 * credential's identity and details always replace the row's (promoting a
 * relinquished digest's oldest advisory in the same transaction, which bumps
 * every promoted and repointed parent's `updatedAt`); a response that did not
 * open a credential on a row that already holds a content identity is
 * refused without touching that identity, custody or details; a response
 * that did not open a credential on a row with no identity is stored as
 * fetched, exactly as registration does.
 */
export async function finaliseRecoveryGeneration(
  input: FinaliseRecoveryGenerationInput,
): Promise<CreateReverificationGenerationResult> {
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
): Promise<CreateReverificationGenerationResult> {
  const observedDigest = input.prepared.contentDigest ?? input.prepared.observedContentDigest;
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
              `SELECT "id" FROM "CheckRun" WHERE "id" = $1 AND "tenantId" = $2 AND "state" = 'PENDING' AND "lastEnqueuedAt" IS NULL FOR UPDATE`,
              input.checkRunId,
              input.tenantId,
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
            if (claimedRun.length === 0 || current.storageUri !== null) {
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
            // A body was actually fetched: `contentKind` is only meaningful
            // once this is true. An unobserved outcome (the fetch failed
            // outright, or the guard refused the source) leaves
            // `contentKind` undefined, which fails the `!== CREDENTIAL`
            // check below just as surely as a fetched non-credential body
            // would; gating on `observed` first stops a retrieval failure on
            // an identity-holding row from being misreported as
            // `SOURCE_NOT_CREDENTIAL` with `retrieval: PASS`. An unobserved
            // outcome instead falls through to the generic path below,
            // which reads its failure straight off
            // `prepared.checkRun` and touches no custody, identity or detail
            // column, exactly as library.md step 5's fourth bullet requires.
            const observed = prepared.sourceDigest !== undefined;
            const notOpened = observed && prepared.contentKind !== ExternalContentKind.CREDENTIAL;
            const holdsIdentity = current.contentDigest !== null || current.duplicateOfRecordId !== null;

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
              const now = new Date(Date.now());
              await updateClaimedRun(tx, input, {
                state: CheckRunState.FAILED,
                ...noChecksRun(),
                // "Nothing else written" for this branch means no custody,
                // identity or details column, not the freshness pair: a
                // fetch genuinely ran and was observed here, exactly as the
                // rejected-replacement branch below, so the same pair is
                // stamped the same way.
                sourceChanged:
                  input.freshness === undefined
                    ? prepared.sourceDigest !== undefined && prepared.sourceDigest !== current.sourceDigest
                    : input.freshness.sourceChanged,
                lastSourceCheckAt: input.freshness?.checkedAt ?? now,
                failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
                failureMessage:
                  "The record's identity changed while its source was being fetched. Re-verify to fetch again.",
                failureRetryable: true,
                completedAt: now,
              });
              return { outcome: 'created' as const, generation: input.generation, checkRunId: input.checkRunId };
            }

            if (notOpened && holdsIdentity) {
              // Reject the replacement (cases b/d of the fetched-content rule): the source
              // returned bytes, but not the credential this row already holds an
              // identity for, and not unopened ciphertext with no identity to
              // protect either. Custody, identity and details are left exactly
              // as they were; the copy the caller may have stored is an orphan.
              const now = new Date(Date.now());
              const failure = rejectedReplacementFailure(prepared);
              await updateClaimedRun(tx, input, {
                state: CheckRunState.FAILED,
                ...noChecksRun(),
                retrieval: CheckResult.PASS,
                decryption: prepared.encrypted === true ? CheckResult.FAIL : CheckResult.NOT_RUN,
                sourceChanged:
                  input.freshness === undefined
                    ? prepared.sourceDigest !== undefined && prepared.sourceDigest !== current.sourceDigest
                    : input.freshness.sourceChanged,
                lastSourceCheckAt: input.freshness?.checkedAt ?? now,
                failureCode: failure.code,
                failureMessage: failure.message,
                failureRetryable: failure.retryable,
                completedAt: now,
              });
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
            }

            const identity = observed ? await reconcileIdentity(tx, input, current, prepared, lockedIds) : undefined;
            const externalData = {
              ...(observed
                ? {
                    sourceDigest: prepared.sourceDigest,
                    encrypted: prepared.encrypted,
                    contentKind: prepared.contentKind,
                  }
                : {}),
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
            if (observed) {
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
      logger.warn(
        { err: error, recordId: input.recordId, tenantId: input.tenantId },
        'Recovery finalisation insert lost a unique race; reading the winner',
      );
      const result = await resolveCheckRunRaceOutcome(input.recordId, input.tenantId);
      reportPreparedStorage(
        input,
        input.prepared,
        result.outcome === 'reserved' ? 'transaction-failed' : result.outcome,
      );
      return result.outcome === 'reserved' ? { outcome: 'superseded', generation: null } : result;
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
): Promise<
  | { outcome: 'joined' }
  | { outcome: 'superseded'; generation: number | null }
  | { outcome: 'missing' }
  | { outcome: 'reserved'; generation: number; checkRunId: string; identity: ReservedIdentitySnapshot }
> {
  const newest = await findLatestCheckRun(recordId, tenantId);
  if (newest === null) {
    const current = await getLibraryRecordById(recordId, tenantId);
    return current === null ? { outcome: 'missing' } : { outcome: 'superseded', generation: null };
  }
  return newest.state === CheckRunState.PENDING
    ? { outcome: 'joined' }
    : { outcome: 'superseded', generation: newest.generation };
}

function custodyOf(row: ReverificationRow): ReverificationCustodySnapshot {
  if (row.origin === LibraryRecordOrigin.NATIVE) {
    if (row.credential === null) return { storageUri: null, storageDigestMultibase: null, storageExternalId: null };
    return {
      storageUri: row.credential.storageUri,
      storageDigestMultibase: row.credential.digestMultibase,
      storageExternalId: null,
    };
  }
  if (row.externalCredential === null)
    return { storageUri: null, storageDigestMultibase: null, storageExternalId: null };
  return {
    storageUri: row.externalCredential.storageUri,
    storageDigestMultibase: row.externalCredential.storageDigestMultibase,
    storageExternalId: row.externalCredential.storageExternalId,
  };
}

function sameCustody(a: ReverificationCustodySnapshot, b: ReverificationCustodySnapshot): boolean {
  return CUSTODY_FIELDS.every((field) => a[field] === b[field]);
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
 * Settles one abandoned generation with the state guard used by worker
 * results, and rechecks the abandonment predicate itself inside the UPDATE
 * (the sweep fix). Without that recheck, a reservation finalised
 * between this row's selection and this settlement (its `lastEnqueuedAt` just
 * refreshed by a real enqueue) would still be overwritten by a settlement
 * based on the stale selection. `cutoff` is the same value the caller
 * selected this run with.
 */
export async function settleAbandonedCheckRun(run: CheckRun, cutoff: Date): Promise<CheckRunSettleOutcome> {
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
      failureMessage:
        'The verification job did not report a result within the expected window. Re-verify to run it again.',
      failureRetryable: true,
      completedAt: new Date(Date.now()),
    },
  });
  if (updated.count > 0) return { outcome: 'applied' };
  const exists = await prisma.checkRun.count({ where: { id: run.id, tenantId: run.tenantId } });
  return { outcome: exists > 0 ? 'superseded' : 'missing' };
}
