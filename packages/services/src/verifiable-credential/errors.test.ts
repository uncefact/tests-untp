import { ServiceError } from '../errors.js';
import {
  VcServiceError,
  VcSignError,
  VcVerifyError,
  VcDecodeError,
  VcCredentialStatusError,
  VcStatusReadError,
  VcStatusSetError,
  VcStatusResponseInvalidError,
  VcStatusListNotFoundError,
  VcStatusEntryUnsupportedError,
} from './errors.js';

describe('VC errors', () => {
  describe('VcServiceError', () => {
    it('extends ServiceError', () => {
      const err = new VcServiceError('test', 'VC_TEST', 500);
      expect(err).toBeInstanceOf(ServiceError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('VcServiceError');
    });
  });

  describe('VcSignError', () => {
    it('constructs message from detail and httpStatus', () => {
      const err = new VcSignError('upstream timeout', 504);
      expect(err.message).toBe('Failed to sign credential: upstream timeout');
      expect(err.code).toBe('VC_SIGN_FAILED');
      expect(err.statusCode).toBe(504);
      expect(err.context).toEqual({ httpStatus: 504 });
      expect(err.name).toBe('VcSignError');
      expect(err).toBeInstanceOf(VcServiceError);
      expect(err).toBeInstanceOf(ServiceError);
    });

    it('defaults httpStatus to 502', () => {
      const err = new VcSignError('network failure');
      expect(err.statusCode).toBe(502);
      expect(err.context).toEqual({ httpStatus: undefined });
    });
  });

  describe('VcVerifyError', () => {
    it('constructs message from detail and httpStatus', () => {
      const err = new VcVerifyError('invalid signature', 400);
      expect(err.message).toBe('Failed to verify credential: invalid signature');
      expect(err.code).toBe('VC_VERIFY_FAILED');
      expect(err.statusCode).toBe(400);
      expect(err.context).toEqual({ httpStatus: 400 });
      expect(err.name).toBe('VcVerifyError');
      expect(err).toBeInstanceOf(VcServiceError);
      expect(err).toBeInstanceOf(ServiceError);
    });

    it('defaults httpStatus to 502', () => {
      const err = new VcVerifyError('network failure');
      expect(err.statusCode).toBe(502);
      expect(err.context).toEqual({ httpStatus: undefined });
    });
  });

  describe('VcDecodeError', () => {
    it('constructs message from detail', () => {
      const err = new VcDecodeError('malformed JWT');
      expect(err.message).toBe('Failed to decode credential: malformed JWT');
      expect(err.code).toBe('VC_DECODE_FAILED');
      expect(err.statusCode).toBe(422);
      expect(err.name).toBe('VcDecodeError');
      expect(err).toBeInstanceOf(VcServiceError);
      expect(err).toBeInstanceOf(ServiceError);
    });
  });

  describe('VcCredentialStatusError', () => {
    it('constructs message from detail and httpStatus', () => {
      const err = new VcCredentialStatusError('service unavailable', 503);
      expect(err.message).toBe('Failed to issue credential status: service unavailable');
      expect(err.code).toBe('VC_STATUS_FAILED');
      expect(err.statusCode).toBe(503);
      expect(err.context).toEqual({ httpStatus: 503 });
      expect(err.name).toBe('VcCredentialStatusError');
      expect(err).toBeInstanceOf(VcServiceError);
      expect(err).toBeInstanceOf(ServiceError);
    });

    it('defaults httpStatus to 502', () => {
      const err = new VcCredentialStatusError('network failure');
      expect(err.statusCode).toBe(502);
      expect(err.context).toEqual({ httpStatus: undefined });
    });
  });

  it('exposes status error contracts and keeps causes non-enumerable', () => {
    const cause = new Error('underlying failure');
    const read = new VcStatusReadError('read failed', 503, cause);
    expect(read.code).toBe('VC_STATUS_READ_FAILED');
    expect(read.statusCode).toBe(503);
    expect(read.cause).toBe(cause);
    expect(Object.keys(read)).not.toContain('cause');

    const set = new VcStatusSetError('set failed', true, 500, cause);
    expect(set.code).toBe('VC_STATUS_SET_FAILED');
    expect(set.statusCode).toBe(500);
    expect(set.mayHaveApplied).toBe(true);

    const invalid = new VcStatusResponseInvalidError('bad body', cause);
    expect(invalid.code).toBe('VC_STATUS_RESPONSE_INVALID');
    expect(invalid.statusCode).toBe(502);
    expect(invalid.cause).toBe(cause);

    const notFound = new VcStatusListNotFoundError('missing');
    expect(notFound.code).toBe('VC_STATUS_LIST_NOT_FOUND');
    expect(notFound.statusCode).toBe(404);

    const unsupported = new VcStatusEntryUnsupportedError('unsupported', 'index', cause);
    expect(unsupported.code).toBe('VC_STATUS_ENTRY_UNSUPPORTED');
    expect(unsupported.statusCode).toBe(422);
    expect(unsupported.reason).toBe('index');
    expect(unsupported.cause).toBe(cause);
  });
});
