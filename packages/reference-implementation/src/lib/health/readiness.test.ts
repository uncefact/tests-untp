import { createReadiness, type ReadinessResult } from './readiness';

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
  settled: boolean;
}

const deferred = (): Deferred => {
  const entry = { settled: false } as Deferred;
  entry.promise = new Promise<void>((resolve, reject) => {
    entry.resolve = () => {
      entry.settled = true;
      resolve();
    };
    entry.reject = (error) => {
      entry.settled = true;
      reject(error);
    };
  });
  return entry;
};

const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() });
const flush = async () => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};
const PASS: ReadinessResult = { status: 'pass' };
const FAIL: ReadinessResult = { status: 'fail' };

/** Records an evaluation's result once it settles, so a test can assert it is still pending. */
const track = (evaluation: Promise<ReadinessResult>) => {
  const seen: { value?: ReadinessResult } = {};
  void evaluation.then((value) => {
    seen.value = value;
  });
  return seen;
};

describe('createReadiness', () => {
  let clock: number;
  let calls: Deferred[];
  let log: ReturnType<typeof logger>;

  beforeEach(() => {
    clock = 0;
    calls = [];
    log = logger();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const create = () =>
    createReadiness({
      check: () => {
        const call = deferred();
        calls.push(call);
        return call.promise;
      },
      logger: log as never,
      now: () => clock,
    });
  /** Moves the injected clock and Jest's timers together to an absolute time. */
  const at = async (time: number) => {
    const step = time - clock;
    clock = time;
    await jest.advanceTimersByTimeAsync(step);
    await flush();
  };
  const unsettled = () => calls.filter((call) => !call.settled).length;

  /**
   * The original starts at 0 and stays pending; its evaluation fails at
   * 2 000 ms. The only later evaluation, at 10 000 ms, starts the replacement,
   * whose deadline is 12 000 ms.
   */
  const replacementSetup = async () => {
    const readiness = create();
    const first = track(readiness.evaluate());
    await at(2_000);
    expect(first.value).toEqual(FAIL);
    await at(10_000);
    const evaluation = track(readiness.evaluate());
    await flush();
    expect(calls).toHaveLength(2);
    return { readiness, evaluation, original: calls[0], replacement: calls[1] };
  };

  it('passes when the check resolves', async () => {
    const evaluation = track(create().evaluate());
    calls[0].resolve();
    await flush();
    expect(evaluation.value).toEqual(PASS);
  });

  it('fails when the check rejects, so a rejection never reads as a pass', async () => {
    const evaluation = track(create().evaluate());
    calls[0].reject(new Error('connection refused'));
    await flush();
    expect(evaluation.value).toEqual(FAIL);
  });

  it('fails when the check throws synchronously, and frees the slot so the next evaluation calls the check again', async () => {
    let calls = 0;
    const readiness = createReadiness({
      check: () => {
        calls += 1;
        throw new Error('client not ready');
      },
      logger: log as never,
      now: () => clock,
    });
    await expect(readiness.evaluate()).resolves.toEqual(FAIL);
    expect(log.warn).toHaveBeenCalledWith(
      { error: { name: 'Error', message: 'client not ready' } },
      'Readiness check failed',
    );
    await at(1_100);
    await expect(readiness.evaluate()).resolves.toEqual(FAIL);
    expect(calls).toBe(2);
  });

  it('fails at 2 000 ms when the check never settles, so a probe always gets an answer', async () => {
    const evaluation = track(create().evaluate());
    await at(1_999);
    expect(evaluation.value).toBeUndefined();
    await at(2_000);
    expect(evaluation.value).toEqual(FAIL);
  });

  it('holds a caller who joins late to the operation deadline, not its own', async () => {
    const readiness = create();
    const first = track(readiness.evaluate());
    await at(1_900);
    const second = track(readiness.evaluate());
    await at(2_000);
    expect(first.value).toEqual(FAIL);
    expect(second.value).toEqual(FAIL);
    await at(2_500);
    calls[0].resolve();
    await flush();
    expect(calls).toHaveLength(1);
    expect(second.value).toEqual(FAIL);
  });

  it('fails a success first observed after the deadline even before the timer has run', async () => {
    const evaluation = track(create().evaluate());
    clock = 2_400;
    calls[0].resolve();
    await flush();
    expect(evaluation.value).toEqual(FAIL);
    expect(log.warn).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2_400);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('shares an evaluation in progress instead of calling the check again', async () => {
    const readiness = create();
    const first = track(readiness.evaluate());
    const second = track(readiness.evaluate());
    expect(calls).toHaveLength(1);
    calls[0].resolve();
    await flush();
    expect(first.value).toEqual(PASS);
    expect(second.value).toEqual(PASS);
  });

  it('measures reuse from when the evaluation completed, not from when it started', async () => {
    const readiness = create();
    const first = track(readiness.evaluate());
    await at(1_800);
    calls[0].resolve();
    await flush();
    expect(first.value).toEqual(PASS);
    await at(2_700);
    expect(await readiness.evaluate()).toEqual(PASS);
    expect(calls).toHaveLength(1);
    await at(2_900);
    void readiness.evaluate();
    expect(calls).toHaveLength(2);
  });

  it('reuses a failed evaluation for the window, so callers cannot drive a query per request during an outage', async () => {
    const readiness = create();
    const first = track(readiness.evaluate());
    calls[0].reject(new Error('connection refused'));
    await flush();
    expect(first.value).toEqual(FAIL);
    await at(500);
    for (let i = 0; i < 10; i += 1) expect(await readiness.evaluate()).toEqual(FAIL);
    expect(calls).toHaveLength(1);
  });

  it('fails at once without a new call while a timed-out operation is still unsettled', async () => {
    const readiness = create();
    void readiness.evaluate();
    await at(2_000);
    clock = 3_100;
    const evaluation = track(readiness.evaluate());
    await flush();
    expect(evaluation.value).toEqual(FAIL);
    expect(calls).toHaveLength(1);
  });

  it('does not replace an operation younger than 10 000 ms (an evaluation at 9 999 ms calls nothing)', async () => {
    const readiness = create();
    void readiness.evaluate();
    await at(2_000);
    await at(9_999);
    const evaluation = track(readiness.evaluate());
    await flush();
    expect(evaluation.value).toEqual(FAIL);
    expect(calls).toHaveLength(1);
  });

  it("waits on the replacement's verdict, whatever the original does: original resolves at 10 500, replacement never settles, fail at 12 000", async () => {
    const { evaluation, original } = await replacementSetup();
    await at(10_500);
    original.resolve();
    await flush();
    expect(evaluation.value).toBeUndefined();
    await at(12_000);
    expect(evaluation.value).toEqual(FAIL);
  });

  it("waits on the replacement's verdict, whatever the original does: original rejects at 10 500, replacement resolves at 11 000, pass", async () => {
    const { evaluation, original, replacement } = await replacementSetup();
    await at(10_500);
    original.reject(new Error('original late'));
    await flush();
    expect(evaluation.value).toBeUndefined();
    await at(11_000);
    replacement.resolve();
    await flush();
    expect(evaluation.value).toEqual(PASS);
  });

  it('keeps a completed pass when the superseded original rejects inside the reuse window', async () => {
    const { readiness, evaluation, original, replacement } = await replacementSetup();
    await at(11_000);
    replacement.resolve();
    await flush();
    expect(evaluation.value).toEqual(PASS);
    await at(11_200);
    original.reject(new Error('original late'));
    await flush();
    await at(11_500);
    expect(await readiness.evaluate()).toEqual(PASS);
    expect(calls).toHaveLength(2);
  });

  it('starts one new call after a failed replacement beside a stranded original, and none while that one is pending', async () => {
    const { readiness, evaluation, replacement } = await replacementSetup();
    await at(10_200);
    replacement.reject(new Error('replacement refused'));
    await flush();
    expect(evaluation.value).toEqual(FAIL);
    await at(11_300);
    void readiness.evaluate();
    expect(calls).toHaveLength(3);
    await at(13_300);
    await at(21_300);
    // The third call is 10 000 ms old, but two are outstanding.
    expect(await readiness.evaluate()).toEqual(FAIL);
    expect(calls).toHaveLength(3);
  });

  it('starts a new call beside a stranded original once the replacement has passed', async () => {
    const { readiness, evaluation, replacement } = await replacementSetup();
    await at(11_000);
    replacement.resolve();
    await flush();
    expect(evaluation.value).toEqual(PASS);
    await at(12_100);
    const next = track(readiness.evaluate());
    expect(calls).toHaveLength(3);
    calls[2].resolve();
    await flush();
    expect(next.value).toEqual(PASS);
    expect(unsettled()).toBe(1);
  });

  it('replaces a replacement that outlives its original, and never runs a third beside two pending', async () => {
    const { readiness, evaluation, original } = await replacementSetup();
    await at(10_500);
    original.reject(new Error('original late'));
    await flush();
    await at(12_000);
    expect(evaluation.value).toEqual(FAIL);
    await at(20_000);
    void readiness.evaluate();
    expect(calls).toHaveLength(3);
    await at(22_000);
    await at(30_000);
    expect(await readiness.evaluate()).toEqual(FAIL);
    expect(calls).toHaveLength(3);
  });

  it('logs a failure once with the reduced error, keeps the reason out of the result, and logs recovery once', async () => {
    const readiness = create();
    const first = track(readiness.evaluate());
    const secret = new Error('connect ECONNREFUSED 10.0.0.5:5432', { cause: new Error('key material') });
    calls[0].reject(secret);
    await flush();
    expect(first.value).toEqual(FAIL);
    expect(Object.keys(first.value ?? {})).toEqual(['status']);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { error: { name: 'Error', message: 'connect ECONNREFUSED 10.0.0.5:5432' } },
      'Readiness check failed',
    );

    // A failed result reused inside the window writes nothing.
    await at(500);
    await readiness.evaluate();
    expect(log.warn).toHaveBeenCalledTimes(1);

    await at(1_100);
    const second = track(readiness.evaluate());
    calls[1].resolve();
    await flush();
    expect(second.value).toEqual(PASS);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith('Readiness checks passing again');

    await at(2_200);
    void readiness.evaluate();
    calls[2].resolve();
    await flush();
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rejects', (call: Deferred) => call.reject(new Error('pool timed out'))],
    ['resolves', (call: Deferred) => call.resolve()],
  ])('logs a timed-out operation once even when its raw call later %s', async (_, settle) => {
    const readiness = create();
    void readiness.evaluate();
    await at(2_000);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { error: { name: 'Error', message: 'readiness check did not finish within 2000 ms' } },
      'Readiness check failed',
    );
    await at(3_000);
    settle(calls[0]);
    await flush();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
