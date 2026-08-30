import { readStaleClaimMs, validateStaleClaimOnBoot } from './idempotency-claim.config';

describe('readStaleClaimMs', () => {
  it('defaults to ten minutes when the variable is unset or blank', () => {
    expect(readStaleClaimMs({})).toBe(10 * 60_000);
    expect(readStaleClaimMs({ IDEMPOTENCY_STALE_CLAIM_MINUTES: '   ' })).toBe(10 * 60_000);
  });

  it('reads a provided window in minutes', () => {
    expect(readStaleClaimMs({ IDEMPOTENCY_STALE_CLAIM_MINUTES: '25' })).toBe(25 * 60_000);
    expect(readStaleClaimMs({ IDEMPOTENCY_STALE_CLAIM_MINUTES: '1' })).toBe(60_000);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-5'],
    ['fractional', '2.5'],
    ['not a number', 'ten'],
  ])('rejects a %s value, naming the variable and the default', (_label, value) => {
    // A window below a minute would take a key from a request that is merely
    // slow, which is how a duplicate credential gets issued.
    expect(() => readStaleClaimMs({ IDEMPOTENCY_STALE_CLAIM_MINUTES: value })).toThrow(
      /IDEMPOTENCY_STALE_CLAIM_MINUTES must be an integer of at least 1 when set/,
    );
  });

  it('fails the boot check for a provided-and-invalid value', () => {
    expect(() => validateStaleClaimOnBoot({ IDEMPOTENCY_STALE_CLAIM_MINUTES: '0' })).toThrow();
    expect(() => validateStaleClaimOnBoot({})).not.toThrow();
  });
});
