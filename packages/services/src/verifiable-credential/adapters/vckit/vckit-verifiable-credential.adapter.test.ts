/**
 * @jest-environment node
 */
import {
  VCKitVerifiableCredentialService,
  VCKIT_VC_ADAPTER_TYPE,
  vckitVerifiableCredentialRegistryEntry,
} from './vckit-verifiable-credential.adapter';
import { VcSignError, VcVerifyError, VcCredentialStatusError, VcStatusReadError, VcStatusSetError } from '../../errors';
import { VerificationErrorCode } from '../../types';
import type { VCKitVerifiableCredentialConfig } from './vckit-verifiable-credential.schema';
import type { LoggerService } from '../../../logging/types';
import type { CredentialPayload, EnvelopedVerifiableCredential, CredentialStatus } from '../../types';

// jose ships ESM the services Jest config does not transform; the decoder
// only needs the payload segment read, which this mock does for real.
jest.mock('jose', () => ({
  decodeJwt: (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')),
}));

// httpFetch normalises headers into a Headers instance; match by reading through it.
const headersMatching = (pairs: Record<string, string>) => ({
  asymmetricMatch: (actual: unknown) => {
    const h = new Headers(actual as HeadersInit);
    return Object.entries(pairs).every(([k, v]) => h.get(k) === v);
  },
  toString: () => `headersMatching(${JSON.stringify(pairs)})`,
});

const correlationHeaderOf = (init: unknown): string | null =>
  new Headers((init as RequestInit).headers).get('x-correlation-id');

describe('VCKitVerifiableCredentialService', () => {
  const mockLogger: LoggerService = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const mockConfig: VCKitVerifiableCredentialConfig = {
    baseUrl: 'https://vckit.example.com',
    apiKey: 'test-api-key',
    apiVersion: '1.0.0',
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
    statusListIndex: '0',
    statusListCredential: 'https://vckit.example.com/credentials/status/1',
  };

  const issuedCredentialStatus = { ...mockCredentialStatus, statusListIndex: 0 };

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

    it('carries an x-correlation-id header on outbound requests', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(mockCredentialStatus) })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ verifiableCredential: mockEnvelopedCredential }),
        });
      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
      await adapter.sign(mockCredentialPayload);

      expect(correlationHeaderOf(mockFetch.mock.calls[0][1])).toMatch(/.+/);
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
          headers: headersMatching({
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
          headers: headersMatching({
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
        'https://vckit.example.com/v2/credentials/issue',
        expect.objectContaining({
          method: 'POST',
          headers: headersMatching({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );

      // Verify the issue body contains credential with status and correct proof format
      const issueCallArgs = mockFetch.mock.calls[1];
      const issueBody = JSON.parse(issueCallArgs[1].body);
      expect(issueBody.credential.credentialStatus).toEqual(issuedCredentialStatus);
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

      // Verify the correct request was made (agent endpoint, not v2 API)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vckit.example.com/agent/routeVerificationCredential',
        expect.objectContaining({
          method: 'POST',
          headers: headersMatching({
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

    it('reports a temporal failure for an expired credential the provider accepted, unless the window is skipped', async () => {
      // The pinned VCKit never checks validFrom or validUntil for a vc+jwt
      // envelope, so the adapter judges them. Fails if the provider's
      // verified:true is passed through for an expired credential.
      const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const expired = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: `data:application/vc+jwt,${b64({ alg: 'EdDSA' })}.${b64({ validUntil: '2021-01-01T00:00:00Z' })}.sig`,
      } as unknown as typeof mockEnvelopedCredential;
      mockFetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue({ verified: true }) });
      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      const enforced = await adapter.verify(expired);
      expect(enforced).toEqual({
        verified: false,
        error: { type: VerificationErrorCode.Temporal, message: expect.stringContaining('expired') },
      });

      const skipped = await adapter.verify(expired, { validityWindow: false });
      expect(skipped).toEqual({ verified: true });
    });

    it('skips only the validity window when asked, keeping the signature and status policies', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ verified: true }) });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
      await adapter.verify(mockEnvelopedCredential, { validityWindow: false });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vckit.example.com/agent/routeVerificationCredential',
        expect.objectContaining({
          body: JSON.stringify({
            credential: mockEnvelopedCredential,
            fetchRemoteContexts: true,
            policies: { credentialStatus: true, issuanceDate: false, expirationDate: false },
          }),
        }),
      );
    });

    it('sends only the provider default policies when the option is true or absent', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue({ verified: true }) });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);
      await adapter.verify(mockEnvelopedCredential, { validityWindow: true });
      await adapter.verify(mockEnvelopedCredential, {});

      for (const call of mockFetch.mock.calls) {
        expect(JSON.parse(call[1].body).policies).toEqual({ credentialStatus: true });
      }
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

    it.each([
      ['a string "false"', { verified: 'false' }],
      ['a string "true"', { verified: 'true' }],
      ['a number', { verified: 1 }],
      ['an object', { verified: {} }],
      ['a missing field', {}],
      ['null', { verified: null }],
    ])('should throw VcVerifyError when verified is %s instead of a boolean', async (_label, body) => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(body),
      });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      await expect(adapter.verify(mockEnvelopedCredential)).rejects.toThrow(VcVerifyError);
      await expect(adapter.verify(mockEnvelopedCredential)).rejects.toThrow(
        'Verification API returned a non-boolean "verified" value',
      );
    });

    it.each([
      ['null', null],
      ['an array', [{ verified: true }]],
      ['a string', 'verified'],
    ])('should throw VcVerifyError when the response body is %s', async (_label, body) => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(body),
      });

      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      await expect(adapter.verify(mockEnvelopedCredential)).rejects.toThrow(VcVerifyError);
      await expect(adapter.verify(mockEnvelopedCredential)).rejects.toThrow(
        'Verification API returned a non-object response body',
      );
    });

    it('should throw VcVerifyError when credential is falsy', async () => {
      const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

      await expect(adapter.verify(null as unknown as EnvelopedVerifiableCredential)).rejects.toThrow(VcVerifyError);
      await expect(adapter.verify(null as unknown as EnvelopedVerifiableCredential)).rejects.toThrow(
        'Credential is required',
      );
    });

    it('should throw VcVerifyError when verify endpoint keeps returning non-ok', async () => {
      // A verification is a repeatable read: a 503 that persists through every attempt still surfaces as the error.
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
      try {
        mockFetch.mockImplementation(async () => new Response('', { status: 503, statusText: 'Service Unavailable' }));
        const adapter = new VCKitVerifiableCredentialService(mockConfig, mockLogger);

        const outcome = adapter.verify(mockEnvelopedCredential).catch((error: unknown) => error);
        await jest.advanceTimersByTimeAsync(30_000);
        const error = await outcome;

        expect(error).toBeInstanceOf(VcVerifyError);
        expect((error as VcVerifyError).message).toContain('HTTP 503');
        expect(mockFetch).toHaveBeenCalledTimes(4);
      } finally {
        jest.useRealTimers();
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
        baseUrl: 'https://vckit.example.com',
        apiKey: 'test-key',
      };
      const result = vckitVerifiableCredentialRegistryEntry.configSchema.parse(validConfig);
      expect(result.baseUrl).toBe('https://vckit.example.com');
      expect(result.apiKey).toBe('test-key');
    });

    it('should reject invalid config (missing apiKey)', () => {
      expect(() =>
        vckitVerifiableCredentialRegistryEntry.configSchema.parse({
          baseUrl: 'https://vckit.example.com',
        }),
      ).toThrow();
    });

    it('should reject invalid config (empty apiKey)', () => {
      expect(() =>
        vckitVerifiableCredentialRegistryEntry.configSchema.parse({
          baseUrl: 'https://vckit.example.com',
          apiKey: '',
        }),
      ).toThrow();
    });

    it('should reject invalid config (invalid URL)', () => {
      expect(() =>
        vckitVerifiableCredentialRegistryEntry.configSchema.parse({
          baseUrl: 'not-a-url',
          apiKey: 'test-key',
        }),
      ).toThrow();
    });

    it('should reject invalid config (missing baseUrl)', () => {
      expect(() =>
        vckitVerifiableCredentialRegistryEntry.configSchema.parse({
          apiKey: 'test-key',
        }),
      ).toThrow();
    });

    it('should create an adapter instance via factory', () => {
      const config = {
        baseUrl: 'https://vckit.example.com',
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

describe('VCKitVerifiableCredentialService outbound retry', () => {
  const warn = jest.fn();
  const logger: LoggerService = {
    debug: jest.fn(),
    info: jest.fn(),
    warn,
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  const config: VCKitVerifiableCredentialConfig = {
    baseUrl: 'https://vckit.example.com',
    apiKey: 'test-api-key',
    apiVersion: '1.0.0',
  };
  const envelope: EnvelopedVerifiableCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: 'data:application/vc+jwt,eyJhbGciOiJFZERTQSJ9.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.signature',
    type: 'EnvelopedVerifiableCredential',
  };
  const payload: CredentialPayload = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential'],
    issuer: { type: ['CredentialIssuer'], id: 'did:web:example.com', name: 'Issuer' },
    credentialSubject: { type: ['Product'], id: 'https://example.com/product/1' },
  };
  const entry = {
    type: 'BitstringStatusListEntry' as const,
    statusPurpose: 'revocation',
    statusListIndex: '7',
    statusListCredential: 'https://vckit.example.com/status/1',
  };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  /** An attempt that answers after `ms` unless its signal fires first. */
  const answerAfter =
    (ms: number, response: Response) =>
    (_input: unknown, init: RequestInit): Promise<Response> =>
      new Promise((resolve, reject) => {
        const signal = init.signal as AbortSignal;
        const handle = setTimeout(() => resolve(response), ms);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(handle);
            reject(signal.reason);
          },
          { once: true },
        );
      });
  const mockFetch = jest.fn();
  const paths = (): string[] => mockFetch.mock.calls.map(([input]) => new URL(String(input)).pathname);
  /** Starts the call, runs the fake clock forward, and settles it either way. */
  const drive = async <T>(call: () => Promise<T>, ms = 60_000): Promise<{ value?: T; error?: unknown }> => {
    const settled = call().then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await jest.advanceTimersByTimeAsync(ms);
    return settled;
  };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    mockFetch.mockReset();
    warn.mockReset();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('retries a verification answered 503 and reports the retry at warn', async () => {
    mockFetch.mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, { verified: true }));

    const { value } = await drive(() => new VCKitVerifiableCredentialService(config, logger).verify(envelope));

    expect(value).toEqual({ verified: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'https://vckit.example.com/agent/routeVerificationCredential', cause: 503 }),
      'Outbound request refused; retrying after a wait',
    );
  });

  it('stops a refused verification when the caller signal fires during the wait', async () => {
    mockFetch
      .mockResolvedValueOnce(json(503, {}, { 'Retry-After': '5' }))
      .mockResolvedValue(json(200, { verified: true }));
    const controller = new AbortController();

    const outcome = new VCKitVerifiableCredentialService(config, logger)
      .verify(envelope, { signal: controller.signal })
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(1_000);
    controller.abort();
    const error = await outcome;

    expect(error).toBeInstanceOf(VcVerifyError);
    expect((error as VcVerifyError).context).toEqual({ httpStatus: 503 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // The refusal's body was read before the wait, and its attempt then
    // released from the caller's signal.
    expect((mockFetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(false);
  });

  it('stops retrying a refused verification at the caller deadline', async () => {
    // Fails if the adapter drops VerifyOptions.deadline: the 30 s default
    // would let the verifier resend after the job's budget had run out.
    mockFetch
      .mockResolvedValueOnce(json(429, {}, { 'Retry-After': '5' }))
      .mockResolvedValue(json(200, { verified: true }));

    const { error } = await drive(() =>
      new VCKitVerifiableCredentialService(config, logger).verify(envelope, { deadline: Date.now() + 2_000 }),
    );

    expect(error).toBeInstanceOf(VcVerifyError);
    expect((error as VcVerifyError).context).toEqual({ httpStatus: 429 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('makes one status-set attempt on a 429 and reports it as not applied', async () => {
    mockFetch.mockResolvedValueOnce(json(429, { message: 'slow down' })).mockResolvedValue(json(200, { status: true }));

    const { error } = await drive(() =>
      new VCKitVerifiableCredentialService(config, logger).setCredentialStatus({
        statusListIssuer: 'did:web:example.com',
        entry,
        value: true,
        signal: new AbortController().signal,
      }),
    );

    expect(error).toBeInstanceOf(VcStatusSetError);
    expect((error as VcStatusSetError).mayHaveApplied).toBe(false);
    expect((error as VcStatusSetError).context).toEqual(expect.objectContaining({ httpStatus: 429 }));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('makes one status-set attempt on a 503 and keeps it possibly applied', async () => {
    mockFetch.mockResolvedValueOnce(json(503, {})).mockResolvedValue(json(200, { status: true }));

    const { error } = await drive(() =>
      new VCKitVerifiableCredentialService(config, logger).setCredentialStatus({
        statusListIssuer: 'did:web:example.com',
        entry,
        value: true,
        signal: new AbortController().signal,
      }),
    );

    expect((error as VcStatusSetError).mayHaveApplied).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('makes one status-mint attempt on a 429', async () => {
    mockFetch.mockResolvedValueOnce(json(429, {})).mockResolvedValue(json(200, entry));

    const { error } = await drive(() => new VCKitVerifiableCredentialService(config, logger).sign(payload));

    expect(error).toBeInstanceOf(VcCredentialStatusError);
    expect((error as VcCredentialStatusError).context).toEqual({ httpStatus: 429 });
    expect(paths()).toEqual(['/agent/issueBitstringStatusList']);
  });

  it('retries the issue request on a 429 but never on a 503', async () => {
    const issued = {
      verifiableCredential: {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        id: envelope.id,
        type: 'EnvelopedVerifiableCredential',
      },
    };
    mockFetch.mockResolvedValueOnce(json(429, {})).mockResolvedValueOnce(json(200, issued));
    const adapter = new VCKitVerifiableCredentialService(config, logger);

    const retried = await drive(() => adapter.sign(payload, { statusPurposes: [] }));
    expect(retried.value).toEqual(issued.verifiableCredential);
    expect(paths()).toEqual(['/v2/credentials/issue', '/v2/credentials/issue']);

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(json(503, {})).mockResolvedValue(json(200, issued));
    const refused = await drive(() => adapter.sign(payload, { statusPurposes: [] }));
    expect(refused.error).toBeInstanceOf(VcSignError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  describe('status read', () => {
    const read = (
      adapter: VCKitVerifiableCredentialService,
      signal = new AbortController().signal,
      deadline?: number,
    ) => adapter.getCredentialStatus({ statusListIssuer: 'did:web:example.com', entry, signal, deadline });

    it('reads after a 503', async () => {
      mockFetch.mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, { revoked: false, errors: [] }));

      const { value } = await drive(() => read(new VCKitVerifiableCredentialService(config, logger)));

      expect(value).toEqual(expect.objectContaining({ value: false, statusListIndex: '7' }));
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('waits for a status read that answers after 12 s rather than aborting it', async () => {
      // Fails if the status read regains a per-attempt limit: VCKit fetches the
      // status list while it answers, and a 12 s read that used to succeed
      // inside the 30 s status budget would be cut off and sent again.
      mockFetch.mockImplementationOnce(answerAfter(12_000, json(200, { revoked: true, errors: [] })));

      const { value, error } = await drive(() => read(new VCKitVerifiableCredentialService(config, logger)), 12_100);

      expect(error).toBeUndefined();
      expect(value).toEqual(expect.objectContaining({ value: true }));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('classifies the last refusal from its readable body when the signal ends the wait', async () => {
      mockFetch
        .mockResolvedValueOnce(json(503, { message: 'gateway busy' }, { 'Retry-After': '5' }))
        .mockResolvedValue(json(200, { revoked: false, errors: [] }));
      const controller = new AbortController();

      const outcome = read(new VCKitVerifiableCredentialService(config, logger), controller.signal).catch(
        (error: unknown) => error,
      );
      await jest.advanceTimersByTimeAsync(1_000);
      controller.abort();
      const error = await outcome;

      expect(error).toBeInstanceOf(VcStatusReadError);
      expect((error as VcStatusReadError).message).toContain('gateway busy');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not wait past the read deadline', async () => {
      mockFetch
        .mockResolvedValueOnce(json(429, {}, { 'Retry-After': '5' }))
        .mockResolvedValue(json(200, { revoked: false, errors: [] }));

      const { error } = await drive(() =>
        read(new VCKitVerifiableCredentialService(config, logger), undefined, Date.now() + 2_000),
      );

      expect(error).toBeInstanceOf(VcStatusReadError);
      expect((error as VcStatusReadError).context).toEqual(expect.objectContaining({ httpStatus: 429 }));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
