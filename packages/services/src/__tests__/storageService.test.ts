import { publicAPI } from '../utils/httpService';
import { StorageService } from '../storageService';
import type { StorageRecord } from '../interfaces/storageService';
import type { EnvelopedVerifiableCredential } from '../interfaces/verifiableCredentialService';

jest.mock('../utils/httpService', () => ({
  publicAPI: {
    post: jest.fn(),
    put: jest.fn(),
  },
}));

describe('StorageService', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  const mockCredential: EnvelopedVerifiableCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: 'data:application/vc+jwt,eyJhbGciOiJFZERTQSJ9.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.signature',
    type: 'EnvelopedVerifiableCredential',
  };

  const mockStorageRecord: StorageRecord = {
    uri: 'https://storage.example.com/credentials/test-credential.json',
    hash: 'hash-response',
  };

  describe('store method with POST', () => {
    it('should store credential successfully using POST method', async () => {
      (publicAPI.post as jest.Mock).mockResolvedValue(mockStorageRecord);

      const storageService = new StorageService({
        url: 'https://api.storage.example.com/upload',
        method: 'POST',
      });

      const result = await storageService.store(mockCredential);

      expect(publicAPI.post).toHaveBeenCalledWith(
        'https://api.storage.example.com/upload',
        {
          data: mockCredential,
        },
        {
          'Content-Type': 'application/json',
        },
      );
      expect(result).toEqual(mockStorageRecord);
    });

    it('should store credential with additional params from config', async () => {
      (publicAPI.post as jest.Mock).mockResolvedValue(mockStorageRecord);

      const storageService = new StorageService({
        url: 'https://api.storage.example.com/upload',
        method: 'POST',
        bucket: 'my-bucket',
        path: 'credentials/vc.json',
      });

      const result = await storageService.store(mockCredential);

      expect(publicAPI.post).toHaveBeenCalledWith(
        'https://api.storage.example.com/upload',
        {
          bucket: 'my-bucket',
          path: 'credentials/vc.json',
          data: mockCredential,
        },
        {
          'Content-Type': 'application/json',
        },
      );
      expect(result).toEqual(mockStorageRecord);
    });

    it('should store credential with custom headers', async () => {
      (publicAPI.post as jest.Mock).mockResolvedValue(mockStorageRecord);

      const customHeaders = {
        'X-API-Key': 'test-api-key',
        'X-Custom-Header': 'custom-value',
      };

      const storageService = new StorageService({
        url: 'https://api.storage.example.com/upload',
        method: 'POST',
        headers: customHeaders,
      });

      const result = await storageService.store(mockCredential);

      expect(publicAPI.post).toHaveBeenCalledWith(
        'https://api.storage.example.com/upload',
        {
          data: mockCredential,
        },
        {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'X-Custom-Header': 'custom-value',
        },
      );
      expect(result).toEqual(mockStorageRecord);
    });

    it('should throw error when POST request fails', async () => {
      const errorMessage = 'Network error occurred';
      (publicAPI.post as jest.Mock).mockRejectedValue(new Error(errorMessage));

      const storageService = new StorageService({
        url: 'https://api.storage.example.com/upload',
        method: 'POST',
      });

      await expect(
        storageService.store(mockCredential),
      ).rejects.toThrow(`Failed to store verifiable credential: ${errorMessage}`);

      expect(publicAPI.post).toHaveBeenCalled();
    });
  });

  describe('store method with PUT', () => {
    it('should store credential successfully using PUT method', async () => {
      (publicAPI.put as jest.Mock).mockResolvedValue(mockStorageRecord);

      const storageService = new StorageService({
        url: 'https://api.storage.example.com/upload',
        method: 'PUT',
      });

      const result = await storageService.store(mockCredential);

      expect(publicAPI.put).toHaveBeenCalledWith(
        'https://api.storage.example.com/upload',
        {
          data: mockCredential,
        },
        {
          'Content-Type': 'application/json',
        },
      );
      expect(result).toEqual(mockStorageRecord);
    });

    it('should throw error when PUT request fails', async () => {
      const errorMessage = 'Unauthorized access';
      (publicAPI.put as jest.Mock).mockRejectedValue(new Error(errorMessage));

      const storageService = new StorageService({
        url: 'https://api.storage.example.com/upload',
        method: 'PUT',
      });

      await expect(
        storageService.store(mockCredential),
      ).rejects.toThrow(`Failed to store verifiable credential: ${errorMessage}`);

      expect(publicAPI.put).toHaveBeenCalled();
    });
  });

  describe('constructor validation', () => {
    it('should throw error when url is empty', () => {
      expect(() => new StorageService({
        url: '',
        method: 'POST',
      })).toThrow('Storage config error: url is required and must be a string');
    });

    it('should throw error when url is missing', () => {
      expect(() => new StorageService({
        method: 'POST',
      })).toThrow('Storage config error: url is required and must be a string');
    });

    it('should throw error when method is invalid', () => {
      expect(() => new StorageService({
        url: 'https://api.storage.example.com/upload',
        method: 'GET',
      })).toThrow("Storage config error: method is required and must be 'PUT' or 'POST'");
    });

    it('should throw error when headers is not an object', () => {
      expect(() => new StorageService({
        url: 'https://api.storage.example.com/upload',
        method: 'POST',
        headers: 'invalid',
      })).toThrow('Storage config error: headers must be an object');
    });
  });

  describe('error handling', () => {
    it('should handle non-Error exceptions', async () => {
      (publicAPI.post as jest.Mock).mockRejectedValue('String error');

      const storageService = new StorageService({
        url: 'https://api.storage.example.com/upload',
        method: 'POST',
      });

      await expect(
        storageService.store(mockCredential),
      ).rejects.toThrow('Failed to store verifiable credential: Unknown error');
    });
  });

  describe('headers handling', () => {
    it('should merge custom headers with default Content-Type', async () => {
      (publicAPI.post as jest.Mock).mockResolvedValue(mockStorageRecord);

      const storageService = new StorageService({
        url: 'https://api.storage.example.com/upload',
        method: 'POST',
        headers: { 'X-Request-ID': 'request-123' },
      });

      await storageService.store(mockCredential);

      expect(publicAPI.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        {
          'Content-Type': 'application/json',
          'X-Request-ID': 'request-123',
        },
      );
    });

    it('should handle undefined headers', async () => {
      (publicAPI.post as jest.Mock).mockResolvedValue(mockStorageRecord);

      const storageService = new StorageService({
        url: 'https://api.storage.example.com/upload',
        method: 'POST',
      });

      await storageService.store(mockCredential);

      expect(publicAPI.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        {
          'Content-Type': 'application/json',
        },
      );
    });
  });
});
