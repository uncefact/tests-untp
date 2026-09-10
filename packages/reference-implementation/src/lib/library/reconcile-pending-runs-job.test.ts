jest.mock('@/lib/api/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { apiLogger: logger };
});
jest.mock('@/lib/services/resolve-vc-service', () => ({ resolveVcService: jest.fn() }));
const mockFindAbandonedPendingCheckRuns = jest.fn();
jest.mock('@/lib/prisma/repositories/check-run.repository', () => ({
  findAbandonedPendingCheckRuns: (...args: unknown[]) => mockFindAbandonedPendingCheckRuns(...args),
  settleAbandonedCheckRun: jest.fn(),
}));

import { apiLogger } from '@/lib/api/logger';
import { CheckResult, CheckRunState, type CheckRun } from '@/lib/prisma/generated';
import { LIBRARY_RECONCILE_PENDING_RUNS_JOB } from '@/lib/jobs/queue-names';
import {
  defaultReconcilePendingRunsDependencies,
  reconcilePendingRunsHandler,
  registerPendingRunReconciliation,
  verificationAbandonmentCutoff,
  type ReconcilePendingRunsDependencies,
} from './reconcile-pending-runs-job';

const NOW = new Date('2026-09-07T00:00:00.000Z');

function loggerInfo(): jest.Mock {
  return apiLogger.info as unknown as jest.Mock;
}

beforeEach(() => {
  jest.clearAllMocks();
});

function run(id: string, lastEnqueuedAt: Date | null): CheckRun {
  return {
    id,
    recordId: `record-${id}`,
    tenantId: 'tenant-1',
    generation: 2,
    state: CheckRunState.PENDING,
    retrieval: CheckResult.NOT_RUN,
    decryption: CheckResult.NOT_RUN,
    digest: CheckResult.NOT_RUN,
    proof: CheckResult.NOT_RUN,
    status: CheckResult.NOT_RUN,
    temporal: CheckResult.NOT_RUN,
    schemaConformance: CheckResult.NOT_RUN,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    sourceChanged: null,
    lastSourceCheckAt: null,
    schemaConformanceMessage: null,
    requestedAt: NOW,
    completedAt: null,
    lastEnqueuedAt,
  };
}

function dependencies(overrides: Partial<ReconcilePendingRunsDependencies> = {}): ReconcilePendingRunsDependencies {
  return {
    findAbandoned: jest.fn().mockResolvedValue([]),
    settleAbandoned: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    now: () => NOW,
    ...overrides,
  };
}

describe('verificationAbandonmentCutoff', () => {
  it('rounds the complete retry ladder up to the one-hour default policy bound', () => {
    // Fails if the cutoff is computed from an unrounded ladder or drops the
    // configured default attempt expiry.
    const cutoff = verificationAbandonmentCutoff(NOW);

    expect(cutoff).toEqual(new Date('2026-09-06T23:00:00.000Z'));
  });

  it('bounds each retry by its jittered maximum, not by the unjittered doubling', () => {
    // pg-boss jitters the backoff up to twice the plain doubling, so a bound
    // computed from the unjittered ladder can expire while the job is still
    // waiting for its next attempt. Fails if the exponent starts at 0.
    const retry = { limit: 4, backoffSeconds: 60, backoffMaxSeconds: 600 };

    const cutoff = verificationAbandonmentCutoff(NOW, retry, 120);

    // Five attempts of 120 s plus jittered backoffs of 120, 240, 480 and 600
    // is 2040 seconds, which rounds up to 60 minutes. The unjittered ladder
    // would give 1500 seconds and round to 30.
    expect(cutoff).toEqual(new Date('2026-09-06T23:00:00.000Z'));
    expect(NOW.getTime() - cutoff.getTime()).toBeGreaterThan(30 * 60 * 1000);
  });

  it('counts one attempt expiry per attempt, not one for the whole ladder', () => {
    // Every attempt may run to its expiry. Fails if the expiry is added once,
    // which stays inside the 30-minute floor at today's values and drops below
    // the real ladder as soon as either the limit or the expiry grows.
    const retry = { limit: 4, backoffSeconds: 300, backoffMaxSeconds: 600 };

    const cutoff = verificationAbandonmentCutoff(NOW, retry, 600);

    // Five attempts of 600 s, plus backoffs capped at 600 each, is 5400
    // seconds, which rounds up to 90 minutes. Adding the expiry once would
    // give 3000 seconds and round to 60.
    expect(cutoff).toEqual(new Date('2026-09-06T22:30:00.000Z'));
  });
});

