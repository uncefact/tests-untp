import type { LoggerService as Logger } from '@uncefact/untp-ri-services';
import { refreshSeededSchemes } from './refresh-seeded-schemes';
import { resolveRefreshIntervalHours } from '../config/cvc-refresh-interval.config';

export { resolveRefreshIntervalHours } from '../config/cvc-refresh-interval.config';

/** Up to ±10% of the interval, so replicas' ticks spread rather than align (ADR-033 §1). */
const JITTER_RATIO = 0.1;

const ONCE_GUARD = Symbol.for('untp-ri.cvc.seeded-refresh-interval');

interface IntervalState {
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Registers the in-process interval that refreshes seeded conformity schemes
 * (#728). Runs regardless of `CVC_REGISTRY_URL`, so seed-only deployments get
 * a live refresh path; the UNTP discovery trigger (#690) is separate and not
 * registered here.
 *
 * Guards: a `globalThis` symbol keeps re-evaluation of this module (dev
 * reloads, repeated `registerNode` calls) from stacking timers; the next tick
 * is scheduled only after the current pass settles, so a slow pass can never
 * overlap the next one; each tick's promise is caught so a rejection can
 * never become an unhandled rejection. Each delay carries a small random
 * jitter per ADR-033 §1.
 */
export function startSeededSchemeRefreshInterval(logger: Logger): void {
  const globalState = globalThis as typeof globalThis & { [ONCE_GUARD]?: IntervalState };
  if (globalState[ONCE_GUARD]) {
    return;
  }

  const intervalMs = resolveRefreshIntervalHours() * 60 * 60 * 1000;

  const schedule = (): ReturnType<typeof setTimeout> => {
    const jitter = intervalMs * JITTER_RATIO * (Math.random() * 2 - 1);
    const timer = setTimeout(() => {
      const state = globalState[ONCE_GUARD];
      if (!state) return;
      refreshSeededSchemes(logger)
        .then((summary) => {
          logger.info({ ...summary }, 'Seeded conformity scheme refresh pass complete');
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : err },
            'Seeded conformity scheme refresh pass failed; next tick will retry',
          );
        })
        .finally(() => {
          state.timer = schedule();
        });
    }, intervalMs + jitter);
    // Never hold the process open for the timer alone.
    timer.unref?.();
    return timer;
  };

  globalState[ONCE_GUARD] = { timer: schedule() };
  logger.info({ intervalHours: intervalMs / 3_600_000 }, 'Seeded conformity scheme refresh interval registered');
}
