import type { LoggerService as Logger } from '@uncefact/untp-ri-services';
import { safeError } from '@/lib/api/safe-error';
import { withTimeout } from '@/worker/shutdown';

/** An operation passes only if its success is first observed within this long of its own start. */
export const READINESS_CHECK_TIMEOUT_MS = 2_000;
/** A completed evaluation is reused for this long after it completes, so a public route costs at most one evaluation a second. */
export const READINESS_REUSE_MS = 1_000;
/** How old an unsettled operation must be, at least, before one replacement may start beside it. */
export const READINESS_REPLACEMENT_AFTER_MS = 10_000;
/** Operations whose query has been sent and has not settled: a stranded one plus at most one replacement. */
export const READINESS_MAX_OUTSTANDING = 2;

export interface ReadinessResult {
  status: 'pass' | 'fail';
}

export interface ReadinessOptions {
  /** One trivial query through the pool under test; rejects when it cannot answer. */
  check: () => Promise<void>;
  /** Receives one warning per failed operation and one line on recovery. The reason never reaches the result. */
  logger: Logger;
  /**
   * Injected for tests; a monotonic clock otherwise. The deadline timer is a
   * real `setTimeout`, so a test that injects this also installs fake timers.
   */
  now?: () => number;
}

export interface Readiness {
  /** Answers whether the check passes now, sharing an evaluation in progress and reusing a recent one. */
  evaluate(): Promise<ReadinessResult>;
}

interface Operation {
  startedAt: number;
  settled: boolean;
  /** Settles with this operation's verdict, at the latest when its deadline passes. Never rejects. */
  verdict: Promise<ReadinessResult['status']>;
}

/**
 * The readiness evaluator behind `GET /api/health/ready`.
 *
 * An evaluation is one answer to "is this instance ready", shared by callers
 * who ask while it runs and reused once complete, failures included. An
 * operation is one call of the check, with a deadline of its own on the
 * monotonic clock: a held event loop can let a late answer beat the timer, so
 * a success first seen after the deadline still fails.
 *
 * Nothing cancels a query that has been sent, so an operation can stay
 * unsettled for as long as its socket stays silent. Evaluations fail at once
 * behind it until it is old enough for one replacement to start beside it.
 */
export function createReadiness(options: ReadinessOptions): Readiness {
  const now = options.now ?? (() => performance.now());
  const { logger } = options;
  let current: Operation | undefined;
  let outstanding = 0;
  let inProgress: Promise<ReadinessResult> | undefined;
  let completed: { result: ReadinessResult; at: number } | undefined;

  const start = (): Operation => {
    // The placeholder verdict is replaced below, before `start` returns.
    const operation: Operation = { startedAt: now(), settled: false, verdict: Promise.resolve('fail') };
    outstanding += 1;
    current = operation;
    const raw = (async () => options.check())();
    const settle = () => {
      operation.settled = true;
      outstanding -= 1;
    };
    void raw.then(settle, settle);
    operation.verdict = withTimeout(raw, READINESS_CHECK_TIMEOUT_MS, 'readiness check').then(
      () => {
        if (now() - operation.startedAt > READINESS_CHECK_TIMEOUT_MS) {
          logger.warn(
            {
              error: safeError(new Error(`readiness check did not finish within ${READINESS_CHECK_TIMEOUT_MS} ms`)),
            },
            'Readiness check failed',
          );
          return 'fail';
        }
        // A replacement starts only once this operation is at least
        // READINESS_REPLACEMENT_AFTER_MS old, well past its deadline, so a
        // success seen within the deadline always belongs to the current one.
        return 'pass';
      },
      (error: unknown) => {
        logger.warn({ error: safeError(error) }, 'Readiness check failed');
        return 'fail';
      },
    );
    return operation;
  };

  /** Picks the operation this evaluation waits on, or none when it must fail at once. */
  const operationFor = (): Operation | undefined => {
    // A settled current leaves at most one other operation outstanding, so
    // starting here cannot exceed READINESS_MAX_OUTSTANDING.
    if (current === undefined || current.settled) return start();
    const age = now() - current.startedAt;
    if (age < READINESS_REPLACEMENT_AFTER_MS || outstanding >= READINESS_MAX_OUTSTANDING) return undefined;
    return start();
  };

  const run = async (): Promise<ReadinessResult> => {
    const operation = operationFor();
    const status = operation === undefined ? 'fail' : await operation.verdict;
    if (status === 'pass' && completed?.result.status === 'fail') {
      logger.info('Readiness checks passing again');
    }
    const result: ReadinessResult = { status };
    completed = { result, at: now() };
    return result;
  };

  return {
    evaluate() {
      if (completed !== undefined && now() - completed.at < READINESS_REUSE_MS) {
        return Promise.resolve(completed.result);
      }
      if (inProgress === undefined) {
        inProgress = run().finally(() => {
          inProgress = undefined;
        });
      }
      return inProgress;
    },
  };
}
