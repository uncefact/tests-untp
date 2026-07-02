// Polyfill AbortSignal.timeout for jsdom (not available in jsdom)
if (typeof AbortSignal.timeout !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (AbortSignal as any).timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withPublicRoute to mirror handleRouteError behaviour
jest.mock('@/lib/api/with-public-route', () => {
  const { errorMessage, ServiceRegistryError } = jest.requireActual('@/lib/api/errors');
  const { ValidationError } = jest.requireActual('@/lib/api/validation');

  function jsonResponse(body: unknown, init?: { status?: number }) {
    return { status: init?.status ?? 200, json: async () => body };
  }

  return {
    withPublicRoute: (handler: (req: unknown) => Promise<unknown>) => async (req: unknown) => {
      try {
        return await handler(req);
      } catch (e: unknown) {
        if (e instanceof ValidationError) return jsonResponse({ error: (e as Error).message }, { status: 400 });
        if (e instanceof ServiceRegistryError) return jsonResponse({ error: (e as Error).message }, { status: 500 });
        return jsonResponse({ error: errorMessage(e) }, { status: 500 });
      }
    },
  };
});

const mockResolveVcService = jest.fn();
const mockDecryptCredential = jest.fn();
const mockIsEncryptedEnvelope = jest.fn();
const mockDecodeJwt = jest.fn();
const mockMultibaseDigestVerify = jest.fn();
const mockMultibaseDigestFromString = jest.fn((_input: string) => ({ verify: mockMultibaseDigestVerify }));

jest.mock('@/lib/services/resolve-vc-service', () => ({
  resolveVcService: (...args: unknown[]) => mockResolveVcService(...args),
}));

jest.mock('@uncefact/untp-ri-services', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services');
  return {
    decryptCredential: (...args: unknown[]) => mockDecryptCredential(...args),
    isEncryptedEnvelope: (...args: unknown[]) => mockIsEncryptedEnvelope(...args),
    VcVerifyError: actual.VcVerifyError,
  };
});

jest.mock('@uncefact/untp-utils/multibase-digest', () => ({
  MultibaseDigest: {
    fromString: (input: string) => mockMultibaseDigestFromString(input),
  },
}));

jest.mock('jose', () => ({
  decodeJwt: (...args: unknown[]) => mockDecodeJwt(...args),
}));

const mockValidatePublicUrl = jest.fn();
jest.mock('@uncefact/untp-ri-services/server', () => ({
  validatePublicUrl: (...args: unknown[]) => mockValidatePublicUrl(...args),
}));

jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { ServiceResolutionError } from '@/lib/api/errors';
import { SYSTEM_TENANT_ID } from '@/lib/prisma/constants';
import { POST } from './route';

// ── Fixtures ──────────────────────────────────────────────────────────

const VALID_URI = 'https://storage.example.com/credentials/abc123';
const VALID_HASH = 'a'.repeat(64);
const VALID_KEY = 'b'.repeat(64);

const ENVELOPED_CREDENTIAL = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id: 'data:application/vc+jwt,eyJhbGciOiJFZDI1NTE5In0.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.signature',
  type: 'EnvelopedVerifiableCredential',
};

const ENCRYPTED_DATA = {
  cipherText: 'encrypted-data',
  iv: 'init-vector',
  tag: 'auth-tag',
  type: 'aes-256-gcm',
};

const DECODED_JWT = { iss: 'did:web:example.com', type: ['VerifiableCredential'] };

// ── Helpers ───────────────────────────────────────────────────────────

function createFakeRequest(body: Record<string, unknown>): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/credentials/verify',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
  } as unknown as Request;
}

function createBadJsonRequest(): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/credentials/verify',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  } as unknown as Request;
}

