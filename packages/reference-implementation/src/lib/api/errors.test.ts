import { ConflictError, PayloadTooLargeError, UnprocessableError } from './errors';

describe('ConflictError', () => {
  it('stores the optional code', () => {
    const error = new ConflictError('still running', 'IDEMPOTENCY_KEY_IN_FLIGHT');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConflictError');
    expect(error.message).toBe('still running');
    expect(error.code).toBe('IDEMPOTENCY_KEY_IN_FLIGHT');
  });

  it('omits code when it is not provided', () => {
    const error = new ConflictError('already exists');

    expect(error.code).toBeUndefined();
  });
});

describe('PayloadTooLargeError', () => {
  it('stores the optional code', () => {
    const error = new PayloadTooLargeError('too big', 'REQUEST_BODY_TOO_LARGE');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PayloadTooLargeError');
    expect(error.message).toBe('too big');
    expect(error.code).toBe('REQUEST_BODY_TOO_LARGE');
  });

  it('omits code when it is not provided', () => {
    const error = new PayloadTooLargeError('too big');

    expect(error.code).toBeUndefined();
  });
});

describe('UnprocessableError', () => {
  it('stores the optional code', () => {
    const error = new UnprocessableError('body differs', 'IDEMPOTENCY_KEY_MISMATCH');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UnprocessableError');
    expect(error.message).toBe('body differs');
    expect(error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
  });

  it('omits code when it is not provided', () => {
    const error = new UnprocessableError('cannot process');

    expect(error.code).toBeUndefined();
  });
});
