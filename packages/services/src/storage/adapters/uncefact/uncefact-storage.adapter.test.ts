import {
  UncefactStorageAdapter,
  UNCEFACT_STORAGE_ADAPTER_TYPE,
  uncefactStorageRegistryEntry,
} from './uncefact-storage.adapter';
import { StoragePayloadError, StorageStoreError } from '../../errors';
import type { UncefactStorageConfig } from './uncefact-storage.schema';
import type { LoggerService } from '../../../logging/types';
import type { EnvelopedVerifiableCredential } from '../../../verifiable-credential/types';

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
    apiVersion: '3.0.0',
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
        decryptionKey: undefined,
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
        apiVersion: '3.0.0',
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

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/3.0.0/public', expect.any(Object));
    });

    it('should use /public endpoint for unencrypted storage (encrypt = false)', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential, false);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/3.0.0/public', expect.any(Object));
    });

    it('should use /public endpoint when encrypt is not specified (defaults to false)', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/3.0.0/public', expect.any(Object));
    });

    it('should use /private endpoint for encrypted storage (encrypt = true)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          uri: 'https://storage.example.com/credentials/xyz-789',
          hash: 'sha256-xyz789',
          decryptionKey: 'decryption-key-abc',
        }),
      });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential, true);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/3.0.0/private', expect.any(Object));
    });

    it('should send correct payload with data', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toEqual({
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
          decryptionKey: 'decryption-key-abc',
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

    describe('bucket selection', () => {
      it('should include publicBucket in payload when configured and encrypt is false', async () => {
        const adapter = new UncefactStorageAdapter({ ...mockConfig, publicBucket: 'public-vc' }, mockLogger);
        await adapter.store(mockCredential, false);

        const callArgs = mockFetch.mock.calls[0];
        const body = JSON.parse(callArgs[1].body);
        expect(body.bucket).toBe('public-vc');
      });

      it('should include privateBucket in payload when configured and encrypt is true', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/credentials/xyz-789',
            hash: 'sha256-xyz789',
            decryptionKey: 'decryption-key-abc',
          }),
        });

        const adapter = new UncefactStorageAdapter({ ...mockConfig, privateBucket: 'private-vc' }, mockLogger);
        await adapter.store(mockCredential, true);

        const callArgs = mockFetch.mock.calls[0];
        const body = JSON.parse(callArgs[1].body);
        expect(body.bucket).toBe('private-vc');
      });

      it('should not include bucket in payload when no buckets are configured and encrypt is true', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/credentials/xyz-789',
            hash: 'sha256-xyz789',
            decryptionKey: 'decryption-key-abc',
          }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
        await adapter.store(mockCredential, true);

        const callArgs = mockFetch.mock.calls[0];
        const body = JSON.parse(callArgs[1].body);
        expect(body).not.toHaveProperty('bucket');
      });

      it('should use publicBucket for default (non-encrypted) storage', async () => {
        const adapter = new UncefactStorageAdapter(
          { ...mockConfig, publicBucket: 'pub', privateBucket: 'priv' },
          mockLogger,
        );
        await adapter.store(mockCredential);

        const callArgs = mockFetch.mock.calls[0];
        const body = JSON.parse(callArgs[1].body);
        expect(body.bucket).toBe('pub');
      });
    });

    describe('logging', () => {
      it('should call logger.debug before making the request', async () => {
        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
        await adapter.store(mockCredential);

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'https://storage.example.com/api/3.0.0/public',
            encrypt: false,
            bucket: undefined,
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

      it('should throw StorageStoreError when response is not valid JSON', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('invalid JSON'),
          }),
        );
      });

      it('should throw StorageStoreError when response is missing "uri"', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ hash: 'sha256-abc123' }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(StorageStoreError);
      });

      it('should throw StorageStoreError when response is missing "hash"', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ uri: 'https://storage.example.com/documents/abc-123' }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(StorageStoreError);
      });

      it('should throw StorageStoreError when encrypt is true and response is missing "decryptionKey"', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/credentials/xyz-789',
            hash: 'sha256-xyz789',
          }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential, true)).rejects.toThrow(StorageStoreError);
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ decryptionKey: undefined }),
          expect.stringContaining('decryptionKey'),
        );
      });

      it('should not require decryptionKey when encrypt is false', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/documents/abc-123',
            hash: 'sha256-abc123',
          }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
        const result = await adapter.store(mockCredential, false);

        expect(result.uri).toBe('https://storage.example.com/documents/abc-123');
        expect(result.decryptionKey).toBeUndefined();
      });

      it('should throw StoragePayloadError on 400 response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        try {
          await adapter.store(mockCredential);
          fail('Expected StoragePayloadError to be thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(StoragePayloadError);
          expect((error as StoragePayloadError).code).toBe('STORAGE_PAYLOAD_REJECTED');
          expect((error as StoragePayloadError).statusCode).toBe(422);
          expect((error as StoragePayloadError).context).toEqual(expect.objectContaining({ httpStatus: 400 }));
        }
      });

      it('should throw StoragePayloadError on 422 response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(StoragePayloadError);
      });

      it('should log "Storage API rejected payload" for 4xx responses', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow();

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            httpStatus: 400,
            detail: 'Bad Request',
          }),
          'Storage API rejected payload',
        );
      });

      it('should throw StorageStoreError (not StoragePayloadError) on 500 response', async () => {
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
          expect(error).not.toBeInstanceOf(StoragePayloadError);
        }
      });

      it('should throw StorageStoreError on 503 response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(StorageStoreError);
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
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(validConfig);
      expect(result.baseUrl).toBe('https://storage.example.com');
      expect(result.apiKey).toBe('test-key');
    });

    it('should reject invalid config (invalid URL)', () => {
      expect(() =>
        uncefactStorageRegistryEntry.configSchema.parse({
          baseUrl: 'not-a-url',
        }),
      ).toThrow();
    });

    it('should default apiVersion to "3.0.0" when not provided', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(config);
      expect(result.apiVersion).toBe('3.0.0');
    });

    it('should reject an unsupported apiVersion', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        apiVersion: '2.0.0',
      };
      expect(() => uncefactStorageRegistryEntry.configSchema.parse(config)).toThrow();
    });

    it('should allow apiKey to be omitted (optional)', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(config);
      expect(result.apiKey).toBeUndefined();
    });

    it('should accept optional publicBucket', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        publicBucket: 'my-bucket',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(config);
      expect(result.publicBucket).toBe('my-bucket');
    });

    it('should accept optional privateBucket', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        privateBucket: 'my-private-bucket',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(config);
      expect(result.privateBucket).toBe('my-private-bucket');
    });

    it('should reject empty string publicBucket', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        publicBucket: '',
      };
      expect(() => uncefactStorageRegistryEntry.configSchema.parse(config)).toThrow();
    });

    it('should reject empty string privateBucket', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        privateBucket: '',
      };
      expect(() => uncefactStorageRegistryEntry.configSchema.parse(config)).toThrow();
    });

    it('should create an adapter instance via factory', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        apiKey: 'test-key',
      };
      const parsed = uncefactStorageRegistryEntry.configSchema.parse(config);
      const adapter = uncefactStorageRegistryEntry.factory(parsed, mockLogger);
      expect(adapter).toBeDefined();
      // Verify it implements IStorageService by checking for store method
      expect(typeof (adapter as UncefactStorageAdapter).store).toBe('function');
    });
  });
});
