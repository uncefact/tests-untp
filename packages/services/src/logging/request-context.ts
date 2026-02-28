import { AsyncLocalStorage } from 'async_hooks';

const asyncLocalStorage = new AsyncLocalStorage<Record<string, unknown>>();

/**
 * Returns the current request context, or undefined if called outside a context.
 * The generic type parameter narrows the return type at the call site but performs
 * no runtime validation — actual contents depend on what has been set via
 * updateRequestContext().
 */
export function getRequestContext<T extends Record<string, unknown> = Record<string, unknown>>():
  | (T & { correlationId: string })
  | undefined {
  return asyncLocalStorage.getStore() as (T & { correlationId: string }) | undefined;
}

/**
 * Merges the provided partial into the current request context.
 * No-op if called outside a context (does not throw).
 */
export function updateRequestContext<T extends Record<string, unknown> = Record<string, unknown>>(
  partial: Partial<T>,
): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    Object.assign(store, partial);
  }
}

/**
 * Runs the callback within a new request context.
 * The correlationId is required; additional fields can be set progressively
 * via updateRequestContext().
 */
export function runWithRequestContext<R>(correlationId: string, callback: () => R): R {
  return asyncLocalStorage.run({ correlationId }, callback);
}
