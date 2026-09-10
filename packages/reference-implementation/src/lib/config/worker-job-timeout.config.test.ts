jest.mock('pg-boss', () => ({ PgBoss: class PgBoss {} }));

import {
  DEFAULT_WORKER_JOB_TIMEOUT_SECONDS,
  MIN_WORKER_JOB_TIMEOUT_SECONDS,
  readWorkerJobTimeoutSeconds,
} from './worker-job-timeout.config';
import { MAX_JOB_EXPIRE_SECONDS } from '../jobs/job-expiry';

describe('readWorkerJobTimeoutSeconds', () => {
  it('uses the five-minute default when unset or blank', () => {
    expect(readWorkerJobTimeoutSeconds({})).toBe(DEFAULT_WORKER_JOB_TIMEOUT_SECONDS);
    expect(readWorkerJobTimeoutSeconds({ WORKER_JOB_TIMEOUT_SECONDS: ' ' })).toBe(DEFAULT_WORKER_JOB_TIMEOUT_SECONDS);
  });

  it('parses a positive integer number of seconds', () => {
    expect(readWorkerJobTimeoutSeconds({ WORKER_JOB_TIMEOUT_SECONDS: '60' })).toBe(60);
  });

  it('accepts the configured bounds', () => {
    expect(readWorkerJobTimeoutSeconds({ WORKER_JOB_TIMEOUT_SECONDS: String(MIN_WORKER_JOB_TIMEOUT_SECONDS) })).toBe(
      MIN_WORKER_JOB_TIMEOUT_SECONDS,
    );
    expect(readWorkerJobTimeoutSeconds({ WORKER_JOB_TIMEOUT_SECONDS: String(MAX_JOB_EXPIRE_SECONDS) })).toBe(
      MAX_JOB_EXPIRE_SECONDS,
    );
  });

  it.each(['0', '-1', '29', '30.5', 'abc', '86401'])('rejects %s and names both bounds', (raw) => {
    expect(() => readWorkerJobTimeoutSeconds({ WORKER_JOB_TIMEOUT_SECONDS: raw })).toThrow(
      new RegExp(`WORKER_JOB_TIMEOUT_SECONDS.*${MIN_WORKER_JOB_TIMEOUT_SECONDS}.*${MAX_JOB_EXPIRE_SECONDS}`),
    );
  });
});
