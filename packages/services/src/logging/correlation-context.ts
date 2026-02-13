import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationContext {
  correlationId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationId(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}

export function setCorrelationId(correlationId: string): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.correlationId = correlationId;
  }
}

export function runWithCorrelationId<T>(correlationId: string, callback: () => T): T {
  return asyncLocalStorage.run({ correlationId }, callback);
}
