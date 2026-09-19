import {
  DEFAULT_BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS,
  DEFAULT_BATCH_JOB_RETRY_BACKOFF_SECONDS,
  DEFAULT_BATCH_JOB_RETRY_LIMIT,
  DEFAULT_BATCH_MINIMUM_ITEM_COST_MS,
  DEFAULT_BATCH_SETTLEMENT_ALLOWANCE_MS,
  DEFAULT_BATCH_EXPIRY_SWEEP_MINUTES,
  DEFAULT_BATCH_RETENTION_DAYS,
  DEFAULT_MAX_BATCH_REQUEST_BODY_BYTES,
  DEFAULT_MAX_BATCH_ITEMS,
  credentialBatchItemAttemptLimit,
  credentialBatchItemBackoffSeconds,
  readBatchBudgetSettings,
  readBatchExpirySweepCron,
  readBatchExpirySweepMinutes,
  readBatchMinimumItemCostMs,
  readBatchRetentionDays,
  readBatchSettlementAllowanceMs,
  readCredentialBatchIssueEnqueueOptions,
  readMaxBatchRequestBodyBytes,
  readMaxBatchItems,
  validateCredentialBatchRequestBodySettingsOnWebBoot,
  validateCredentialBatchSettingsOnBoot,
} from './credential-batch.config';

