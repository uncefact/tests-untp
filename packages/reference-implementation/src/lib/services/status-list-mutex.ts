import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma/prisma';
import { appLogger } from '@/lib/api/logger';
import { isPoolWaitError } from '@/lib/prisma/db-errors';
import { readStatusLockAcquireMs } from '@/lib/config/credential-status.config';

const DEFAULT_POLL_MS = 25;
const SETTLEMENT_ALLOWANCE_MS = 1_000;
const CALLBACK_ERROR_UNSET = Symbol('callback error unset');
const logger = appLogger.child({ module: 'status-list-mutex' });

export class StatusListMutexTimeoutError extends Error {
  constructor(key: string, cause?: unknown) {
    super(`Timed out acquiring the status-list mutex for ${key}`, { cause });
    this.name = 'StatusListMutexTimeoutError';
  }
}

export class StatusListMutexBusyError extends Error {
  constructor(key: string, cause: unknown) {
    super(`The status-list coordination service is busy for ${key}`, { cause });
    this.name = 'StatusListMutexBusyError';
  }
}

export class StatusListLockLostError extends Error {
  constructor(
    readonly key: string,
    readonly callbackResult: unknown,
    cause?: unknown,
  ) {
    super(`The status-list mutex lock was lost around the callback for ${key}`, { cause });
    this.name = 'StatusListLockLostError';
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Status-list mutex acquisition was aborted');
}

function assertAvailable(signal: AbortSignal, key: string, acquireDeadline: number, deadlineAt: number): void {
  if (signal.aborted) throw abortError(signal);
  if (Date.now() >= acquireDeadline || Date.now() >= deadlineAt) {
    throw new StatusListMutexTimeoutError(key);
  }
}

function wait(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Holds a transaction-scoped PostgreSQL advisory lock while the callback
 * rewrites one provider-side status list. The shared Prisma client keeps the
 * lock safe through transaction-pooling connections. The trade-off is one
 * application pool slot held for the provider call, bounded by the supplied
 * acquisition and operation deadlines. A repository transaction must not be
 * opened inside the callback because that would require a second pool
 * connection.
 */
export async function withStatusListMutex<T>(
  key: string,
  fn: () => Promise<T>,
  options: { signal: AbortSignal; deadlineAt: number },
): Promise<T> {
  const hash = createHash('sha256').update(key).digest();
  const keyHigh = hash.readInt32BE(0);
  const keyLow = hash.readInt32BE(4);
  const acquireDeadline = Math.min(options.deadlineAt, Date.now() + readStatusLockAcquireMs());
  const maxWait = Math.max(0, acquireDeadline - Date.now());
  const timeout = Math.max(0, options.deadlineAt - Date.now()) + SETTLEMENT_ALLOWANCE_MS;
  let callbackPromise: Promise<T> | undefined;
  let transactionCallbackStarted = false;
  let callbackDispatched = false;
  let callbackResult!: T;
  let callbackSettled = false;
  let callbackError: unknown = CALLBACK_ERROR_UNSET;

  try {
    return await prisma.$transaction(
      async (tx) => {
        transactionCallbackStarted = true;
        for (;;) {
          assertAvailable(options.signal, key, acquireDeadline, options.deadlineAt);
          const compatibilityRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
            SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired
          `;
          if (compatibilityRows[0]?.acquired !== true) {
            const remaining = Math.min(acquireDeadline, options.deadlineAt) - Date.now();
            if (remaining <= 0) throw new StatusListMutexTimeoutError(key);
            await wait(options.signal, Math.min(DEFAULT_POLL_MS, remaining));
            continue;
          }
          const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
            SELECT pg_try_advisory_xact_lock(${keyHigh}::int, ${keyLow}::int) AS acquired
          `;
          if (rows[0]?.acquired === true) break;
          const remaining = Math.min(acquireDeadline, options.deadlineAt) - Date.now();
          if (remaining <= 0) throw new StatusListMutexTimeoutError(key);
          await wait(options.signal, Math.min(DEFAULT_POLL_MS, remaining));
        }

        assertAvailable(options.signal, key, acquireDeadline, options.deadlineAt);
        callbackDispatched = true;
        callbackPromise = Promise.resolve().then(() => {
          try {
            return fn();
          } catch (error) {
            callbackError = error;
            callbackSettled = true;
            throw error;
          }
        });
        try {
          callbackResult = await callbackPromise;
          callbackSettled = true;
          return callbackResult;
        } catch (error) {
          callbackError = error;
          callbackSettled = true;
          throw error;
        }
      },
      { maxWait, timeout },
    );
  } catch (transactionError) {
    if (!callbackPromise) {
      if (!callbackDispatched && isPoolWaitError(transactionError)) {
        throw new StatusListMutexBusyError(key, transactionError);
      }
      if (callbackDispatched || (transactionCallbackStarted && options.signal.aborted)) throw transactionError;
      throw new StatusListMutexTimeoutError(key, transactionError);
    }
    if (!callbackSettled) {
      try {
        callbackResult = await callbackPromise;
        callbackSettled = true;
      } catch (error) {
        callbackError = error;
        callbackSettled = true;
      }
    }
    if (callbackError !== CALLBACK_ERROR_UNSET) {
      logger.warn(
        { err: callbackError, transactionError },
        'Status-list callback failed after its transaction also failed',
      );
      throw callbackError;
    }
    throw new StatusListLockLostError(key, callbackResult, transactionError);
  }
}
