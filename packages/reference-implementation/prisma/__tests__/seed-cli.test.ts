/**
 * `seed-cli.ts` runs its whole body at import time (it is the CLI
 * entrypoint), so these tests replace `./seed.js` with a controllable
 * double before importing it, and stub `process.exit` so the test process
 * survives the call. What each test actually checks is ordering: that
 * `prisma.$disconnect()` completes before `process.exit()` runs, on both
 * the success and the failure path, and that the failure path's exit code
 * is non-zero.
 */

async function flushMicrotasks(): Promise<void> {
  // Two hops: one for `main()`'s own promise chain, one for the `.then()`
  // that awaits `prisma.$disconnect()` before calling `process.exit()`.
  // `setTimeout`, not `setImmediate`: this suite runs under a jsdom
  // environment, which does not provide `setImmediate`.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('seed-cli.ts: disconnect always precedes exit', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('on success: disconnects, then exits 0', async () => {
    const callOrder: string[] = [];
    const disconnect = jest.fn(async () => {
      callOrder.push('disconnect');
    });
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => callOrder.push(`exit:${code}`)) as never);

    jest.doMock('../seed', () => ({
      main: jest.fn(async () => undefined),
      prisma: { $disconnect: disconnect },
      logger: { error: jest.fn() },
    }));

    await import('../seed-cli');
    await flushMicrotasks();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledTimes(1);
    // The regression this guards against: `process.exit()` runs inside a
    // `.catch()` that a chained `.finally()` follows, so exit happens
    // first and the disconnect never gets the chance to run at all.
    expect(callOrder).toEqual(['disconnect', 'exit:0']);
  });

  it('on failure: still disconnects, then exits non-zero, and logs the error', async () => {
    const callOrder: string[] = [];
    const disconnect = jest.fn(async () => {
      callOrder.push('disconnect');
    });
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => callOrder.push(`exit:${code}`)) as never);
    const failure = new Error('seed failed for this test');
    const errorLog = jest.fn();

    jest.doMock('../seed', () => ({
      main: jest.fn(async () => {
        throw failure;
      }),
      prisma: { $disconnect: disconnect },
      logger: { error: errorLog },
    }));

    await import('../seed-cli');
    await flushMicrotasks();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['disconnect', 'exit:1']);
    expect(errorLog).toHaveBeenCalledWith({ err: failure }, 'Seed failed');
  });
});