function createFetchResponse(body: unknown, opts?: { ok?: boolean; status?: number; textThrows?: boolean }) {
  const ok = opts?.ok ?? true;
  const status = opts?.status ?? (ok ? 200 : 500);
  return {
    ok,
    status,
    text: opts?.textThrows
      ? async () => {
          throw new Error('read error');
        }
      : async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('POST /api/v1/credentials/verify', () => {
  const mockVcService = { verify: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveVcService.mockResolvedValue({ service: mockVcService, instanceId: 'inst-1' });
    mockDecodeJwt.mockReturnValue(DECODED_JWT);
    mockMultibaseDigestVerify.mockResolvedValue(true);
    mockIsEncryptedEnvelope.mockReturnValue(false);
    mockValidatePublicUrl.mockResolvedValue(undefined);
    delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
  });

  // ── Input Validation (400s) ───────────────────────────────────────

  it('returns 400 for malformed JSON body', async () => {
    const res = await POST(createBadJsonRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 when uri is missing', async () => {
    const res = await POST(createFakeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('uri');
  });

  it('returns 400 when uri is not a string', async () => {
    const res = await POST(createFakeRequest({ uri: 123 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('uri');
  });

  it('returns 400 for a JSON null body', async () => {
    const res = await POST(createFakeRequest(null as unknown as Record<string, unknown>));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('body');
  });

  it('returns 400 for invalid URI format', async () => {
    const res = await POST(createFakeRequest({ uri: 'not-a-url' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('uri must be a valid URL');
  });

  it('returns 400 for non-HTTP(S) URI scheme (ftp://)', async () => {
    const res = await POST(createFakeRequest({ uri: 'ftp://example.com/file' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('uri must be a valid HTTP(S) URL');
  });

  it('returns 400 for invalid hash format (too short)', async () => {
    const res = await POST(createFakeRequest({ uri: VALID_URI, hash: 'abc123' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('hash');
    expect(json.error).toContain('64-character hex string (SHA-256)');
  });

  it('returns 400 for invalid decryptionKey format', async () => {
    const res = await POST(createFakeRequest({ uri: VALID_URI, decryptionKey: 'short' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('decryptionKey');
    expect(json.error).toContain('64-character hex string');
  });

  it('returns 400 for an invalid digestMultibase encoding', async () => {
    mockMultibaseDigestFromString.mockImplementationOnce(() => {
      throw new Error('invalid multibase');
    });

    const res = await POST(createFakeRequest({ uri: VALID_URI, digestMultibase: 'not-a-digest' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('digestMultibase');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── SSRF Protection (400) ────────────────────────────────────────

  it('returns 400 when validatePublicUrl rejects the URI', async () => {
    mockValidatePublicUrl.mockRejectedValue(new Error('uri must not point to a private or reserved network address'));

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('uri must not point to a private or reserved network address');
  });

  it('calls validatePublicUrl with parsed URL', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockVcService.verify.mockResolvedValue({ verified: true });

    await POST(createFakeRequest({ uri: VALID_URI }));

    expect(mockValidatePublicUrl).toHaveBeenCalledTimes(1);
    const calledUrl = mockValidatePublicUrl.mock.calls[0][0];
    expect(calledUrl).toBeInstanceOf(URL);
    expect(calledUrl.href).toBe(VALID_URI);
  });

  it('skips validatePublicUrl when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockVcService.verify.mockResolvedValue({ verified: true });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(200);
    expect(mockValidatePublicUrl).not.toHaveBeenCalled();
  });

  // ── Upstream Errors (502) ─────────────────────────────────────────

  it('returns 502 when fetch times out', async () => {
    const timeoutError = Object.assign(new Error('Timeout'), { name: 'TimeoutError' });
    mockFetch.mockImplementation(() => Promise.reject(timeoutError));

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch credential: request timed out');
    expect(json.code).toBe('UPSTREAM_ERROR');
  });

  it('returns 502 when fetch fails with network error', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed'));

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch credential: network error');
    expect(json.code).toBe('UPSTREAM_ERROR');
  });

  it('returns 502 when storage returns non-2xx', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(null, { ok: false, status: 404 }));

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch credential: storage returned 404');
    expect(json.code).toBe('UPSTREAM_ERROR');
  });

  it('returns 502 when response exceeds size limit', async () => {
    const hugeText = 'x'.repeat(10_485_761); // 10 MB + 1 byte
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => hugeText,
    });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain('exceeds maximum size');
    expect(json.code).toBe('UPSTREAM_ERROR');
  });

  it('returns 502 when response.text() throws', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('stream error');
      },
    });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('Failed to read credential response');
    expect(json.code).toBe('UPSTREAM_ERROR');
  });

  // ── Credential Processing (422) ───────────────────────────────────

  it('returns 422 when response is not valid JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'not-json{{{',
    });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('Response from storage URI is not valid JSON');
    expect(json.code).toBe('INVALID_RESPONSE');
  });

  it('returns 422 when the fetched credential is JSON null', async () => {
    mockFetch.mockResolvedValue(createFetchResponse('null'));

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('Credential content is not a JSON object');
    expect(json.code).toBe('INVALID_RESPONSE');
  });

  it('returns 422 when the fetched credential is a JSON array', async () => {
    mockFetch.mockResolvedValue(createFetchResponse([{ type: 'EnvelopedVerifiableCredential' }]));

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('Credential content is not a JSON object');
    expect(json.code).toBe('INVALID_RESPONSE');
  });

  it('returns 422 when the decrypted credential is JSON null', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENCRYPTED_DATA));
    mockIsEncryptedEnvelope.mockReturnValue(true);
    mockDecryptCredential.mockReturnValue('null');

    const res = await POST(createFakeRequest({ uri: VALID_URI, decryptionKey: VALID_KEY }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('Credential content is not a JSON object');
    expect(json.code).toBe('INVALID_RESPONSE');
  });

  it('returns 422 when credential is encrypted but no decryption key provided', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENCRYPTED_DATA));
    mockIsEncryptedEnvelope.mockReturnValue(true);

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('Credential is encrypted but no decryptionKey was provided');
    expect(json.code).toBe('DECRYPTION_REQUIRED');
  });

  it('returns 422 when decryption fails', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENCRYPTED_DATA));
    mockIsEncryptedEnvelope.mockReturnValue(true);
    mockDecryptCredential.mockImplementation(() => {
      throw new Error('decryption failure');
    });

    const res = await POST(createFakeRequest({ uri: VALID_URI, decryptionKey: VALID_KEY }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('Failed to decrypt credential');
    expect(json.code).toBe('DECRYPTION_FAILED');
  });

  it('returns 422 when decrypted output is not valid JSON', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENCRYPTED_DATA));
    mockIsEncryptedEnvelope.mockReturnValue(true);
    mockDecryptCredential.mockReturnValue('not-valid-json{{{');

    const res = await POST(createFakeRequest({ uri: VALID_URI, decryptionKey: VALID_KEY }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('DECRYPTION_FAILED');
  });

  it('returns 422 when digestMultibase does not match', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockMultibaseDigestVerify.mockResolvedValueOnce(false);

    const res = await POST(createFakeRequest({ uri: VALID_URI, digestMultibase: 'zNOMATCH' }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('Credential digest does not match the expected digest');
    expect(json.code).toBe('DIGEST_MISMATCH');
  });

  it('returns 422 when legacy hex hash does not match', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    // VALID_HASH is `a`.repeat(64); the real sha-256 of the JSON credential
    // will not equal that, so the legacy path's comparison fails.
    const res = await POST(createFakeRequest({ uri: VALID_URI, hash: VALID_HASH }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('Credential digest does not match the expected digest');
    expect(json.code).toBe('DIGEST_MISMATCH');
  });

  it('returns 422 when credential is not an EnvelopedVerifiableCredential', async () => {
    const plainCredential = { type: 'SomeOtherType', id: 'urn:uuid:123' };
    mockFetch.mockResolvedValue(createFetchResponse(plainCredential));

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('Only EnvelopedVerifiableCredential is supported');
    expect(json.code).toBe('UNSUPPORTED_CREDENTIAL_TYPE');
  });

  // ── Verification Outcomes (200) ───────────────────────────────────

  it('returns verified: true for successful verification', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockVcService.verify.mockResolvedValue({ verified: true });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verified).toBe(true);
    expect(json.credential).toEqual(ENVELOPED_CREDENTIAL);
    expect(json.decodedCredential).toEqual(DECODED_JWT);
    expect(json.error).toBeUndefined();
    expect(json.warnings).toBeUndefined();
  });

  it('returns verified: false with error details when verification fails', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    const verificationError = { type: 'status', message: 'Credential revoked' };
    mockVcService.verify.mockResolvedValue({ verified: false, error: verificationError });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verified).toBe(false);
    expect(json.error).toEqual(verificationError);
    expect(json.credential).toEqual(ENVELOPED_CREDENTIAL);
    expect(json.decodedCredential).toEqual(DECODED_JWT);
  });

  // ── Edge Cases ────────────────────────────────────────────────────

  it('skips decryption for unencrypted credentials', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockVcService.verify.mockResolvedValue({ verified: true });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(200);
    expect(mockDecryptCredential).not.toHaveBeenCalled();
  });

  it('skips digest check when neither digestMultibase nor hash is provided', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockVcService.verify.mockResolvedValue({ verified: true });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(200);
    expect(mockMultibaseDigestFromString).not.toHaveBeenCalled();
  });

  it('omits decodedCredential and adds warning when JWT decode fails', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockVcService.verify.mockResolvedValue({ verified: true });
    mockDecodeJwt.mockImplementation(() => {
      throw new Error('invalid JWT');
    });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verified).toBe(true);
    expect(json.decodedCredential).toBeUndefined();
    expect(json.warnings).toEqual(['Failed to decode JWT from enveloped credential']);
  });

  it('adds warning when credential.id is not a string', async () => {
    const credNoId = { ...ENVELOPED_CREDENTIAL, id: 42 };
    mockFetch.mockResolvedValue(createFetchResponse(credNoId));
    mockVcService.verify.mockResolvedValue({ verified: true });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warnings).toEqual(['Credential id is not a string; unable to decode JWT']);
    expect(json.decodedCredential).toBeUndefined();
  });

  it('adds warning when credential.id does not start with data:application/vc+jwt,', async () => {
    const credBadId = { ...ENVELOPED_CREDENTIAL, id: 'urn:uuid:123' };
    mockFetch.mockResolvedValue(createFetchResponse(credBadId));
    mockVcService.verify.mockResolvedValue({ verified: true });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warnings).toEqual(['Credential id does not use the expected data:application/vc+jwt media type']);
    expect(json.decodedCredential).toBeUndefined();
  });

  it('resolves VC service with SYSTEM_TENANT_ID', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockVcService.verify.mockResolvedValue({ verified: true });

    await POST(createFakeRequest({ uri: VALID_URI }));

    expect(mockResolveVcService).toHaveBeenCalledWith(SYSTEM_TENANT_ID);
  });

  it('includes decodedCredential for enveloped credentials', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockVcService.verify.mockResolvedValue({ verified: true });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    const json = await res.json();
    expect(json.decodedCredential).toEqual(DECODED_JWT);
    expect(mockDecodeJwt).toHaveBeenCalledWith(
      'eyJhbGciOiJFZDI1NTE5In0.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.signature',
    );
  });

  it('accepts credential.type as an array (W3C VC Data Model)', async () => {
    const arrayTypeCredential = {
      ...ENVELOPED_CREDENTIAL,
      type: ['VerifiableCredential', 'EnvelopedVerifiableCredential'],
    };
    mockFetch.mockResolvedValue(createFetchResponse(arrayTypeCredential));
    mockVcService.verify.mockResolvedValue({ verified: true });

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verified).toBe(true);
  });

  // ── Service Errors ────────────────────────────────────────────────

  it('returns 500 when VC service resolution fails', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockResolveVcService.mockRejectedValue(new ServiceResolutionError('VC', SYSTEM_TENANT_ID));

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('No service instance available');
  });

  it('returns 502 when VC service returns an error during verification', async () => {
    const { VcVerifyError } = jest.requireActual('@uncefact/untp-ri-services');
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockVcService.verify.mockRejectedValue(new VcVerifyError('HTTP 404: Not Found', 404));

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('Credential verification service failed');
    expect(json.code).toBe('VC_SERVICE_ERROR');
  });

  it('returns 500 when vcService.verify() throws unexpectedly', async () => {
    mockFetch.mockResolvedValue(createFetchResponse(ENVELOPED_CREDENTIAL));
    mockVcService.verify.mockRejectedValue(new Error('VCKit connection refused'));

    const res = await POST(createFakeRequest({ uri: VALID_URI }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('VCKit connection refused');
  });
});
