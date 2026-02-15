import {
  UncefactStorageAdapter,
  UNCEFACT_STORAGE_ADAPTER_TYPE,
  uncefactStorageRegistryEntry,
} from './uncefact-storage.adapter';
import { StorageStoreError } from '../../errors';
import type { UncefactStorageConfig } from './uncefact-storage.schema';
import type { LoggerService } from '../../../logging/types';
import type { EnvelopedVerifiableCredential } from '../../../interfaces/verifiableCredentialService';

describe('UncefactStorageAdapter', () => {
  const mockLogger: LoggerService = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const mockConfig: UncefactStorageConfig = {
    baseUrl: 'https://storage.example.com',
    apiKey: 'test-api-key',
    apiVersion: '1.0.0',
    bucket: 'test-bucket',
  };

  const mockCredential: EnvelopedVerifiableCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: 'data:application/vc+jwt,eyJhbGciOiJFZERTQSJ9.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.signature',
    type: 'EnvelopedVerifiableCredential',
  };

  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({
        uri: 'https://storage.example.com/documents/abc-123',
        hash: 'sha256-abc123def456',
        key: undefined,
      }),
    });
    global.fetch = mockFetch;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constants', () => {
    it('should export UNCEFACT_STORAGE_ADAPTER_TYPE as "UNCEFACT_STORAGE"', () => {
      expect(UNCEFACT_STORAGE_ADAPTER_TYPE).toBe('UNCEFACT_STORAGE');
    });
  });

  describe('constructor', () => {
    it('should create an instance with valid configuration', () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      expect(adapter).toBeInstanceOf(UncefactStorageAdapter);
    });

    it('should include X-API-Key header when apiKey is provided', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
          }),
        }),
      );
    });

    it('should not include X-API-Key header when apiKey is omitted', async () => {
      const configWithoutKey: UncefactStorageConfig = {
        baseUrl: 'https://storage.example.com',
        apiVersion: '1.0.0',
        bucket: 'test-bucket',
      };
      const adapter = new UncefactStorageAdapter(configWithoutKey, mockLogger);
      await adapter.store(mockCredential);

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-API-Key']).toBeUndefined();
    });

    it('should call logger.child with service name', () => {
      new UncefactStorageAdapter(mockConfig, mockLogger);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLogger.child).toHaveBeenCalledWith({ service: 'Storage - UncefactStorage' });
    });
  });

  describe('store', () => {
    it('should call correct URL with apiVersion path segment for unencrypted storage', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/1.0.0/documents', expect.any(Object));
    });

    it('should use /documents endpoint for unencrypted storage (encrypt = false)', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential, false);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/1.0.0/documents', expect.any(Object));
    });

    it('should use /documents endpoint when encrypt is not specified (defaults to false)', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/1.0.0/documents', expect.any(Object));
    });

    it('should use /credentials endpoint for encrypted storage (encrypt = true)', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential, true);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/1.0.0/credentials', expect.any(Object));
    });

    it('should send correct payload with bucket and data', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toEqual({
        bucket: 'test-bucket',
        data: mockCredential,
      });
    });

    it('should use POST method', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));
    });

    it('should return StorageRecord with uri and hash', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          uri: 'https://storage.example.com/documents/abc-123',
          hash: 'sha256-abc123def456',
        }),
      });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      const result = await adapter.store(mockCredential);

      expect(result).toEqual({
        uri: 'https://storage.example.com/documents/abc-123',
        hash: 'sha256-abc123def456',
        decryptionKey: undefined,
      });
    });

    it('should return StorageRecord with decryptionKey when encrypted', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          uri: 'https://storage.example.com/credentials/xyz-789',
          hash: 'sha256-xyz789',
          key: 'decryption-key-abc',
        }),
      });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      const result = await adapter.store(mockCredential, true);

      expect(result).toEqual({
        uri: 'https://storage.example.com/credentials/xyz-789',
        hash: 'sha256-xyz789',
        decryptionKey: 'decryption-key-abc',
      });
    });

    it('should return undefined decryptionKey when key is not in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          uri: 'https://storage.example.com/documents/abc-123',
          hash: 'sha256-abc123',
        }),
      });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      const result = await adapter.store(mockCredential);

      expect(result.decryptionKey).toBeUndefined();
    });

    describe('logging', () => {
      it('should call logger.debug before making the request', async () => {
        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
        await adapter.store(mockCredential);

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'https://storage.example.com/api/1.0.0/documents',
            encrypt: false,
            bucket: 'test-bucket',
          }),
          'Storing credential',
        );
      });

      it('should call logger.info on successful storage', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/documents/abc-123',
            hash: 'sha256-abc123',
          }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
        await adapter.store(mockCredential);

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            uri: 'https://storage.example.com/documents/abc-123',
            encrypt: false,
          }),
          'Credential stored successfully',
        );
      });

      it('should call logger.error on failed storage', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow();

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'https://storage.example.com/api/1.0.0/documents',
            httpStatus: 500,
            detail: 'Internal Server Error',
          }),
          'Storage API request failed',
        );
      });
    });

    describe('error handling', () => {
      it('should throw StorageStoreError on non-ok response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(StorageStoreError);
      });

      it('should include HTTP status in the error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('HTTP 503'),
            context: expect.objectContaining({ httpStatus: 503 }),
          }),
        );
      });

      it('should include status text detail in the error message', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('Bad Request'),
          }),
        );
      });

      it('should use "Unknown error" when statusText is empty', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 502,
          statusText: '',
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('Unknown error'),
          }),
        );
      });

      it('should set statusCode to 502 (Bad Gateway) on StorageStoreError', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        try {
          await adapter.store(mockCredential);
          fail('Expected StorageStoreError to be thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(StorageStoreError);
          expect((error as StorageStoreError).statusCode).toBe(502);
          expect((error as StorageStoreError).code).toBe('STORAGE_STORE_FAILED');
        }
      });
    });
  });

  describe('uncefactStorageRegistryEntry', () => {
    it('should have a valid configSchema', () => {
      expect(uncefactStorageRegistryEntry.configSchema).toBeDefined();

      const validConfig = {
        baseUrl: 'https://storage.example.com',
        apiKey: 'test-key',
        bucket: 'my-bucket',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(validConfig);
      expect(result.baseUrl).toBe('https://storage.example.com');
      expect(result.apiKey).toBe('test-key');
      expect(result.bucket).toBe('my-bucket');
    });

    it('should reject invalid config (invalid URL)', () => {
      expect(() =>
        uncefactStorageRegistryEntry.configSchema.parse({
          baseUrl: 'not-a-url',
          bucket: 'test',
        }),
      ).toThrow();
    });

    it('should reject invalid config (missing bucket)', () => {
      expect(() =>
        uncefactStorageRegistryEntry.configSchema.parse({
          baseUrl: 'https://storage.example.com',
        }),
      ).toThrow();
    });

    it('should reject invalid config (empty bucket)', () => {
      expect(() =>
        uncefactStorageRegistryEntry.configSchema.parse({
          baseUrl: 'https://storage.example.com',
          bucket: '',
        }),
      ).toThrow();
    });

    it('should default apiVersion to "1.0.0" when not provided', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        bucket: 'test-bucket',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(config);
      expect(result.apiVersion).toBe('1.0.0');
    });

    it('should reject an unsupported apiVersion', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        apiVersion: '2.0.0',
        bucket: 'test-bucket',
      };
      expect(() => uncefactStorageRegistryEntry.configSchema.parse(config)).toThrow();
    });

    it('should allow apiKey to be omitted (optional)', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        bucket: 'test-bucket',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(config);
      expect(result.apiKey).toBeUndefined();
    });

    it('should create an adapter instance via factory', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        apiKey: 'test-key',
        bucket: 'test-bucket',
      };
      const parsed = uncefactStorageRegistryEntry.configSchema.parse(config);
      const adapter = uncefactStorageRegistryEntry.factory(parsed, mockLogger);
      expect(adapter).toBeDefined();
      // Verify it implements IStorageService by checking for store method
      expect(typeof (adapter as UncefactStorageAdapter).store).toBe('function');
    });
  });
});
