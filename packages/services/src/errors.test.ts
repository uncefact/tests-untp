import { ServiceError } from './errors.js';

describe('ServiceError', () => {
  it('sets message, code, statusCode, and name', () => {
    const err = new ServiceError('something broke', 'TEST_ERROR', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('something broke');
    expect(err.code).toBe('TEST_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('ServiceError');
  });

  it('includes optional context', () => {
    const err = new ServiceError('fail', 'X', 400, { foo: 'bar' });
    expect(err.context).toEqual({ foo: 'bar' });
  });

  it('retains an optional cause as a non-enumerable native error property', () => {
    const cause = new Error('underlying failure');
    const err = new ServiceError('fail', 'X', 500, undefined, cause);
    expect(err.cause).toBe(cause);
    expect(Object.keys(err)).not.toContain('cause');
  });

  it('uses subclass name when extended', () => {
    class ChildError extends ServiceError {
      constructor() {
        super('child', 'CHILD', 422);
      }
    }
    const err = new ChildError();
    expect(err.name).toBe('ChildError');
    expect(err).toBeInstanceOf(ServiceError);
    expect(err).toBeInstanceOf(Error);
  });
});
