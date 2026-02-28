import { ServiceError } from '../errors.js';
import { VcServiceError, VcSignError, VcVerifyError, VcDecodeError, VcCredentialStatusError } from './errors.js';

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
});