describe('credential batch settings', () => {
  it('uses the documented defaults', () => {
    expect(readMaxBatchItems({})).toBe(DEFAULT_MAX_BATCH_ITEMS);
    expect(readMaxBatchRequestBodyBytes({})).toBe(DEFAULT_MAX_BATCH_REQUEST_BODY_BYTES);
    expect(readBatchRetentionDays({})).toBe(DEFAULT_BATCH_RETENTION_DAYS);
    expect(readBatchExpirySweepMinutes({})).toBe(DEFAULT_BATCH_EXPIRY_SWEEP_MINUTES);
    expect(readBatchExpirySweepCron({})).toBe('0 * * * *');
    expect(readBatchSettlementAllowanceMs({})).toBe(DEFAULT_BATCH_SETTLEMENT_ALLOWANCE_MS);
    expect(readBatchMinimumItemCostMs({})).toBe(DEFAULT_BATCH_MINIMUM_ITEM_COST_MS);
    expect(readCredentialBatchIssueEnqueueOptions({})).toEqual({
      retry: {
        limit: DEFAULT_BATCH_JOB_RETRY_LIMIT,
        backoffSeconds: DEFAULT_BATCH_JOB_RETRY_BACKOFF_SECONDS,
        backoffMaxSeconds: DEFAULT_BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS,
      },
    });
  });

  it('owns the shared queue and item retry policy', () => {
    const options = {
      retry: { limit: 3, backoffSeconds: 10, backoffMaxSeconds: 25 },
    };

    expect(credentialBatchItemAttemptLimit(options)).toBe(3);
    expect(credentialBatchItemBackoffSeconds(1, options)).toBe(10);
    expect(credentialBatchItemBackoffSeconds(3, options)).toBe(25);
  });

  it('reads positive integer overrides', () => {
    expect(readMaxBatchItems({ MAX_BATCH_ITEMS: '17' })).toBe(17);
    expect(readMaxBatchRequestBodyBytes({ MAX_BATCH_REQUEST_BODY_BYTES: '10485760' })).toBe(10_485_760);
    expect(readBatchRetentionDays({ BATCH_RETENTION_DAYS: '90' })).toBe(90);
    expect(readBatchExpirySweepMinutes({ BATCH_EXPIRY_SWEEP_MINUTES: '15' })).toBe(15);
    expect(readBatchExpirySweepCron({ BATCH_EXPIRY_SWEEP_MINUTES: '15' })).toBe('*/15 * * * *');
    expect(readBatchExpirySweepCron({ BATCH_EXPIRY_SWEEP_MINUTES: '120' })).toBe('0 */2 * * *');
    expect(readBatchSettlementAllowanceMs({ BATCH_SETTLEMENT_ALLOWANCE_MS: '6000' })).toBe(6000);
    expect(readBatchMinimumItemCostMs({ BATCH_MINIMUM_ITEM_COST_MS: '2500' })).toBe(2500);
    expect(
      readCredentialBatchIssueEnqueueOptions({
        BATCH_JOB_RETRY_LIMIT: '2',
        BATCH_JOB_RETRY_BACKOFF_SECONDS: '10',
        BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS: '25',
      }),
    ).toEqual({ retry: { limit: 2, backoffSeconds: 10, backoffMaxSeconds: 25 } });
    expect(() => validateCredentialBatchSettingsOnBoot({ MAX_BATCH_ITEMS: '0' })).toThrow('MAX_BATCH_ITEMS');
    expect(() =>
      validateCredentialBatchSettingsOnBoot({
        BATCH_RETENTION_DAYS: '1.5',
        BATCH_EXPIRY_SWEEP_MINUTES: '90',
      }),
    ).not.toThrow();
    expect(() => readMaxBatchRequestBodyBytes({ MAX_BATCH_REQUEST_BODY_BYTES: '0' })).toThrow(
      'MAX_BATCH_REQUEST_BODY_BYTES',
    );
  });

  it.each([
    ['BATCH_SETTLEMENT_ALLOWANCE_MS', 'abc'],
    ['BATCH_MINIMUM_ITEM_COST_MS', 'abc'],
    ['BATCH_SETTLEMENT_ALLOWANCE_MS', '0'],
    ['BATCH_MINIMUM_ITEM_COST_MS', '0'],
  ])('rejects an invalid budget setting %s=%s', (name, value) => {
    // Regression: malformed or non-positive budget values must fail before the worker can run with a hidden default.
    expect(() => readBatchBudgetSettings({ [name]: value })).toThrow(
      `${name} must be a positive integer when set; fix or unset it`,
    );
  });

  it.each([
    ['BATCH_JOB_RETRY_LIMIT', '0'],
    ['BATCH_JOB_RETRY_LIMIT', 'not-an-integer'],
    ['BATCH_JOB_RETRY_BACKOFF_SECONDS', 'not-an-integer'],
    ['BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS', 'not-an-integer'],
  ])('rejects an invalid retry setting %s=%s', (name, value) => {
    // Regression: malformed retry values, including a zero job limit, must not silently restore the queue defaults.
    expect(() => readCredentialBatchIssueEnqueueOptions({ [name]: value })).toThrow(
      `${name} must be a positive integer when set; fix or unset it`,
    );
  });

  it.each([
    ['BATCH_JOB_RETRY_LIMIT', DEFAULT_BATCH_JOB_RETRY_LIMIT],
    ['BATCH_JOB_RETRY_BACKOFF_SECONDS', DEFAULT_BATCH_JOB_RETRY_BACKOFF_SECONDS],
    ['BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS', DEFAULT_BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS],
  ])('refuses a queue retry setting above the PostgreSQL integer bound: %s', (name, fallback) => {
    // Regression: a retry option above PostgreSQL integer range must fail at boot instead of failing when enqueued.
    expect(() => readCredentialBatchIssueEnqueueOptions({ [name]: '2147483648' })).toThrow(
      `${name} must be a positive integer no greater than 2147483647 when set; fix or unset it (unset uses ${fallback}).`,
    );
  });

  it('accepts the PostgreSQL integer maximum for every queue retry setting', () => {
    expect(
      readCredentialBatchIssueEnqueueOptions({
        BATCH_JOB_RETRY_LIMIT: '2147483647',
        BATCH_JOB_RETRY_BACKOFF_SECONDS: '2147483647',
        BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS: '2147483647',
      }),
    ).toEqual({ retry: { limit: 2147483647, backoffSeconds: 2147483647, backoffMaxSeconds: 2147483647 } });
  });

  it('refuses an unsafe integer for a non-retry setting', () => {
    // Regression: Number rounding must not turn an unsafe environment value into an accepted setting.
    expect(() => readMaxBatchItems({ MAX_BATCH_ITEMS: '9007199254740993' })).toThrow(
      'MAX_BATCH_ITEMS must be a positive integer when set; fix or unset it (unset uses 500).',
    );
  });

  it('refuses a retry maximum below its base backoff', () => {
    // Regression: the reader must never produce queue options that pg-boss rejects for an invalid backoff ladder.
    expect(() =>
      readCredentialBatchIssueEnqueueOptions({
        BATCH_JOB_RETRY_BACKOFF_SECONDS: '30',
        BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS: '10',
      }),
    ).toThrow(
      'BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS must be at least BATCH_JOB_RETRY_BACKOFF_SECONDS (30) when set; fix or unset it (unset uses 600).',
    );
  });

  it('refuses an allowance that leaves no minimum item budget', () => {
    // Regression: an allowance leaving only one minimum item cost makes every job attempt a single item and re-enqueue.
    expect(() =>
      readBatchSettlementAllowanceMs({
        WORKER_JOB_TIMEOUT_SECONDS: '30',
        BATCH_MINIMUM_ITEM_COST_MS: '2000',
        BATCH_SETTLEMENT_ALLOWANCE_MS: '29000',
      }),
    ).toThrow(
      'BATCH_SETTLEMENT_ALLOWANCE_MS must be less than WORKER_JOB_TIMEOUT_SECONDS * 1000 - BATCH_MINIMUM_ITEM_COST_MS (30 * 1000 - 2000 = 28000) when set; the allowance must leave more than one minimum item cost inside the job timeout, otherwise every job attempts a single item and re-enqueues.',
    );
  });

  it('accepts an allowance below the available item budget', () => {
    // Regression: a valid allowance must remain usable when the timeout and minimum item cost are configured together.
    expect(
      readBatchBudgetSettings({
        WORKER_JOB_TIMEOUT_SECONDS: '30',
        BATCH_MINIMUM_ITEM_COST_MS: '2000',
        BATCH_SETTLEMENT_ALLOWANCE_MS: '27999',
      }),
    ).toEqual({ settlementAllowanceMs: 27999, minimumItemCostMs: 2000 });
  });

  it('refuses a batch body bound below the single-request bound at web boot', () => {
    expect(() =>
      validateCredentialBatchRequestBodySettingsOnWebBoot({
        MAX_REQUEST_BODY_BYTES: '2048',
        MAX_BATCH_REQUEST_BODY_BYTES: '1024',
      }),
    ).toThrow('MAX_BATCH_REQUEST_BODY_BYTES must be at least MAX_REQUEST_BODY_BYTES (2048)');
  });
});
