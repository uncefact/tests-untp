import { DEFAULT_WORKER_JOB_TIMEOUT_SECONDS, readWorkerJobTimeoutSeconds } from './worker-job-timeout.config';

describe('readWorkerJobTimeoutSeconds', () => {
  it('uses the five-minute default when unset or blank', () => {
    expect(readWorkerJobTimeoutSeconds({})).toBe(DEFAULT_WORKER_JOB_TIMEOUT_SECONDS);
    expect(readWorkerJobTimeoutSeconds({ WORKER_JOB_TIMEOUT_SECONDS: ' ' })).toBe(DEFAULT_WORKER_JOB_TIMEOUT_SECONDS);
  });

  it('parses a positive integer number of seconds', () => {
    expect(readWorkerJobTimeoutSeconds({ WORKER_JOB_TIMEOUT_SECONDS: '60' })).toBe(60);
  });

  it.each(['0', '-1', '1.5', 'abc', '86401'])('rejects %s with the variable named', (raw) => {
    expect(() => readWorkerJobTimeoutSeconds({ WORKER_JOB_TIMEOUT_SECONDS: raw })).toThrow(
      /WORKER_JOB_TIMEOUT_SECONDS/,
    );
  });
});
