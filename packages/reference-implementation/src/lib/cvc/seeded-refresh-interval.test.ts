jest.mock('./refresh-seeded-schemes', () => ({ refreshSeededSchemes: jest.fn() }));

import { refreshSeededSchemes } from './refresh-seeded-schemes';
import { resolveRefreshIntervalHours, startSeededSchemeRefreshInterval } from './seeded-refresh-interval';

const refreshMock = refreshSeededSchemes as jest.Mock;
const ONCE_GUARD = Symbol.for('untp-ri.cvc.seeded-refresh-interval');

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as never;
}

function clearGuard() {
  const state = (globalThis as Record<symbol, { timer?: ReturnType<typeof setTimeout> } | undefined>)[ONCE_GUARD];
  if (state?.timer) clearTimeout(state.timer);
  delete (globalThis as Record<symbol, unknown>)[ONCE_GUARD];
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  refreshMock.mockResolvedValue({ refreshed: 0, unchanged: 0, failed: 0, skipped: 0, criteriaSwept: 0 });
  delete process.env.CVC_REFRESH_INTERVAL_HOURS;
  clearGuard();
});

afterEach(() => {
  clearGuard();
  jest.useRealTimers();
});

describe('resolveRefreshIntervalHours', () => {
  it('defaults to 24 when unset or blank', () => {
    expect(resolveRefreshIntervalHours()).toBe(24);
    process.env.CVC_REFRESH_INTERVAL_HOURS = '  ';
    expect(resolveRefreshIntervalHours()).toBe(24);
  });

  it('accepts a positive number of hours', () => {
    process.env.CVC_REFRESH_INTERVAL_HOURS = '0.5';
    expect(resolveRefreshIntervalHours()).toBe(0.5);
  });

  it('rejects values above the Node-timer-safe maximum', () => {
    process.env.CVC_REFRESH_INTERVAL_HOURS = '720';
    expect(() => resolveRefreshIntervalHours()).toThrow('no greater than 500');
  });

  it.each(['0', '-1', 'daily'])('rejects invalid override %s with a message naming the variable', (value) => {
    process.env.CVC_REFRESH_INTERVAL_HOURS = value;
    expect(() => resolveRefreshIntervalHours()).toThrow('CVC_REFRESH_INTERVAL_HOURS');
  });
});

describe('startSeededSchemeRefreshInterval', () => {
  it('registers once: repeated calls do not stack timers', () => {
    startSeededSchemeRefreshInterval(createLogger());
    startSeededSchemeRefreshInterval(createLogger());

    expect(jest.getTimerCount()).toBe(1);
  });

  it('runs a refresh pass when the interval elapses and reschedules', async () => {
    startSeededSchemeRefreshInterval(createLogger());

    // Jitter is at most ±10%, so advancing 1.2 intervals fires exactly one tick.
    await jest.advanceTimersByTimeAsync(24 * 3_600_000 * 1.2);

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('never overlaps passes: the next tick is scheduled only after the current pass settles', async () => {
    let release: () => void = () => {};
    refreshMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ refreshed: 0, unchanged: 0, failed: 0, skipped: 0, criteriaSwept: 0 });
        }),
    );
    startSeededSchemeRefreshInterval(createLogger());

    await jest.advanceTimersByTimeAsync(24 * 3_600_000 * 1.2); // first tick starts, pass still running
    // With the pass unresolved no timer is pending, so however long the clock
    // advances, no second pass can start.
    await jest.advanceTimersByTimeAsync(24 * 3_600_000 * 3);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    release();
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1); // rescheduled after settling
  });

  it('logs a rejected pass and keeps the interval alive', async () => {
    refreshMock.mockRejectedValue(new Error('db down'));
    const logger = createLogger();
    startSeededSchemeRefreshInterval(logger);

    await jest.advanceTimersByTimeAsync(24 * 3_600_000 * 1.2);

    expect((logger as { error: jest.Mock }).error).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('next tick will retry'),
    );
    expect(jest.getTimerCount()).toBe(1);
  });
});
