import type { LoggerService as Logger } from '@uncefact/untp-ri-services';

/** How long active jobs get to finish before the queue fails them for retry. */
export const DRAIN_TIMEOUT_MS = 30_000;
/**
 * The whole shutdown (drain, release, Prisma, telemetry) must finish inside
 * this. The operator documentation asks for a container grace period of
 * 60 s, above this deadline, so the process can always exit on its own terms
 * before the runtime kills it; those two numbers move together.
 */
export const PROCESS_DEADLINE_MS = 45_000;
/** Flushing telemetry to a collector that is absent or unreachable must not hold the process past this. */
export const TELEMETRY_SHUTDOWN_TIMEOUT_MS = 5_000;

/** Rejects with a named error when `promise` has not settled within `ms`; the underlying work is not cancelled. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export interface ShutdownStep {
  name: string;
  run: () => Promise<void>;
  /**
   * A failure of this step is logged and does not change the exit code.
   * The telemetry flush is the case: a deployment with no collector (the
   * default compose stack outside its observability profile) would otherwise
   * report every clean stop as a failure, and a lost span batch is not a
   * data outcome. The queue drain and the database disconnect stay critical.
   */
  nonCritical?: boolean;
}

export interface ShutdownOptions {
  steps: ShutdownStep[];
  logger: Logger;
  deadlineMs?: number;
  /** Injected for tests; `process.exit` otherwise. */
  exit?: (code: number) => void;
  /** Injected for tests; `process` otherwise. */
  signals?: SignalSource;
}

export interface SignalSource {
  on(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/**
 * Wires SIGTERM and SIGINT to one bounded, ordered shutdown. Every step runs
 * even when an earlier one rejects (a failed queue drain must not skip the
 * Prisma disconnect), each failure is logged, and the exit code is 0 only
 * when every critical step succeeded inside the deadline. A second signal during
 * shutdown exits 1 at once. Returns the runner so a caller can invoke it
 * without a signal.
 */
export function installShutdown(options: ShutdownOptions): () => Promise<void> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const signals = options.signals ?? process;
  const deadlineMs = options.deadlineMs ?? PROCESS_DEADLINE_MS;
  let running: Promise<void> | undefined;

  let inFlight: string | undefined;
  const runSteps = async (): Promise<'ok' | 'failed'> => {
    let outcome: 'ok' | 'failed' = 'ok';
    for (const step of options.steps) {
      inFlight = step.name;
      try {
        await step.run();
        options.logger.info({ step: step.name }, 'Shutdown step completed');
      } catch (error) {
        if (step.nonCritical) {
          options.logger.warn(
            { err: error, step: step.name },
            'Shutdown step failed; not counted against the exit code',
          );
        } else {
          outcome = 'failed';
          options.logger.error({ err: error, step: step.name }, 'Shutdown step failed; continuing with the rest');
        }
      }
    }
    return outcome;
  };

  const shutdown = async (): Promise<void> => {
    if (running !== undefined) {
      options.logger.warn('Second signal during shutdown; exiting now');
      exit(1);
      return;
    }
    running = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<'deadline'>((resolve) => {
        timer = setTimeout(() => resolve('deadline'), deadlineMs);
      });
      const outcome = await Promise.race([runSteps(), deadline]);
      if (timer !== undefined) clearTimeout(timer);
      if (outcome === 'ok') {
        options.logger.info('Worker stopped');
        exit(0);
      } else if (outcome === 'deadline') {
        options.logger.error({ deadlineMs, step: inFlight }, 'Shutdown exceeded its deadline; exiting');
        exit(1);
      } else {
        exit(1);
      }
    })();
    await running;
  };

  signals.on('SIGTERM', () => void shutdown());
  signals.on('SIGINT', () => void shutdown());
  return shutdown;
}
