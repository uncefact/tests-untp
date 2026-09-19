import { readBatchJobConcurrency } from './batch-job-concurrency.config';

describe('readBatchJobConcurrency', () => {
  it('defaults to one parallel batch job', () => {
    // Regression: a missing setting must preserve sequential batch ownership.
    expect(readBatchJobConcurrency({})).toBe(1);
  });

  it('accepts a positive integer', () => {
    // Regression: operators must be able to bound parallel batches explicitly.
    expect(readBatchJobConcurrency({ BATCH_JOB_CONCURRENCY: '3' })).toBe(3);
  });

  it.each(['0', '-1', '1.5', 'many'])('rejects %s', (value) => {
    // Regression: malformed concurrency must fail worker boot instead of silently changing capacity.
    expect(() => readBatchJobConcurrency({ BATCH_JOB_CONCURRENCY: value })).toThrow('BATCH_JOB_CONCURRENCY');
  });
});
