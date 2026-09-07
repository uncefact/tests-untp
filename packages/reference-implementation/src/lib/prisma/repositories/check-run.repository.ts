import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  LibraryRecordOrigin,
  Prisma,
  type CheckRun,
} from '../generated';
import { prisma } from '../prisma';
import { isUniqueConstraintViolation } from '@/lib/prisma/db-errors';
import { getLibraryRecordById } from './library-record.repository';
import { prismaSqlExecutor } from '@/lib/jobs/prisma-sql-executor';
import type { SqlExecutor } from '@/lib/jobs/types';
import type { VerifyJobReference } from './external-credential.repository';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ module: 'check-run.repository' });

/**
 * The seven checks a generation records (the coverage listed under ADR-055
 * decision 7; the generation row itself is ADR-053 decision 3; #955). Every check is always present; NOT_RUN
 * covers both "did not apply" and "did not execute". The wire contract's
 * summary is derived from the run's state and these results, never stored.
 * The tuple is the roster; the record type and {@link noChecksRun} derive from
 * it, so an eighth check is one edit and a build error everywhere it is not
 * yet handled.
 */
export const CHECK_NAMES = [
  'retrieval',
  'decryption',
  'digest',
  'proof',
  'status',
  'temporal',
  'schemaConformance',
] as const;

export type CheckName = (typeof CHECK_NAMES)[number];

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
  } | null;
  checkRuns: Array<{ generation: number; state: CheckRunState }>;
};

/**
 * Locks and rechecks the parent before adding a generation. The transaction
 * deliberately uses Read Committed because each query must see the row after
 * the parent lock is acquired, including a custody change made during
 * preparation. The key envelope is not part of the comparison, so a rewrap
 * does not create a competing generation.
 *
 * The recovery branch that replaces a durable copy extends this function
 * rather than wrapping it. It needs two things this function must gain and a
 * composition around it cannot get: a generation that settles inside the same
 * transaction with no enqueue, and the custody write made under the same lock
 * and compared against the snapshot taken before the copy was fetched. Calling
 * `replaceCustody` around this function instead would have the recheck read
 * the caller's own write and report the request as superseded by itself.
 */
export async function createReverificationGeneration(
  input: CreateReverificationGenerationInput,
): Promise<CreateReverificationGenerationResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "LibraryRecord" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE',
          input.recordId,
          input.tenantId,
        );
        if (locked.length === 0) return { outcome: 'missing' };

        // No tenant filter on the runs, for the reason the record reader
        // gives: the run's composite foreign key already pins it to the
        // parent's tenant, so a filter here could only narrow the newest
        // generation away and serve an older one as current. The parent is
        // already tenant-scoped by the where clause above.
        const row = (await tx.libraryRecord.findFirst({
          where: { id: input.recordId, tenantId: input.tenantId },
          include: {
            credential: { select: { storageUri: true, digestMultibase: true } },
            externalCredential: {
              select: { storageUri: true, storageDigestMultibase: true, storageExternalId: true },
            },
            checkRuns: {
              orderBy: { generation: 'desc' },
              take: 1,
              select: { generation: true, state: true },
            },
          },
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
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    // The insert lost a race on one of the CheckRun unique indexes, either the
    // partial pending index or the record-and-generation key. Both mean
    // another request won; the failed transaction is rolled back before this
    // read, so it sees the winner. Logged because a violation this design did
    // not anticipate would otherwise be reported as an ordinary join.
    logger.warn(
      { err: error, recordId: input.recordId, tenantId: input.tenantId },
      'Re-verification insert lost a unique race; reading the winner',
    );
    // Read the winning run rather than the record: the winner may have settled
    // between the rollback and this read, and a caller told it joined a
    // pending generation when none is running would poll for a result nobody
    // is producing.
    const newest = await findLatestCheckRun(input.recordId, input.tenantId);
    if (newest === null) {
      const current = await getLibraryRecordById(input.recordId, input.tenantId);
      return current === null ? { outcome: 'missing' } : { outcome: 'superseded', generation: null };
    }
    return newest.state === CheckRunState.PENDING
      ? { outcome: 'joined' }
      : { outcome: 'superseded', generation: newest.generation };
  }
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
 * Capped rather than unbounded, so one tick over a large backlog cannot load
 * and settle every row inside one job attempt. The next tick takes the rest,
 * oldest first.
 */
export const ABANDONED_PENDING_RUNS_PER_SWEEP = 500;

export async function findAbandonedPendingCheckRuns(cutoff: Date): Promise<CheckRun[]> {
  return prisma.checkRun.findMany({
    where: {
      state: CheckRunState.PENDING,
      OR: [{ lastEnqueuedAt: null, requestedAt: { lt: cutoff } }, { lastEnqueuedAt: { lt: cutoff } }],
    },
    orderBy: { requestedAt: 'asc' },
    take: ABANDONED_PENDING_RUNS_PER_SWEEP,
  });
}

/** Settles one abandoned generation with the state guard used by worker results. */
export async function settleAbandonedCheckRun(run: CheckRun): Promise<CheckRunSettleOutcome> {
  return settleCheckRunFailed({
    id: run.id,
    tenantId: run.tenantId,
    checks: checksOf(run),
    failure: {
      code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
      message: 'The verification job did not report a result within the expected window. Re-verify to run it again.',
      retryable: true,
    },
  });
}
