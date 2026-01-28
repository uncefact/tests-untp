import { StorageAdapter } from './storage.adapter';
import type { StorageRecord } from '../../interfaces/storageService';
import type { EnvelopedVerifiableCredential } from '../../interfaces/verifiableCredentialService';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('StorageAdapter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
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

  const mockEncryptedStorageRecord: StorageRecord = {
    uri: 'https://storage.example.com/credentials/test-credential.json',
    hash: 'hash-response',
    decryptionKey: 'secret-key-123',
  };

  describe('store method - unencrypted (public data)', () => {
    it('should store credential to /documents endpoint by default', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStorageRecord),
      });

      const storageService = new StorageAdapter('https://api.storage.example.com');

      const result = await storageService.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.storage.example.com/documents',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ data: mockCredential }),
        },
      );
      expect(result).toEqual(mockStorageRecord);
    });

    it('should store credential to /documents endpoint when encrypt is false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStorageRecord),
      });

      const storageService = new StorageAdapter('https://api.storage.example.com');

      const result = await storageService.store(mockCredential, false);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.storage.example.com/documents',
        expect.any(Object),
      );
      expect(result).toEqual(mockStorageRecord);
    });

    it('should store credential with additional payload', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStorageRecord),
      });

      const storageService = new StorageAdapter(
        'https://api.storage.example.com',
        undefined,
        { bucket: 'my-bucket', path: 'credentials/vc.json' },
      );

      const result = await storageService.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.storage.example.com/documents',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            bucket: 'my-bucket',
            path: 'credentials/vc.json',
            data: mockCredential,
          }),
        },
      );
      expect(result).toEqual(mockStorageRecord);
    });

    it('should store credential with custom headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStorageRecord),
      });

      const customHeaders = {
        'X-API-Key': 'test-api-key',
        'X-Custom-Header': 'custom-value',
      };

      const storageService = new StorageAdapter(
        'https://api.storage.example.com',
        customHeaders,
      );

      const result = await storageService.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.storage.example.com/documents',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
            'X-Custom-Header': 'custom-value',
          },
          body: JSON.stringify({ data: mockCredential }),
        },
      );
      expect(result).toEqual(mockStorageRecord);
    });
  });

  describe('store method - encrypted (private data)', () => {
    it('should store credential to /credentials endpoint when encrypt is true', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockEncryptedStorageRecord),
      });

      const storageService = new StorageAdapter('https://api.storage.example.com');

      const result = await storageService.store(mockCredential, true);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.storage.example.com/credentials',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ data: mockCredential }),
        },
      );
      expect(result).toEqual(mockEncryptedStorageRecord);
      expect(result.decryptionKey).toBe('secret-key-123');
    });

    it('should store encrypted credential with custom headers and additional payload', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockEncryptedStorageRecord),
      });

      const storageService = new StorageAdapter(
        'https://api.storage.example.com',
        { 'X-API-Key': 'test-key' },
        { bucket: 'secure-bucket' },
      );

      const result = await storageService.store(mockCredential, true);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.storage.example.com/credentials',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-key',
          },
          body: JSON.stringify({
            bucket: 'secure-bucket',
            data: mockCredential,
          }),
        },
      );
      expect(result).toEqual(mockEncryptedStorageRecord);
    });
  });

  describe('error handling', () => {
    it('should throw error when request fails with HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const storageService = new StorageAdapter('https://api.storage.example.com');

      await expect(storageService.store(mockCredential)).rejects.toThrow(
        'Failed to store verifiable credential: HTTP 500: Internal Server Error',
      );
    });

    it('should throw error when fetch throws an Error', async () => {
      const errorMessage = 'Network error occurred';
      mockFetch.mockRejectedValue(new Error(errorMessage));

      const storageService = new StorageAdapter('https://api.storage.example.com');

      await expect(storageService.store(mockCredential)).rejects.toThrow(
        `Failed to store verifiable credential: ${errorMessage}`,
      );
    });

    it('should handle non-Error exceptions', async () => {
      mockFetch.mockRejectedValue('String error');

      const storageService = new StorageAdapter('https://api.storage.example.com');

      await expect(storageService.store(mockCredential)).rejects.toThrow(
        'Failed to store verifiable credential: Unknown error',
      );
    });
  });

  describe('constructor validation', () => {
    it('should throw error when baseURL is empty', () => {
      expect(() => new StorageAdapter('')).toThrow(
        'Error creating StorageAdapter. API URL is required.',
      );
    });
  });
});
