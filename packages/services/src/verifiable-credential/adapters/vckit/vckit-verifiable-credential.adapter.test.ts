import {
  VCKitVerifiableCredentialService,
  VCKIT_VC_ADAPTER_TYPE,
  vckitVerifiableCredentialRegistryEntry,
} from './vckit-verifiable-credential.adapter';
import { VcSignError, VcVerifyError, VcCredentialStatusError } from '../../errors';
import { VerificationErrorCode } from '../../types';
import type { VCKitVerifiableCredentialConfig } from './vckit-verifiable-credential.schema';
import type { LoggerService } from '../../../logging/types';
import type { CredentialPayload, EnvelopedVerifiableCredential, CredentialStatus } from '../../types';

describe('VCKitVerifiableCredentialService', () => {
  const mockLogger: LoggerService = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const mockConfig: VCKitVerifiableCredentialConfig = {
    endpoint: 'https://vckit.example.com',
    apiKey: 'test-api-key',
  };

  const mockCredentialPayload: CredentialPayload = {
    '@context': ['https://www.w3.org/ns/credentials/v2'] as ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'DigitalProductPassport'] as ['VerifiableCredential', ...string[]],
    issuer: {
      type: ['CredentialIssuer'] as [string, ...string[]],
      id: 'did:web:example.com' as const,
      name: 'Test Issuer',
    },
    credentialSubject: {
      type: ['Product'] as [string, ...string[]],
      id: 'https://example.com/product/1',
      name: 'Test Product',
    },
  };

  const mockCredentialStatus: CredentialStatus = {
    id: 'https://vckit.example.com/credentials/status/1#0',
    type: 'BitstringStatusListEntry' as const,
    statusPurpose: 'revocation' as const,
    statusListIndex: 0,
    statusListCredential: 'https://vckit.example.com/credentials/status/1',
  };

  const mockEnvelopedCredential: EnvelopedVerifiableCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2'] as ['https://www.w3.org/ns/credentials/v2'],
    id: 'data:application/vc+jwt,eyJhbGciOiJFZERTQSJ9.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.signature',
    type: 'EnvelopedVerifiableCredential' as const,
  };

  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constants', () => {
    it('should export VCKIT_VC_ADAPTER_TYPE as "VCKIT"', () => {
      expect(VCKIT_VC_ADAPTER_TYPE).toBe('VCKIT');
    });
  });

  describe('constructor', () => {
    it('should create an instance with valid configuration', () => {
      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
      expect(adapter).toBeInstanceOf(VCKitVerifiableCredentialService);
    });

    it('should construct Bearer token from apiKey', async () => {
      // Set up fetch mocks for sign flow: status call + issue call
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockCredentialStatus),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ verifiableCredential: mockEnvelopedCredential }),
        });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
      await adapter.sign(mockCredentialPayload);

      // Both calls should include the Bearer token header
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should call logger.child with service name', () => {
      new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLogger.child).toHaveBeenCalledWith({ service: 'VC - VCKitVerifiableCredential' });
    });
  });

  describe('sign', () => {
    it('should issue credential status, construct VC, call issue endpoint, and return enveloped credential', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockCredentialStatus),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ verifiableCredential: mockEnvelopedCredential }),
        });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
      const result = await adapter.sign(mockCredentialPayload);

      // First call: credential status endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vckit.example.com/agent/issueBitstringStatusList',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
          body: JSON.stringify({
            statusPurpose: 'revocation',
            bitstringStatusIssuer: 'did:web:example.com',
          }),
        }),
      );

      // Second call: issue endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vckit.example.com/credentials/issue',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );

      // Verify the issue body contains credential with status and correct proof format
      const issueCallArgs = mockFetch.mock.calls[1];
      const issueBody = JSON.parse(issueCallArgs[1].body);
      expect(issueBody.credential.credentialStatus).toEqual(mockCredentialStatus);
      expect(issueBody.options.proofFormat).toBe('EnvelopingProofJose');

      // Returns the enveloped credential
      expect(result).toEqual(mockEnvelopedCredential);
    });

    it('should throw VcSignError when credentialSubject is empty object', async () => {
      const payload: CredentialPayload = {
        ...mockCredentialPayload,
        credentialSubject: {} as CredentialPayload['credentialSubject'],
      };

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      await expect(adapter.sign(payload)).rejects.toThrow(VcSignError);
      await expect(adapter.sign(payload)).rejects.toThrow('credentialSubject is required');
    });

    it('should throw VcSignError when credentialSubject is falsy', async () => {
      const payload = {
        ...mockCredentialPayload,
        credentialSubject: null,
      } as unknown as CredentialPayload;

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      await expect(adapter.sign(payload)).rejects.toThrow(VcSignError);
      await expect(adapter.sign(payload)).rejects.toThrow('credentialSubject is required');
    });

    it('should throw VcCredentialStatusError when issuer ID is missing', async () => {
      const payload: CredentialPayload = {
        ...mockCredentialPayload,
        issuer: {
          type: ['CredentialIssuer'] as [string, ...string[]],
          id: '' as unknown as CredentialPayload['issuer']['id'],
          name: 'Test Issuer',
        },
      };

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      await expect(adapter.sign(payload)).rejects.toThrow(VcCredentialStatusError);
      await expect(adapter.sign(payload)).rejects.toThrow('Issuer ID is required');
    });

    it('should throw VcCredentialStatusError when status endpoint returns non-ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      try {
        await adapter.sign(mockCredentialPayload);
        fail('Expected VcCredentialStatusError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(VcCredentialStatusError);
        expect((error as VcCredentialStatusError).message).toContain('HTTP 500');
      }
    });

    it('should throw VcSignError when issue endpoint returns non-ok', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockCredentialStatus),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
        });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      try {
        await adapter.sign(mockCredentialPayload);
        fail('Expected VcSignError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(VcSignError);
        expect((error as VcSignError).message).toContain('HTTP 400');
      }
    });
  });

  describe('verify', () => {
    it('should return { verified: true } for verified credential', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ verified: true }),
      });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
      const result = await adapter.verify(mockEnvelopedCredential);

      expect(result).toEqual({ verified: true });

      // Verify the correct request was made
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vckit.example.com/credentials/verify',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
          body: JSON.stringify({
            credential: mockEnvelopedCredential,
            fetchRemoteContexts: true,
            policies: { credentialStatus: true },
          }),
        }),
      );
    });

    it('should return { verified: false, error } for unverified credential with error code mapping', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          verified: false,
          error: { errorCode: 'status_revoked', message: 'Credential has been revoked' },
        }),
      });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
      const result = await adapter.verify(mockEnvelopedCredential);

      expect(result).toEqual({
        verified: false,
        error: {
          type: VerificationErrorCode.Status,
          message: 'Credential has been revoked',
        },
      });
    });

    it('should throw VcVerifyError when credential is falsy', async () => {
      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      await expect(adapter.verify(null as unknown as EnvelopedVerifiableCredential)).rejects.toThrow(VcVerifyError);
      await expect(adapter.verify(null as unknown as EnvelopedVerifiableCredential)).rejects.toThrow(
        'Credential is required',
      );
    });

    it('should throw VcVerifyError when verify endpoint returns non-ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      try {
        await adapter.verify(mockEnvelopedCredential);
        fail('Expected VcVerifyError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(VcVerifyError);
        expect((error as VcVerifyError).message).toContain('HTTP 503');
      }
    });
  });

  describe('mapErrorCode (tested indirectly via verify)', () => {
    const verifyWithError = async (errorCode: string | undefined, expectedType: VerificationErrorCode) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          verified: false,
          error: { errorCode, message: 'Test error' },
        }),
      });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
      const result = await adapter.verify(mockEnvelopedCredential);

      expect(result.verified).toBe(false);
      expect(result.error?.type).toBe(expectedType);
    };

    it('should map "status" code to VerificationErrorCode.Status', async () => {
      await verifyWithError('status_revoked', VerificationErrorCode.Status);
    });

    it('should map "revoke" code to VerificationErrorCode.Status', async () => {
      await verifyWithError('credential_revoked', VerificationErrorCode.Status);
    });

    it('should map "signature" code to VerificationErrorCode.Integrity', async () => {
      await verifyWithError('invalid_signature', VerificationErrorCode.Integrity);
    });

    it('should map "proof" code to VerificationErrorCode.Integrity', async () => {
      await verifyWithError('proof_invalid', VerificationErrorCode.Integrity);
    });

    it('should map "integrity" code to VerificationErrorCode.Integrity', async () => {
      await verifyWithError('data_integrity_failed', VerificationErrorCode.Integrity);
    });

    it('should map "expir" code to VerificationErrorCode.Temporal', async () => {
      await verifyWithError('credential_expired', VerificationErrorCode.Temporal);
    });

    it('should map "not_yet_valid" code to VerificationErrorCode.Temporal', async () => {
      await verifyWithError('not_yet_valid', VerificationErrorCode.Temporal);
    });

    it('should map "validfrom" code to VerificationErrorCode.Temporal', async () => {
      await verifyWithError('validfrom_check_failed', VerificationErrorCode.Temporal);
    });

    it('should map "validuntil" code to VerificationErrorCode.Temporal', async () => {
      await verifyWithError('validuntil_exceeded', VerificationErrorCode.Temporal);
    });

    it('should default to VerificationErrorCode.Integrity for unknown codes', async () => {
      await verifyWithError('some_unknown_code', VerificationErrorCode.Integrity);
    });

    it('should default to VerificationErrorCode.Integrity when errorCode is undefined', async () => {
      await verifyWithError(undefined, VerificationErrorCode.Integrity);
    });

    it('should return verified: false with no error when vckit result has no error object', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ verified: false }),
      });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
      const result = await adapter.verify(mockEnvelopedCredential);

      expect(result).toEqual({ verified: false, error: undefined });
    });

    it('should use "Verification failed" as default message when error message is empty', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          verified: false,
          error: { errorCode: 'some_error', message: '' },
        }),
      });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
      const result = await adapter.verify(mockEnvelopedCredential);

      expect(result.error?.message).toBe('Verification failed');
    });
  });

  describe('vckitVerifiableCredentialRegistryEntry', () => {
    it('should have a valid configSchema that accepts valid config', () => {
      expect(vckitVerifiableCredentialRegistryEntry.configSchema).toBeDefined();

      const validConfig = {
        endpoint: 'https://vckit.example.com',
        apiKey: 'test-key',
      };
      const result = vckitVerifiableCredentialRegistryEntry.configSchema.parse(validConfig);
      expect(result.endpoint).toBe('https://vckit.example.com');
      expect(result.apiKey).toBe('test-key');
    });

    it('should reject invalid config (missing apiKey)', () => {
      expect(() =>
        vckitVerifiableCredentialRegistryEntry.configSchema.parse({
          endpoint: 'https://vckit.example.com',
        }),
      ).toThrow();
    });

    it('should reject invalid config (empty apiKey)', () => {
      expect(() =>
        vckitVerifiableCredentialRegistryEntry.configSchema.parse({
          endpoint: 'https://vckit.example.com',
          apiKey: '',
        }),
      ).toThrow();
    });

    it('should reject invalid config (invalid URL)', () => {
      expect(() =>
        vckitVerifiableCredentialRegistryEntry.configSchema.parse({
          endpoint: 'not-a-url',
          apiKey: 'test-key',
        }),
      ).toThrow();
    });

    it('should reject invalid config (missing endpoint)', () => {
      expect(() =>
        vckitVerifiableCredentialRegistryEntry.configSchema.parse({
          apiKey: 'test-key',
        }),
      ).toThrow();
    });

    it('should create an adapter instance via factory', () => {
      const config = {
        endpoint: 'https://vckit.example.com',
        apiKey: 'test-key',
      };
      const parsed = vckitVerifiableCredentialRegistryEntry.configSchema.parse(config);
      const adapter = vckitVerifiableCredentialRegistryEntry.factory(parsed, mockLogger);

      expect(adapter).toBeDefined();
      expect(typeof adapter.sign).toBe('function');
      expect(typeof adapter.verify).toBe('function');
    });
  });
});