describe('reconcilePendingRunsHandler', () => {
  it('settles each stale or unmarked pending generation and leaves the cutoff visible to the repository', async () => {
    // Fails if the sweep silently ignores the null marker, skips one returned
    // run, or settles a fresh run selected by a missing cutoff.
    const abandoned = [run('run-null', null), run('run-old', new Date('2026-09-06T23:00:00.000Z'))];
    const deps = dependencies({ findAbandoned: jest.fn().mockResolvedValue(abandoned) });

    await reconcilePendingRunsHandler(deps)({}, {} as never);

    const cutoff = new Date('2026-09-06T23:00:00.000Z');
    expect(deps.findAbandoned).toHaveBeenCalledWith(cutoff);
    // The cutoff is passed to `settleAbandoned` too, so its own conditional
    // UPDATE can recheck the abandonment predicate
    // rather than trusting this selection's now-stale snapshot.
    expect(deps.settleAbandoned).toHaveBeenNthCalledWith(1, abandoned[0], cutoff);
    expect(deps.settleAbandoned).toHaveBeenNthCalledWith(2, abandoned[1], cutoff);
  });

  it('propagates a selection failure so a sweep that never ran is visible to the queue', async () => {
    // The rows were never read, so nothing can be settled. Fails if a catch
    // turns that into a green job and leaves abandoned generations pending
    // without an operator signal.
    const failure = new Error('database unavailable');
    const deps = dependencies({ findAbandoned: jest.fn().mockRejectedValue(failure) });

    await expect(reconcilePendingRunsHandler(deps)({}, {} as never)).rejects.toBe(failure);
  });

  it('continues past a row it cannot settle and reports the failure', async () => {
    // The rows are taken oldest first, so an unwrapped failure would put the
    // same row at the head of every later tick and no abandoned generation
    // anywhere would ever settle again. Fails if one bad row aborts the tick.
    const abandoned = [run('run-a', null), run('run-b', null), run('run-c', null)];
    const settleAbandoned = jest
      .fn()
      .mockResolvedValueOnce({ outcome: 'applied' })
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValueOnce({ outcome: 'applied' });
    const deps = dependencies({ findAbandoned: jest.fn().mockResolvedValue(abandoned), settleAbandoned });

    await expect(reconcilePendingRunsHandler(deps)({}, {} as never)).resolves.toBeUndefined();

    expect(settleAbandoned).toHaveBeenCalledTimes(3);
    expect(settleAbandoned).toHaveBeenNthCalledWith(3, abandoned[2], expect.any(Date));
    // The row that could not be settled is named, so an operator can find it
    // rather than reading a tick that quietly settled fewer rows than it
    // selected.
    expect(apiLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: abandoned[1].recordId,
        tenantId: abandoned[1].tenantId,
        checkRunId: abandoned[1].id,
        generation: abandoned[1].generation,
      }),
      'Abandoned verification generation could not be settled; the sweep continued',
    );
    expect(loggerInfo()).toHaveBeenLastCalledWith(
      expect.objectContaining({ selected: 3, settled: 2, unchanged: 0, failed: 1 }),
      'Reconciliation sweep finished',
    );
  });

  it('reports its counts after the work rather than before it', async () => {
    // Fails if the sweep claims a count of reconciled generations before a
    // single row has been settled, which an operator reads as a completed
    // sweep that may not have happened.
    const abandoned = [run('run-a', null)];
    const deps = dependencies({ findAbandoned: jest.fn().mockResolvedValue(abandoned) });

    await reconcilePendingRunsHandler(deps)({}, {} as never);

    const messages = (loggerInfo().mock.calls as unknown[][]).map((call) => String(call[1]));
    expect(messages).toEqual([
      'Pending verification generations selected for reconciliation',
      'Reconciliation sweep finished',
    ]);
    expect(loggerInfo()).toHaveBeenLastCalledWith(
      expect.objectContaining({ selected: 1, settled: 1, unchanged: 0, failed: 0 }),
      'Reconciliation sweep finished',
    );
  });
});

describe('registerPendingRunReconciliation', () => {
  it('registers the worker-only handler on the scheduled queue with one concurrent sweep', () => {
    // Fails if the sweep is registered on the verification queue or can
    // overlap itself. Its presence at worker boot is pinned by the boot
    // order assertion in bootstrap-shutdown.test.ts.
    const queue = { register: jest.fn() };
    registerPendingRunReconciliation(queue as never, defaultReconcilePendingRunsDependencies());

    expect(queue.register).toHaveBeenCalledWith(LIBRARY_RECONCILE_PENDING_RUNS_JOB, expect.any(Function), {
      concurrency: 1,
    });
  });
});

describe('defaultReconcilePendingRunsDependencies', () => {
  it('passes the operator batch size to the repository on each sweep', async () => {
    // The operator owns the per-tick cap (startup.md). Fails if the default
    // dependencies pin a cap or the setting is read anywhere but per tick.
    process.env.LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE = '25';
    mockFindAbandonedPendingCheckRuns.mockResolvedValue([]);
    const cutoff = new Date('2026-09-07T00:00:00Z');
    try {
      await defaultReconcilePendingRunsDependencies().findAbandoned(cutoff);
    } finally {
      delete process.env.LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE;
    }

    expect(mockFindAbandonedPendingCheckRuns).toHaveBeenCalledWith(cutoff, 25);
  });
});
