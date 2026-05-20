import {
  UncefactStorageAdapter,
  UNCEFACT_STORAGE_ADAPTER_TYPE,
  uncefactStorageRegistryEntry,
} from './uncefact-storage.adapter';
import { StorageDeleteError, StoragePayloadError, StorageStoreError } from '../../errors';
import type { UncefactStorageConfig } from './uncefact-storage.schema';
import type { LoggerService } from '../../../logging/types';
import type { EnvelopedVerifiableCredential } from '../../../verifiable-credential/types';

// Sha-256 hex digests and the corresponding `digestMultibase` strings the
// adapter is expected to emit. The multibase form is produced by the test
// stub at `__tests__/mocks/multibase-digest.ts` (which is wired up via
// moduleNameMapper in services jest.config.js), so it uses the stub's
// deterministic `zTEST<hex>` shape rather than a real multihash encoding.
// Real multibase encoding round-trip coverage lives in untp-utils.
const HEX_A = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const MULTIBASE_A = `zTEST${HEX_A}`;
const HEX_B = '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca7';
const MULTIBASE_B = `zTEST${HEX_B}`;

describe('UncefactStorageAdapter', () => {
  const MOCK_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

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
    apiVersion: '4.0',
    publicBucket: 'public-data',
    privateBucket: 'private-data',
  };

  const mockCredential: EnvelopedVerifiableCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: 'data:application/vc+jwt,eyJhbGciOiJFZERTQSJ9.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.signature',
    type: 'EnvelopedVerifiableCredential',
  };

  let mockFetch: jest.Mock;

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalRandomUUID = globalThis.crypto?.randomUUID;

  beforeEach(() => {
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({
        uri: 'https://storage.example.com/documents/abc-123',
        hash: HEX_A,
        decryptionKey: undefined,
      }),
    });
    global.fetch = mockFetch;
    // jsdom does not provide crypto.randomUUID; assign it directly
    globalThis.crypto.randomUUID = jest.fn().mockReturnValue(MOCK_UUID);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalRandomUUID) {
      globalThis.crypto.randomUUID = originalRandomUUID;
    }
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
        apiVersion: '4.0',
        publicBucket: 'public-data',
        privateBucket: 'private-data',
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

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/v4/public', expect.any(Object));
    });

    it('should construct the legacy /api/3.1.0/... URL when configured for storage 3.x', async () => {
      const legacyConfig: UncefactStorageConfig = { ...mockConfig, apiVersion: '3.1.0' };
      const adapter = new UncefactStorageAdapter(legacyConfig, mockLogger);
      await adapter.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/3.1.0/public', expect.any(Object));
    });

    it('should use /public endpoint for unencrypted storage (encrypt = false)', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential, false);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/v4/public', expect.any(Object));
    });

    it('should use /public endpoint when encrypt is not specified (defaults to false)', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/v4/public', expect.any(Object));
    });

    it('should use /private endpoint for encrypted storage (encrypt = true)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          uri: 'https://storage.example.com/credentials/xyz-789',
          hash: HEX_B,
          decryptionKey: 'decryption-key-abc',
        }),
      });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential, true);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/v4/private', expect.any(Object));
    });

    it('should send correct payload with data and client-generated id', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toEqual({
        data: mockCredential,
        id: MOCK_UUID,
        bucket: 'public-data',
      });
    });

    it('should use POST method', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.store(mockCredential);

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));
    });

    it('should return StorageRecord with uri, hash, externalId, bucket, and mimeType', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          uri: 'https://storage.example.com/documents/abc-123',
          hash: HEX_A,
        }),
      });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      const result = await adapter.store(mockCredential);

      expect(result).toEqual({
        uri: 'https://storage.example.com/documents/abc-123',
        digestMultibase: MULTIBASE_A,
        decryptionKey: undefined,
        externalId: MOCK_UUID,
        bucket: 'public-data',
        mimeType: 'application/json',
      });
    });

    it('should return StorageRecord with decryptionKey when encrypted', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          uri: 'https://storage.example.com/credentials/xyz-789',
          hash: HEX_B,
          decryptionKey: 'decryption-key-abc',
        }),
      });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      const result = await adapter.store(mockCredential, true);

      expect(result).toEqual({
        uri: 'https://storage.example.com/credentials/xyz-789',
        digestMultibase: MULTIBASE_B,
        decryptionKey: 'decryption-key-abc',
        externalId: MOCK_UUID,
        bucket: 'private-data',
        mimeType: 'application/json',
      });
    });

    it('should return client-generated UUID as externalId', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      const result = await adapter.store(mockCredential);

      expect(result.externalId).toBe(MOCK_UUID);
    });

    it('should always set mimeType to application/json', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      const result = await adapter.store(mockCredential);

      expect(result.mimeType).toBe('application/json');
    });

    it('should include configured bucket in the response', async () => {
      const adapter = new UncefactStorageAdapter({ ...mockConfig, publicBucket: 'pub-bucket' }, mockLogger);
      const result = await adapter.store(mockCredential);

      expect(result.bucket).toBe('pub-bucket');
    });

    it('should return undefined decryptionKey when key is not in response', async () => {
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
            hash: HEX_B,
            decryptionKey: 'decryption-key-abc',
          }),
        });

        const adapter = new UncefactStorageAdapter({ ...mockConfig, privateBucket: 'private-vc' }, mockLogger);
        await adapter.store(mockCredential, true);

        const callArgs = mockFetch.mock.calls[0];
        const body = JSON.parse(callArgs[1].body);
        expect(body.bucket).toBe('private-vc');
      });

      it('should include privateBucket in payload when encrypt is true', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/credentials/xyz-789',
            hash: HEX_B,
            decryptionKey: 'decryption-key-abc',
          }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
        await adapter.store(mockCredential, true);

        const callArgs = mockFetch.mock.calls[0];
        const body = JSON.parse(callArgs[1].body);
        expect(body.bucket).toBe('private-data');
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
            url: 'https://storage.example.com/api/v4/public',
            encrypt: false,
            bucket: 'public-data',
            externalId: MOCK_UUID,
          }),
          'Storing credential',
        );
      });

      it('should call logger.info on successful storage', async () => {
        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
        await adapter.store(mockCredential);

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            uri: 'https://storage.example.com/documents/abc-123',
            encrypt: false,
            externalId: MOCK_UUID,
          }),
          'Credential stored successfully',
        );
      });

      it('should call logger.error on failed storage', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: jest.fn().mockRejectedValue(new Error('no body')),
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
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(StorageStoreError);
      });

      it('should include HTTP status in the error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('HTTP 503'),
            context: expect.objectContaining({ httpStatus: 503 }),
          }),
        );
      });

      it('should use response body message as detail when available', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: jest.fn().mockResolvedValue({ message: 'data field is required' }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('data field is required'),
          }),
        );
      });

      it('should fall back to statusText when response body has no message', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: jest.fn().mockResolvedValue({ error: 'something' }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('Bad Request'),
          }),
        );
      });

      it('should fall back to statusText when response body is not JSON', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('Bad Request'),
          }),
        );
      });

      it('should use "Unknown error" when statusText is empty and body parsing fails', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 502,
          statusText: '',
          json: jest.fn().mockRejectedValue(new Error('no body')),
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

      it.each([
        ['null', null],
        ['array', []],
        ['string', 'not-an-object'],
        ['number', 42],
      ])('should throw StorageStoreError when response body is %s', async (_label, value) => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(value),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('body is not an object'),
          }),
        );
      });

      it('should throw StorageStoreError when response is missing "uri"', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ hash: HEX_A }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(StorageStoreError);
      });

      it('should throw StorageStoreError when response is missing both "digestMultibase" and "hash"', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ uri: 'https://storage.example.com/documents/abc-123' }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(StorageStoreError);
      });

      it('should prefer "digestMultibase" over legacy "hash" when both are present', async () => {
        const PRESENT_MULTIBASE = `zTESTpreferred${HEX_B}`;
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/documents/abc-123',
            digestMultibase: PRESENT_MULTIBASE,
            hash: HEX_A,
          }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        const result = await adapter.store(mockCredential);

        expect(result.digestMultibase).toBe(PRESENT_MULTIBASE);
      });

      it('should accept "digestMultibase" as the sole digest field', async () => {
        const ONLY_MULTIBASE = `zTESTonly${HEX_A}`;
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/documents/abc-123',
            digestMultibase: ONLY_MULTIBASE,
          }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        const result = await adapter.store(mockCredential);

        expect(result.digestMultibase).toBe(ONLY_MULTIBASE);
      });

      it('should throw StorageStoreError when "digestMultibase" is not a valid multibase string', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/documents/abc-123',
            digestMultibase: 'not-a-multibase-string',
          }),
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
            hash: HEX_B,
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
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        try {
          await adapter.store(mockCredential);
          fail('Expected StoragePayloadError to be thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(StoragePayloadError);
          expect((error as StoragePayloadError).code).toBe('STORAGE_PAYLOAD_REJECTED');
          expect((error as StoragePayloadError).statusCode).toBe(400);
          expect((error as StoragePayloadError).context).toEqual(expect.objectContaining({ httpStatus: 400 }));
        }
      });

      it('should throw StoragePayloadError on 422 response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(StoragePayloadError);
      });

      it('should log "Storage API rejected payload" for 4xx responses', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: jest.fn().mockRejectedValue(new Error('no body')),
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
          json: jest.fn().mockRejectedValue(new Error('no body')),
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
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.store(mockCredential)).rejects.toThrow(StorageStoreError);
      });

      it('should set statusCode to upstream HTTP status on StorageStoreError', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        try {
          await adapter.store(mockCredential);
          fail('Expected StorageStoreError to be thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(StorageStoreError);
          expect((error as StorageStoreError).statusCode).toBe(500);
          expect((error as StorageStoreError).code).toBe('STORAGE_STORE_FAILED');
        }
      });
    });
  });

  describe('storeBinary', () => {
    it('should use /public endpoint for unencrypted upload', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/v4/public', expect.any(Object));
    });

    it('should construct the legacy /api/3.1.0/... URL when configured for storage 3.x', async () => {
      const legacyConfig: UncefactStorageConfig = { ...mockConfig, apiVersion: '3.1.0' };
      const adapter = new UncefactStorageAdapter(legacyConfig, mockLogger);
      await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/3.1.0/public', expect.any(Object));
    });

    it('should use /private endpoint for encrypted upload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          uri: 'https://storage.example.com/documents/binary-456',
          hash: HEX_A,
          decryptionKey: 'key-abc',
        }),
      });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.storeBinary('<html>Secret</html>', 'template.html', 'text/html', true);

      expect(mockFetch).toHaveBeenCalledWith('https://storage.example.com/api/v4/private', expect.any(Object));
    });

    it('should send FormData body with file field', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body;
      expect(body).toBeInstanceOf(FormData);
      expect(body.has('file')).toBe(true);
    });

    it('should include id field in FormData payload', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body as FormData;
      expect(body.get('id')).toBe(MOCK_UUID);
    });

    it('should include bucket in FormData when configured', async () => {
      const adapter = new UncefactStorageAdapter({ ...mockConfig, publicBucket: 'pub-bucket' }, mockLogger);
      await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body as FormData;
      expect(body.get('bucket')).toBe('pub-bucket');
    });

    it('should include publicBucket in FormData by default', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body as FormData;
      expect(body.get('bucket')).toBe('public-data');
    });

    it('should not include Content-Type header (let runtime set multipart boundary)', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('should include X-API-Key header when configured', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers['X-API-Key']).toBe('test-api-key');
    });

    it('should not include X-API-Key header when apiKey is omitted', async () => {
      const configWithoutKey: UncefactStorageConfig = {
        baseUrl: 'https://storage.example.com',
        apiVersion: '4.0',
        publicBucket: 'public-data',
        privateBucket: 'private-data',
      };
      const adapter = new UncefactStorageAdapter(configWithoutKey, mockLogger);
      await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers['X-API-Key']).toBeUndefined();
    });

    it('should return StorageRecord with uri, hash, externalId, bucket, and mimeType', async () => {
      const adapter = new UncefactStorageAdapter({ ...mockConfig, publicBucket: 'pub-bucket' }, mockLogger);
      const result = await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      expect(result).toEqual({
        uri: 'https://storage.example.com/documents/abc-123',
        digestMultibase: MULTIBASE_A,
        decryptionKey: undefined,
        externalId: MOCK_UUID,
        bucket: 'pub-bucket',
        mimeType: 'text/html',
      });
    });

    it('should return decryptionKey when encrypt is true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          uri: 'https://storage.example.com/documents/binary-456',
          hash: HEX_A,
          decryptionKey: 'decrypt-key-xyz',
        }),
      });

      const adapter = new UncefactStorageAdapter({ ...mockConfig, privateBucket: 'priv-bucket' }, mockLogger);
      const result = await adapter.storeBinary('<html>Secret</html>', 'secret.html', 'text/html', true);

      expect(result).toEqual({
        uri: 'https://storage.example.com/documents/binary-456',
        digestMultibase: MULTIBASE_A,
        decryptionKey: 'decrypt-key-xyz',
        externalId: MOCK_UUID,
        bucket: 'priv-bucket',
        mimeType: 'text/html',
      });
    });

    it('should return client-generated UUID as externalId', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      const result = await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      expect(result.externalId).toBe(MOCK_UUID);
    });

    it('should return the provided contentType as mimeType', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      const result = await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      expect(result.mimeType).toBe('text/html');
    });

    it('should use POST method', async () => {
      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.storeBinary('<html>Hello</html>', 'template.html', 'text/html');

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));
    });

    describe('error handling', () => {
      it('should throw StoragePayloadError on 4xx response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.storeBinary('<html></html>', 'f.html', 'text/html')).rejects.toThrow(StoragePayloadError);
      });

      it('should throw StorageStoreError on 5xx response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.storeBinary('<html></html>', 'f.html', 'text/html')).rejects.toThrow(StorageStoreError);
      });

      it('should throw StorageStoreError when response is missing "uri"', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ hash: HEX_A }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.storeBinary('<html></html>', 'f.html', 'text/html')).rejects.toThrow(StorageStoreError);
      });

      it('should throw StorageStoreError when response is missing both "digestMultibase" and "hash"', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ uri: 'https://storage.example.com/documents/abc-123' }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.storeBinary('<html></html>', 'f.html', 'text/html')).rejects.toThrow(StorageStoreError);
      });

      it('should prefer "digestMultibase" over legacy "hash" when both are present', async () => {
        const PRESENT_MULTIBASE = `zTESTpreferred${HEX_A}`;
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/documents/abc-123',
            digestMultibase: PRESENT_MULTIBASE,
            hash: HEX_B,
          }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        const result = await adapter.storeBinary('<html></html>', 'f.html', 'text/html');

        expect(result.digestMultibase).toBe(PRESENT_MULTIBASE);
      });

      it('should accept "digestMultibase" as the sole digest field', async () => {
        const ONLY_MULTIBASE = `zTESTonly${HEX_B}`;
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/documents/abc-123',
            digestMultibase: ONLY_MULTIBASE,
          }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        const result = await adapter.storeBinary('<html></html>', 'f.html', 'text/html');

        expect(result.digestMultibase).toBe(ONLY_MULTIBASE);
      });

      it('should throw StorageStoreError when "digestMultibase" is not a valid multibase string', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/documents/abc-123',
            digestMultibase: 'garbage',
          }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.storeBinary('<html></html>', 'f.html', 'text/html')).rejects.toThrow(StorageStoreError);
      });

      it.each([
        ['null', null],
        ['array', []],
        ['string', 'not-an-object'],
        ['number', 42],
      ])('should throw StorageStoreError when response body is %s', async (_label, value) => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(value),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.storeBinary('<html></html>', 'f.html', 'text/html')).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('body is not an object'),
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

        await expect(adapter.storeBinary('<html></html>', 'f.html', 'text/html')).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('invalid JSON'),
          }),
        );
      });

      it('should throw StorageStoreError when encrypt is true and response is missing "decryptionKey"', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            uri: 'https://storage.example.com/documents/binary-123',
            hash: HEX_A,
          }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.storeBinary('<html></html>', 'f.html', 'text/html', true)).rejects.toThrow(
          StorageStoreError,
        );
      });
    });
  });

  describe('delete', () => {
    it('should call correct URL with bucket and externalId as path params', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.delete('resource-id-42', 'my-bucket');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://storage.example.com/api/v4/my-bucket/resource-id-42',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('should construct the legacy /api/3.1.0/... URL when configured for storage 3.x', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      const legacyConfig: UncefactStorageConfig = { ...mockConfig, apiVersion: '3.1.0' };
      const adapter = new UncefactStorageAdapter(legacyConfig, mockLogger);
      await adapter.delete('resource-id-42', 'my-bucket');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://storage.example.com/api/3.1.0/my-bucket/resource-id-42',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('should use DELETE method', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.delete('resource-id-42', 'my-bucket');

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'DELETE' }));
    });

    it('should include X-API-Key header when configured', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.delete('resource-id-42', 'my-bucket');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['X-API-Key']).toBe('test-api-key');
    });

    it('should not include X-API-Key header when apiKey is omitted', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      const configWithoutKey: UncefactStorageConfig = {
        baseUrl: 'https://storage.example.com',
        apiVersion: '4.0',
        publicBucket: 'public-data',
        privateBucket: 'private-data',
      };
      const adapter = new UncefactStorageAdapter(configWithoutKey, mockLogger);
      await adapter.delete('resource-id-42', 'my-bucket');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['X-API-Key']).toBeUndefined();
    });

    it('should not send Content-Type header', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.delete('resource-id-42', 'my-bucket');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['Content-Type']).toBeUndefined();
    });

    it('should resolve without error on 204 response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

      await expect(adapter.delete('resource-id-42', 'my-bucket')).resolves.toBeUndefined();
    });

    it('should log info on successful delete', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
      await adapter.delete('resource-id-42', 'my-bucket');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: 'resource-id-42', bucket: 'my-bucket' }),
        'Stored content deleted successfully',
      );
    });

    describe('when bucket is not provided', () => {
      it('should not call fetch', async () => {
        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
        await adapter.delete('resource-id-42');

        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should log a warning', async () => {
        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
        await adapter.delete('resource-id-42');

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ externalId: 'resource-id-42' }),
          'Cannot delete stored content: no bucket provided',
        );
      });

      it('should not throw', async () => {
        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);
        await expect(adapter.delete('resource-id-42')).resolves.toBeUndefined();
      });
    });

    describe('error handling', () => {
      it('should throw StorageDeleteError on 404 response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.delete('resource-id-42', 'my-bucket')).rejects.toThrow(StorageDeleteError);
      });

      it('should throw StorageDeleteError on 500 response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.delete('resource-id-42', 'my-bucket')).rejects.toThrow(StorageDeleteError);
      });

      it('should include HTTP status in the error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.delete('resource-id-42', 'my-bucket')).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('HTTP 404'),
            code: 'STORAGE_DELETE_FAILED',
            statusCode: 404,
            context: expect.objectContaining({ httpStatus: 404 }),
          }),
        );
      });

      it('should use response body message as detail when available', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: jest.fn().mockResolvedValue({ message: 'Resource not found in bucket' }),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.delete('resource-id-42', 'my-bucket')).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('Resource not found in bucket'),
          }),
        );
      });

      it('should fall back to statusText when response body is not JSON', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.delete('resource-id-42', 'my-bucket')).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('Bad Request'),
          }),
        );
      });

      it('should use "Unknown error" when statusText is empty and body parsing fails', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 502,
          statusText: '',
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.delete('resource-id-42', 'my-bucket')).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('Unknown error'),
          }),
        );
      });

      it('should log error on failed delete', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: jest.fn().mockRejectedValue(new Error('no body')),
        });

        const adapter = new UncefactStorageAdapter(mockConfig, mockLogger);

        await expect(adapter.delete('resource-id-42', 'my-bucket')).rejects.toThrow();

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            httpStatus: 500,
            detail: 'Internal Server Error',
            externalId: 'resource-id-42',
            bucket: 'my-bucket',
          }),
          'Storage delete failed',
        );
      });
    });
  });

  describe('uncefactStorageRegistryEntry', () => {
    it('should have a valid configSchema', () => {
      expect(uncefactStorageRegistryEntry.configSchema).toBeDefined();

      const validConfig = {
        baseUrl: 'https://storage.example.com',
        apiKey: 'test-key',
        publicBucket: 'public-data',
        privateBucket: 'private-data',
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

    it('should default apiVersion to "4.0" when not provided', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        publicBucket: 'public-data',
        privateBucket: 'private-data',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(config);
      expect(result.apiVersion).toBe('4.0');
    });

    it('should accept the legacy "3.1.0" apiVersion for storage deployments still on 3.x', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        apiVersion: '3.1.0',
        publicBucket: 'public-data',
        privateBucket: 'private-data',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(config);
      expect(result.apiVersion).toBe('3.1.0');
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
        publicBucket: 'public-data',
        privateBucket: 'private-data',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(config);
      expect(result.apiKey).toBeUndefined();
    });

    it('should accept publicBucket', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        publicBucket: 'my-bucket',
        privateBucket: 'private-data',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(config);
      expect(result.publicBucket).toBe('my-bucket');
    });

    it('should accept privateBucket', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        publicBucket: 'public-data',
        privateBucket: 'my-private-bucket',
      };
      const result = uncefactStorageRegistryEntry.configSchema.parse(config);
      expect(result.privateBucket).toBe('my-private-bucket');
    });

    it('should reject config when publicBucket is missing', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        privateBucket: 'private-data',
      };
      expect(() => uncefactStorageRegistryEntry.configSchema.parse(config)).toThrow();
    });

    it('should reject config when privateBucket is missing', () => {
      const config = {
        baseUrl: 'https://storage.example.com',
        publicBucket: 'public-data',
      };
      expect(() => uncefactStorageRegistryEntry.configSchema.parse(config)).toThrow();
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
        publicBucket: 'public-data',
        privateBucket: 'private-data',
      };
      const parsed = uncefactStorageRegistryEntry.configSchema.parse(config);
      const adapter = uncefactStorageRegistryEntry.factory(parsed, mockLogger);
      expect(adapter).toBeDefined();
      // Verify it implements IStorageService by checking for store method
      expect(typeof (adapter as UncefactStorageAdapter).store).toBe('function');
    });
  });
});
