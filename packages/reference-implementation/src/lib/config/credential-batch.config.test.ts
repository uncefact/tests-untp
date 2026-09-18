import {
  DEFAULT_BATCH_EXPIRY_SWEEP_MINUTES,
  DEFAULT_BATCH_RETENTION_DAYS,
  DEFAULT_MAX_BATCH_REQUEST_BODY_BYTES,
  DEFAULT_MAX_BATCH_ITEMS,
  readBatchExpirySweepCron,
  readBatchExpirySweepMinutes,
  readBatchRetentionDays,
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
  });

  it('reads positive integer overrides', () => {
    expect(readMaxBatchItems({ MAX_BATCH_ITEMS: '17' })).toBe(17);
    expect(readMaxBatchRequestBodyBytes({ MAX_BATCH_REQUEST_BODY_BYTES: '10485760' })).toBe(10_485_760);
    expect(readBatchRetentionDays({ BATCH_RETENTION_DAYS: '90' })).toBe(90);
    expect(readBatchExpirySweepMinutes({ BATCH_EXPIRY_SWEEP_MINUTES: '15' })).toBe(15);
    expect(readBatchExpirySweepCron({ BATCH_EXPIRY_SWEEP_MINUTES: '15' })).toBe('*/15 * * * *');
    expect(readBatchExpirySweepCron({ BATCH_EXPIRY_SWEEP_MINUTES: '120' })).toBe('0 */2 * * *');
    expect(() => validateCredentialBatchSettingsOnBoot({ MAX_BATCH_ITEMS: '0' })).toThrow('MAX_BATCH_ITEMS');
    expect(() => validateCredentialBatchSettingsOnBoot({ BATCH_RETENTION_DAYS: '1.5' })).toThrow(
      'BATCH_RETENTION_DAYS',
    );
    expect(() => validateCredentialBatchSettingsOnBoot({ BATCH_EXPIRY_SWEEP_MINUTES: '90' })).toThrow(
      'BATCH_EXPIRY_SWEEP_MINUTES',
    );
    expect(() => readMaxBatchRequestBodyBytes({ MAX_BATCH_REQUEST_BODY_BYTES: '0' })).toThrow(
      'MAX_BATCH_REQUEST_BODY_BYTES',
    );
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
