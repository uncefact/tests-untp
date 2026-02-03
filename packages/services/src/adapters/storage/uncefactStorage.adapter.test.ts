import { UNCEFACTStorageAdapter } from './uncefactStorage.adapter';
import type { StorageRecord } from '../../interfaces/storageService';
import type { EnvelopedVerifiableCredential } from '../../interfaces/verifiableCredentialService';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('UNCEFACTStorageAdapter', () => {
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

  const mockEncryptedApiResponse = {
    uri: 'https://storage.example.com/credentials/test-credential.json',
    hash: 'hash-response',
    key: 'secret-key-123',
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

      const storageService = new UNCEFACTStorageAdapter(
        'https://api.storage.example.com',
        { 'X-API-Key': 'test-api-key' },
        'test-bucket',
      );

      const result = await storageService.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.storage.example.com/documents',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
          },
          body: JSON.stringify({ bucket: 'test-bucket', data: mockCredential }),
        },
      );
      expect(result).toEqual(mockStorageRecord);
    });

    it('should store credential to /documents endpoint when encrypt is false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStorageRecord),
      });

      const storageService = new UNCEFACTStorageAdapter(
        'https://api.storage.example.com',
        { 'X-API-Key': 'test-api-key' },
        'test-bucket',
      );

      const result = await storageService.store(mockCredential, false);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.storage.example.com/documents',
        expect.any(Object),
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

      const storageService = new UNCEFACTStorageAdapter(
        'https://api.storage.example.com',
        customHeaders,
        'test-bucket',
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
          body: JSON.stringify({ bucket: 'test-bucket', data: mockCredential }),
        },
      );
      expect(result).toEqual(mockStorageRecord);
    });
  });

  describe('store method - encrypted (private data)', () => {
    it('should store credential to /credentials endpoint when encrypt is true', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockEncryptedApiResponse),
      });

      const storageService = new UNCEFACTStorageAdapter(
        'https://api.storage.example.com',
        { 'X-API-Key': 'test-api-key' },
        'test-bucket',
      );

      const result = await storageService.store(mockCredential, true);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.storage.example.com/credentials',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
          },
          body: JSON.stringify({ bucket: 'test-bucket', data: mockCredential }),
        },
      );
      expect(result).toEqual(mockEncryptedStorageRecord);
      expect(result.decryptionKey).toBe('secret-key-123');
    });

    it('should store encrypted credential with custom headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockEncryptedApiResponse),
      });

      const storageService = new UNCEFACTStorageAdapter(
        'https://api.storage.example.com',
        { 'X-API-Key': 'test-key', 'X-Custom': 'value' },
        'secure-bucket',
      );

      const result = await storageService.store(mockCredential, true);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.storage.example.com/credentials',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-key',
            'X-Custom': 'value',
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

      const storageService = new UNCEFACTStorageAdapter(
        'https://api.storage.example.com',
        { 'X-API-Key': 'test-api-key' },
        'test-bucket',
      );

      await expect(storageService.store(mockCredential)).rejects.toThrow(
        'Failed to store verifiable credential: HTTP 500: Internal Server Error',
      );
    });

    it('should throw error when fetch throws an Error', async () => {
      const errorMessage = 'Network error occurred';
      mockFetch.mockRejectedValue(new Error(errorMessage));

      const storageService = new UNCEFACTStorageAdapter(
        'https://api.storage.example.com',
        { 'X-API-Key': 'test-api-key' },
        'test-bucket',
      );

      await expect(storageService.store(mockCredential)).rejects.toThrow(
        `Failed to store verifiable credential: ${errorMessage}`,
      );
    });

    it('should handle non-Error exceptions', async () => {
      mockFetch.mockRejectedValue('String error');

      const storageService = new UNCEFACTStorageAdapter(
        'https://api.storage.example.com',
        { 'X-API-Key': 'test-api-key' },
        'test-bucket',
      );

      await expect(storageService.store(mockCredential)).rejects.toThrow(
        'Failed to store verifiable credential: Unknown error',
      );
    });
  });

  describe('constructor validation', () => {
    it('should throw error when baseURL is empty', () => {
      expect(() => new UNCEFACTStorageAdapter('', { 'X-API-Key': 'test-api-key' }, 'test-bucket')).toThrow(
        'Error creating UNCEFACTStorageAdapter. API URL is required.',
      );
    });

    it('should throw error when X-API-Key header is missing', () => {
      expect(() => new UNCEFACTStorageAdapter(
        'https://api.storage.example.com',
        { 'X-Custom-Header': 'value' },
        'test-bucket',
      )).toThrow(
        'Error creating UNCEFACTStorageAdapter. X-API-Key header is required.',
      );
    });

    it('should throw error when headers object is empty', () => {
      expect(() => new UNCEFACTStorageAdapter(
        'https://api.storage.example.com',
        {},
        'test-bucket',
      )).toThrow(
        'Error creating UNCEFACTStorageAdapter. X-API-Key header is required.',
      );
    });

    it('should throw error when bucket is empty', () => {
      expect(() => new UNCEFACTStorageAdapter(
        'https://api.storage.example.com',
        { 'X-API-Key': 'test-api-key' },
        '',
      )).toThrow(
        'Error creating UNCEFACTStorageAdapter. Bucket is required.',
      );
    });
  });
});
