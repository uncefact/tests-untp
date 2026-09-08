import {
  DEFAULT_RECONCILE_PENDING_RUNS_CRON,
  readReconcilePendingRunsBatchSize,
  readReconcilePendingRunsCron,
} from './reconcile-pending-runs.config';

describe('readReconcilePendingRunsCron', () => {
  it('returns the default when LIBRARY_RECONCILE_PENDING_RUNS_CRON is unset or blank', () => {
    expect(readReconcilePendingRunsCron({})).toBe(DEFAULT_RECONCILE_PENDING_RUNS_CRON);
    expect(readReconcilePendingRunsCron({ LIBRARY_RECONCILE_PENDING_RUNS_CRON: '   ' })).toBe('*/10 * * * *');
  });

  // Four and six fields are accepted because the queue's parser accepts them;
  // the reader mirrors that parser rather than judging the shape itself.
  it.each(['*/5 * * * *', '0 * * * *', '15,45 2-6 * * 1-5', ' */30 * * * * ', '0 3 * * MON', '@hourly', '*/10 * * *'])(
    'accepts %j, trimmed, as the queue would',
    (raw) => {
      expect(readReconcilePendingRunsCron({ LIBRARY_RECONCILE_PENDING_RUNS_CRON: raw })).toBe(raw.trim());
    },
  );

  it.each(['every 10 minutes', '10m', '99 * * * *', '0 25 * * *', '* * * * 8', '*/10 * * * * ; drop'])(
    'throws on %j, naming the variable',
    (raw) => {
      expect(() => readReconcilePendingRunsCron({ LIBRARY_RECONCILE_PENDING_RUNS_CRON: raw })).toThrow(
        /LIBRARY_RECONCILE_PENDING_RUNS_CRON/,
      );
    },
  );
});

describe('readReconcilePendingRunsBatchSize', () => {
  it('returns 500 when LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE is unset or blank', () => {
    expect(readReconcilePendingRunsBatchSize({})).toBe(500);
    expect(readReconcilePendingRunsBatchSize({ LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE: ' ' })).toBe(500);
  });

  it('parses a positive integer', () => {
    expect(readReconcilePendingRunsBatchSize({ LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE: '25' })).toBe(25);
  });

  it.each(['0', '-5', '2.5', 'many', '10001'])('throws on %s, naming the variable', (raw) => {
    expect(() => readReconcilePendingRunsBatchSize({ LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE: raw })).toThrow(
      /LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE/,
    );
  });
});
