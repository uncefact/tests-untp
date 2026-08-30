import { readMaxRequestBodyBytes, validateMaxRequestBodyBytesOnBoot } from './request-body-limit.config';

describe('readMaxRequestBodyBytes', () => {
  it('defaults to 5 MiB when the variable is unset or blank', () => {
    expect(readMaxRequestBodyBytes({})).toBe(5_242_880);
    expect(readMaxRequestBodyBytes({ MAX_REQUEST_BODY_BYTES: '   ' })).toBe(5_242_880);
  });

  it('reads a provided integer at or above the minimum', () => {
    expect(readMaxRequestBodyBytes({ MAX_REQUEST_BODY_BYTES: '1024' })).toBe(1024);
    expect(readMaxRequestBodyBytes({ MAX_REQUEST_BODY_BYTES: '10485760' })).toBe(10_485_760);
  });

  it.each([
    ['below the minimum', '1023'],
    ['zero', '0'],
    ['negative', '-5'],
    ['fractional', '2048.5'],
    ['not a number', 'large'],
  ])('rejects a %s value, naming the variable and the default', (_label, value) => {
    expect(() => readMaxRequestBodyBytes({ MAX_REQUEST_BODY_BYTES: value })).toThrow(
      /MAX_REQUEST_BODY_BYTES must be an integer of at least 1024 when set; fix or unset it \(unset uses 5242880\)/,
    );
  });
});

describe('validateMaxRequestBodyBytesOnBoot', () => {
  it('passes when MAX_REQUEST_BODY_BYTES is unset', () => {
    expect(() => validateMaxRequestBodyBytesOnBoot({})).not.toThrow();
  });

  it('fails the boot check for a provided-and-invalid value', () => {
    expect(() => validateMaxRequestBodyBytesOnBoot({ MAX_REQUEST_BODY_BYTES: '100' })).toThrow(
      /MAX_REQUEST_BODY_BYTES/,
    );
  });
});
