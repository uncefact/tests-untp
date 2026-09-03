import { CheckResult, CheckRunState, type CheckRunFailureCode, type CheckRun, type Prisma } from '../generated';
import { prisma } from '../prisma';

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
