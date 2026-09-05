/**
 * A worker boot check that failed. The code is stable for operators and
 * tests; the message names the setting or migration involved.
 */
export class WorkerBootError extends Error {
  constructor(
    readonly code: 'worker.encryption-key-missing' | 'worker.schema-not-ready' | 'worker.migrations-unreadable',
    message: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'WorkerBootError';
  }
}
