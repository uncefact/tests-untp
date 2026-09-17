const mockTransaction = jest.fn();
const mockQueryRaw = jest.fn();

jest.mock('@/lib/prisma/prisma', () => ({
  prisma: { $transaction: mockTransaction },
}));

import { EventEmitter, getEventListeners } from 'node:events';
import {
  StatusListLockLostError,
  StatusListMutexBusyError,
  StatusListMutexTimeoutError,
  withStatusListMutex,
} from './status-list-mutex';

const tx = { $queryRaw: mockQueryRaw };

describe('withStatusListMutex', () => {
  beforeEach(() => {
    mockTransaction.mockReset();
    mockQueryRaw.mockReset();
    jest.clearAllMocks();
    mockTransaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    process.env.STATUS_LOCK_ACQUIRE_MS = '40';
  });

  afterEach(() => {
    delete process.env.STATUS_LOCK_ACQUIRE_MS;
    jest.restoreAllMocks();
  });

  it('polls the transaction lock and runs the callback once it is acquired', async () => {
    // Catches a regression that polls outside the transaction or dispatches the callback more than once.
    mockQueryRaw.mockResolvedValueOnce([{ acquired: false }]).mockResolvedValueOnce([{ acquired: true }]);
    const callback = jest.fn().mockResolvedValue('minted');
    const signal = new AbortController().signal;

    await expect(
      withStatusListMutex('status-list:origin:issuer', callback, { signal, deadlineAt: Date.now() + 1_000 }),
    ).resolves.toBe('minted');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), expect.any(Object));
  });

  it('fails on acquisition expiry before calling the callback', async () => {
    // Catches a regression that invokes the provider after the lock budget expires.
    mockQueryRaw.mockResolvedValue([{ acquired: false }]);
    const callback = jest.fn();

    await expect(
      withStatusListMutex('status-list:origin:busy', callback, {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 100,
      }),
    ).rejects.toBeInstanceOf(StatusListMutexTimeoutError);

    expect(callback).not.toHaveBeenCalled();
  });

  it('preserves a callback error unchanged', async () => {
    // Catches a regression that replaces a provider failure with a mutex timeout.
    mockQueryRaw.mockResolvedValueOnce([{ acquired: true }]);
    const callbackError = new Error('credential status update failed');

    await expect(
      withStatusListMutex('status-list:origin:issuer', jest.fn().mockRejectedValue(callbackError), {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toBe(callbackError);
  });

  it('maps a pool maxWait rejection before callback dispatch to service busy and preserves its cause', async () => {
    // Catches a regression that labels unavailable database capacity as lock contention or discards the pool error.
    const transactionError = Object.assign(new Error('Timed out fetching a new connection from the connection pool'), {
      code: 'P2024',
    });
    mockTransaction.mockRejectedValueOnce(transactionError);
    const callback = jest.fn();

    await expect(
      withStatusListMutex('status-list:origin:pool', callback, {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      constructor: StatusListMutexBusyError,
      cause: transactionError,
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('preserves a pre-dispatch transaction failure as the timeout cause', async () => {
    // Catches a regression that discards the database failure when it is translated to an acquisition timeout.
    const transactionError = new Error('transaction acquisition failed');
    mockTransaction.mockRejectedValueOnce(transactionError);

    await expect(
      withStatusListMutex('status-list:origin:timeout', jest.fn(), {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      constructor: StatusListMutexTimeoutError,
      cause: transactionError,
    });
  });

  it('reports lock loss after a fulfilled callback instead of returning the provider outcome', async () => {
    // Catches a regression that issues successfully after the lock transaction ended before the mint settled.
    mockQueryRaw.mockResolvedValueOnce([{ acquired: true }]);
    const transactionError = new Error('transaction completion failed');
    mockTransaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      await callback(tx);
      throw transactionError;
    });

    await expect(
      withStatusListMutex('status-list:origin:issuer', jest.fn().mockResolvedValue('minted'), {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      constructor: StatusListLockLostError,
      callbackResult: 'minted',
      cause: transactionError,
    });
  });

  it('lets a callback rejection win when the lock is lost after dispatch', async () => {
    // Catches a regression that hides the provider callback failure behind the transaction completion error.
    mockQueryRaw.mockResolvedValueOnce([{ acquired: true }]);
    const callbackError = new Error('provider mint failed');
    const transactionError = new Error('transaction completion failed');
    mockTransaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      await callback(tx);
      throw transactionError;
    });

    await expect(
      withStatusListMutex('status-list:origin:issuer', jest.fn().mockRejectedValue(callbackError), {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toBe(callbackError);
  });

  it('lets a synchronously thrown callback error win when the transaction also rejects', async () => {
    // Catches a regression that reports the transaction failure instead of a callback failure thrown at dispatch.
    mockQueryRaw.mockResolvedValueOnce([{ acquired: true }]);
    const callbackError = new Error('provider mint failed synchronously');
    const transactionError = new Error('transaction completion failed');
    mockTransaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const transactionCallback = callback(tx);
      transactionCallback.catch(() => undefined);
      await Promise.resolve();
      throw transactionError;
    });

    await expect(
      withStatusListMutex(
        'status-list:origin:issuer',
        jest.fn(() => {
          throw callbackError;
        }),
        {
          signal: new AbortController().signal,
          deadlineAt: Date.now() + 1_000,
        },
      ),
    ).rejects.toBe(callbackError);
  });

  it('checks the operation deadline immediately before dispatching the callback', async () => {
    // Catches a regression that starts the provider call after its operation deadline.
    mockQueryRaw.mockResolvedValueOnce([{ acquired: true }]);
    const callback = jest.fn();
    const deadlineAt = Date.now() + 1;
    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(
      withStatusListMutex('status-list:origin:expired', callback, {
        signal: new AbortController().signal,
        deadlineAt,
      }),
    ).rejects.toBeInstanceOf(StatusListMutexTimeoutError);
    expect(callback).not.toHaveBeenCalled();
  });

  it('derives maxWait from the acquisition deadline and timeout from the operation deadline', async () => {
    // Catches a regression that lets pool waiting or transaction settlement exceed the stated deadlines.
    mockQueryRaw.mockResolvedValueOnce([{ acquired: true }]);
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    const now = Date.now();

    await withStatusListMutex('status-list:origin:issuer', jest.fn().mockResolvedValue(undefined), {
      signal: new AbortController().signal,
      deadlineAt: now + 500,
    });

    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 40, timeout: 1_500 });
  });

  it('removes the acquisition abort listener when a polling timer fires', async () => {
    // Catches a regression that accumulates abort listeners on every timed-out lock acquisition.
    mockQueryRaw.mockResolvedValue([{ acquired: false }]);
    const signal = new EventEmitter();
    Object.assign(signal, {
      aborted: false,
      reason: undefined,
      addEventListener: (type: string, listener: (...args: unknown[]) => void) => signal.on(type, listener),
      removeEventListener: (type: string, listener: (...args: unknown[]) => void) => signal.off(type, listener),
    });

    await expect(
      withStatusListMutex('status-list:origin:listener', jest.fn(), {
        signal: signal as unknown as AbortSignal,
        deadlineAt: Date.now() + 100,
      }),
    ).rejects.toBeInstanceOf(StatusListMutexTimeoutError);

    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  });
});
