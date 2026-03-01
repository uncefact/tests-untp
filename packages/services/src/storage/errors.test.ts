import { ServiceError } from '../errors.js';
import { StorageError, StorageStoreError } from './errors.js';

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
});
