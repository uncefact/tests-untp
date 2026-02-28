import { ServiceError } from '../errors.js';
import { StorageError, StoragePayloadError, StorageStoreError } from './errors.js';

describe('Storage errors', () => {
  describe('StorageError', () => {
    it('extends ServiceError', () => {
      const err = new StorageError('test', 'STORAGE_TEST', 500);
      expect(err).toBeInstanceOf(ServiceError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('StorageError');
    });
  });

  describe('StorageStoreError', () => {
    it('constructs message from httpStatus and detail', () => {
      const err = new StorageStoreError(503, 'service unavailable');
      expect(err.message).toBe('Failed to store credential: HTTP 503: service unavailable');
      expect(err.code).toBe('STORAGE_STORE_FAILED');
      expect(err.statusCode).toBe(502);
      expect(err.context).toEqual({ httpStatus: 503 });
      expect(err.name).toBe('StorageStoreError');
      expect(err).toBeInstanceOf(StorageError);
      expect(err).toBeInstanceOf(ServiceError);
    });
  });

  describe('StoragePayloadError', () => {
    const httpStatus = 400;
    const detail = 'invalid JSON body';
    const err = new StoragePayloadError(httpStatus, detail);

    it('sets message correctly with HTTP status and detail', () => {
      expect(err.message).toBe(`Storage service rejected payload: HTTP ${httpStatus}: ${detail}`);
    });

    it('sets code to STORAGE_PAYLOAD_REJECTED', () => {
      expect(err.code).toBe('STORAGE_PAYLOAD_REJECTED');
    });

    it('sets statusCode to the provided httpStatus', () => {
      expect(err.statusCode).toBe(httpStatus);
    });

    it('sets context.httpStatus to the provided httpStatus', () => {
      expect(err.context).toEqual({ httpStatus });
    });

    it('is an instance of StoragePayloadError, StorageError, ServiceError, and Error', () => {
      expect(err).toBeInstanceOf(StoragePayloadError);
      expect(err).toBeInstanceOf(StorageError);
      expect(err).toBeInstanceOf(ServiceError);
      expect(err).toBeInstanceOf(Error);
    });

    it('sets name to StoragePayloadError', () => {
      expect(err.name).toBe('StoragePayloadError');
    });
  });
});
