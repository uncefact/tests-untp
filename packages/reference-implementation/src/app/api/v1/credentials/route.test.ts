// Mock next/server before importing route handlers (jsdom lacks Request/Response)
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withTenantAuth — mirrors handleRouteError behaviour inline to avoid
// import issues with mocked @uncefact/untp-ri-services
jest.mock('@/lib/api/with-tenant-auth', () => {
  // The wrapper is stubbed to skip authentication, but error mapping delegates
  // to the real handleRouteError rather than restating it. A copy here drifts
  // from the mapper every time a new error class is added, and the drift shows
  // up as a route returning 500 in tests while returning the right status in
  // production. next/server is already stubbed above, so the real mapper's
  // NextResponse.json calls produce the same shape this suite reads.
  const { handleRouteError } = jest.requireActual('@/lib/api/handle-route-error');

  return {
    withTenantAuth:
      (handler: (req: unknown, ctx: unknown) => Promise<unknown>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
        } catch (e: unknown) {
          return handleRouteError(e);
        }
      },
  };
});

// Suppress logger output in tests
jest.mock('@/lib/api/logger', () => ({
  apiLogger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the new lib modules
const mockResolveDataModel = jest.fn();
jest.mock('@/lib/credentials/resolve-data-model', () => ({
  resolveDataModel: (...args: unknown[]) => mockResolveDataModel(...args),
  isDccDataModel: jest.requireActual('@/lib/credentials/resolve-data-model').isDccDataModel,
}));

const mockValidateCredentialPayload = jest.fn();
jest.mock('@/lib/credentials/validate-credential-payload', () => ({
  validateCredentialPayload: (...args: unknown[]) => mockValidateCredentialPayload(...args),
}));

const mockIssueCredential = jest.fn();
jest.mock('@/lib/credentials/issue-credential', () => ({
  issueCredential: (...args: unknown[]) => mockIssueCredential(...args),
}));

// Service resolver mocks
const mockResolveVcService = jest.fn();
const mockResolveStorageService = jest.fn();
const mockResolveIdrService = jest.fn();

jest.mock('@/lib/services/resolve-vc-service', () => ({
  resolveVcService: (...args: unknown[]) => mockResolveVcService(...args),
}));
jest.mock('@/lib/services/resolve-storage-service', () => ({
  resolveStorageService: (...args: unknown[]) => mockResolveStorageService(...args),
}));
jest.mock('@/lib/services/resolve-idr-service', () => ({
  resolveIdrService: (...args: unknown[]) => mockResolveIdrService(...args),
}));

const mockResolvePublishTarget = jest.fn();
jest.mock('@/lib/credentials/resolve-publish-target', () => ({
  resolvePublishTarget: (...args: unknown[]) => mockResolvePublishTarget(...args),
}));

// Services package mocks
const mockBuildPublishLinks = jest.fn();
jest.mock('@uncefact/untp-ri-services', () => ({
  buildPublishLinks: (...args: unknown[]) => mockBuildPublishLinks(...args),
  // publishingOptionsSchema derives its accessRole values from this enum.
  AccessRole: jest.requireActual('@uncefact/untp-ri-services').AccessRole,
  // The real implementation, so the warning-pointer assertions below exercise
  // the actual rewriting rather than a stub of it.
  remapWarningPointers: jest.requireActual('@uncefact/untp-ri-services').remapWarningPointers,
  // The real class, because the route classifies a publish failure by
  // instanceof and reads the upstream status off the instance. A hand-shaped
  // stand-in lets the route read a field the real error never carries, which
  // is how the two drifted apart previously.
  IdrPublishError: jest.requireActual('@uncefact/untp-ri-services').IdrPublishError,
  // The real class for the same reason: handleRouteError classifies by
  // instanceof, and an undefined stand-in makes that check throw.
  ServiceError: jest.requireActual('@uncefact/untp-ri-services').ServiceError,
}));

const { IdrPublishError: RealIdrPublishError } = jest.requireActual('@uncefact/untp-ri-services');

// Repository mocks
const mockUpdateCredentialPublished = jest.fn();
const mockListCredentials = jest.fn();
const mockGetDidByDid = jest.fn();
const mockFindConformityScheme = jest.fn();
const mockClaimIdempotencyKey = jest.fn();
const mockCompleteIdempotencyKey = jest.fn();
const mockFindIdempotencyKey = jest.fn();
const mockReleaseIdempotencyKey = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  updateCredentialPublished: (...args: unknown[]) => mockUpdateCredentialPublished(...args),
  listCredentials: (...args: unknown[]) => mockListCredentials(...args),
  getDidByDid: (...args: unknown[]) => mockGetDidByDid(...args),
  findConformitySchemeByCanonicalId: (...args: unknown[]) => mockFindConformityScheme(...args),
  CREDENTIAL_ISSUANCE_OPERATION: 'credential.issue',
  claimIdempotencyKey: (...args: unknown[]) => mockClaimIdempotencyKey(...args),
  completeIdempotencyKey: (...args: unknown[]) => mockCompleteIdempotencyKey(...args),
  findIdempotencyKey: (...args: unknown[]) => mockFindIdempotencyKey(...args),
  releaseIdempotencyKey: (...args: unknown[]) => mockReleaseIdempotencyKey(...args),
}));

// Pass stored keys through by default; individual tests override per call
const mockRevealDecryptionKey = jest.fn((...args: unknown[]) => args[0]);
jest.mock('@/lib/credentials/decryption-key-protection', () => ({
  revealDecryptionKey: (...args: unknown[]) => mockRevealDecryptionKey(...args),
}));

// Conformity-vocabulary validator mock — the real cross-check is unit-tested in
// `@uncefact/untp-utils`; here we only assert the route wires it up.
const mockValidateConformityClaim = jest.fn();
jest.mock('@uncefact/untp-utils/conformity-vocabulary', () => ({
  validateConformityClaim: (...args: unknown[]) => mockValidateConformityClaim(...args),
}));

const mockAssertPublicUrl = jest.fn();
jest.mock('@/lib/api/validation', () => {
  const actual = jest.requireActual('@/lib/api/validation');
  return {
    ...actual,
    assertPublicUrl: (...args: unknown[]) => mockAssertPublicUrl(...args),
  };
});

import { IdempotencyOperation } from '@/lib/prisma/generated';
import { MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { POST, GET } from './route';
import { IdempotencyClaimLostError } from '@/lib/prisma/repositories/idempotency-key.repository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bodyBytes(bodyString: string): ArrayBuffer {
  const buf = Buffer.from(bodyString, 'utf8');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function streamingBody(encoded: string) {
  const bytes = new Uint8Array(Buffer.from(encoded, 'utf8'));
  return {
    getReader() {
      let delivered = false;
      return {
        async read() {
          if (delivered) return { done: true as const, value: undefined };
          delivered = true;
          return { done: false as const, value: bytes };
        },
        async cancel() {
          delivered = true;
        },
      };
    },
  };
}

function stubHeaders(init: Record<string, string>): Headers {
  const store = new Map<string, string>();
  for (const [key, value] of Object.entries(init)) {
    store.set(key.toLowerCase(), value);
  }
  return {
    get(name: string) {
      return store.has(name.toLowerCase()) ? store.get(name.toLowerCase())! : null;
    },
  } as unknown as Headers;
}

function createFakeRequest(body?: unknown, extraHeaders?: Record<string, string>, rawBody?: string): Request {
  const bodyString = rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined);
  const encoded = bodyString ?? 'not-json';
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/credentials',
    headers: stubHeaders({ 'Content-Type': 'application/json', ...extraHeaders }),
    body: streamingBody(encoded),
    arrayBuffer: async () => bodyBytes(encoded),
    text: async () => encoded,
    json:
      bodyString !== undefined
        ? async () => JSON.parse(bodyString)
        : async () => {
            throw new SyntaxError('Unexpected token');
          },
  } as unknown as Request;
}

function createBadJsonRequest(): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/credentials',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: streamingBody('not-json'),
    arrayBuffer: async () => bodyBytes('not-json'),
    text: async () => 'not-json',
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

function createFakeGetRequest(queryParams?: Record<string, string>): Request {
  const url = new URL('http://localhost/api/v1/credentials');
  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return {
    method: 'GET',
    url: url.toString(),
    headers: new Headers(),
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'tenant-1', params: Promise.resolve({}) };

/** Minimal credential payload for a valid request. */
const VALID_PAYLOAD = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
  issuer: { type: ['CredentialIssuer'], id: 'did:web:vckit.example.com:tenant-1', name: 'Tenant 1' },
  credentialSubject: { id: 'urn:example:product:123' },
};

const STORAGE_RESPONSE = {
  uri: 'https://storage.example.com/cred/abc123',
  hash: 'sha256-abc',
  decryptionKey: 'key-xyz',
};

const stubBridge = {
  buildSubject: jest.fn().mockReturnValue({}),
  extractRefs: jest.fn().mockReturnValue({ organisations: [], facilities: [], products: [] }),
  extractConformityClaim: jest.fn().mockReturnValue(null),
  extractConformityClaimWithProvenance: jest.fn().mockReturnValue(null),
  extractSubjectSummary: jest.fn().mockReturnValue({ id: null, name: null }),
};

const DATA_MODEL = {
  id: 'dm-1',
  name: 'Digital Product Passport',
  credentialType: 'DigitalProductPassport',
  version: '0.6.1',
  schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.1.json',
};

/** Builds a valid request body with sensible defaults. */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    credentialPayload: VALID_PAYLOAD,
    credentialType: 'DigitalProductPassport',
    version: '0.6.1',
    ...overrides,
  };
}

function setupHappyPath() {
  mockResolveDataModel.mockResolvedValue({
    dataModel: DATA_MODEL,
    bridge: stubBridge,
    schemaUrls: [DATA_MODEL.schemaUrl],
    coreDataModelVersion: '0.6.1',
    coreDataModelType: 'DigitalProductPassport',
  });
  mockValidateCredentialPayload.mockResolvedValue(undefined);
  mockGetDidByDid.mockResolvedValue({
    id: 'did-1',
    did: 'did:web:vckit.example.com:tenant-1',
    tenantId: 'tenant-1',
    serviceInstanceId: 'vc-1',
  });
  mockResolveVcService.mockResolvedValue({ service: {}, instanceId: 'vc-1' });
  mockResolveStorageService.mockResolvedValue({ service: {}, instanceId: 'storage-1' });
  mockIssueCredential.mockResolvedValue({
    credentialId: 'cred-1',
    storageResponse: STORAGE_RESPONSE,
    primaryEntity: {},
  });
  // Conformity-claim defaults: no claim on the credential (non-DCC), so the
  // validator is not invoked. DCC tests override these.
  stubBridge.extractConformityClaim.mockReturnValue(null);
  stubBridge.extractConformityClaimWithProvenance.mockReturnValue(null);
  mockValidateConformityClaim.mockReturnValue([]);
  mockFindConformityScheme.mockResolvedValue(null);
  mockFindIdempotencyKey.mockResolvedValue({ outcome: 'absent' });
  mockClaimIdempotencyKey.mockResolvedValue({ outcome: 'claimed', claimId: 'claim-1' });
  mockCompleteIdempotencyKey.mockResolvedValue({ applied: true });
  mockReleaseIdempotencyKey.mockResolvedValue({ applied: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/credentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    process.env.RI_APP_URL = 'http://localhost:3003';
    setupHappyPath();
  });

  // ── Validation ────────────────────────────────────────────────────────

  describe('validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const req = createBadJsonRequest();
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Invalid JSON body');
    });

    it('returns 400 when credentialPayload is missing', async () => {
      const req = createFakeRequest(validBody({ credentialPayload: undefined }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('credentialPayload');
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('returns 400 when credentialPayload is not an object', async () => {
      const req = createFakeRequest(validBody({ credentialPayload: 'not-an-object' }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('credentialPayload');
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('returns 400 when credentialType is missing', async () => {
      const req = createFakeRequest(validBody({ credentialType: undefined }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('credentialType');
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('accepts any non-empty credentialType string', async () => {
      const req = createFakeRequest(validBody({ credentialType: 'DigitalLivestockPassport' }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveDataModel).toHaveBeenCalledWith('tenant-1', 'DigitalLivestockPassport', '0.6.1');
    });

    it('returns 400 when version is missing', async () => {
      const req = createFakeRequest(validBody({ version: undefined }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('version');
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it.each([
      ['blank credentialType', { credentialType: '   ' }, 'credentialType'],
      ['blank version', { version: ' ' }, 'version'],
      ['mistyped storageOptions.encrypt', { storageOptions: { encrypt: 'false' } }, 'storageOptions.encrypt'],
      [
        'mistyped storageOptions.serviceInstanceId',
        { storageOptions: { serviceInstanceId: 42 } },
        'storageOptions.serviceInstanceId',
      ],
      ['null storageOptions', { storageOptions: null }, 'storageOptions'],
      ['null publishingOptions', { publishingOptions: null }, 'publishingOptions'],
      ['blank publishingOptions.linkType', { publishingOptions: { linkType: '  ' } }, 'publishingOptions.linkType'],
      [
        'malformed machineVerificationUrl',
        { publishingOptions: { machineVerificationUrl: 'not-a-url' } },
        'machineVerificationUrl',
      ],
      ['malformed hreflang entry', { publishingOptions: { hreflang: ['en', 'en_US'] } }, 'hreflang'],
      ['hreflang entry repeating a variant', { publishingOptions: { hreflang: ['de-DE-1901-1901'] } }, 'hreflang'],
      [
        'hreflang entry repeating an extension singleton',
        { publishingOptions: { hreflang: ['en-a-bbb-a-ccc'] } },
        'hreflang',
      ],
      ['mistyped accessRole entry', { publishingOptions: { accessRole: ['not-a-role'] } }, 'accessRole'],
    ])('returns 400 naming the field for %s, and never attempts issuance', async (_label, overrides, fieldNamed) => {
      const req = createFakeRequest(validBody(overrides));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain(fieldNamed);
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('accepts a private-use BCP 47 hreflang tag (x-default)', async () => {
      const req = createFakeRequest(validBody({ publishingOptions: { hreflang: ['en-AU', 'x-default'] } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(res.status).toBe(201);
    });

    it('ignores unknown body fields rather than rejecting them', async () => {
      const req = createFakeRequest(validBody({ unknownExtraField: 'ignored' }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(res.status).toBe(201);
      expect(mockIssueCredential).toHaveBeenCalledTimes(1);
      const input = mockIssueCredential.mock.calls[0][0];
      expect(input).not.toHaveProperty('unknownExtraField');
    });
  });

  // ── SSRF validation ──────────────────────────────────────────────────

  describe('SSRF validation', () => {
    it('calls assertPublicUrl for machineVerificationUrl when SSRF protection enabled', async () => {
      delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
      mockAssertPublicUrl.mockResolvedValue(undefined);

      const req = createFakeRequest(
        validBody({
          publishingOptions: {
            machineVerificationUrl: 'https://verify.example.com/api',
          },
        }),
      );
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockAssertPublicUrl).toHaveBeenCalledWith(
        'https://verify.example.com/api',
        'publishingOptions.machineVerificationUrl',
      );
    });

    it('calls assertPublicUrl for humanVerificationUrl when SSRF protection enabled', async () => {
      delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
      mockAssertPublicUrl.mockResolvedValue(undefined);

      const req = createFakeRequest(
        validBody({
          publishingOptions: {
            humanVerificationUrl: 'https://verify.example.com/ui',
          },
        }),
      );
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockAssertPublicUrl).toHaveBeenCalledWith(
        'https://verify.example.com/ui',
        'publishingOptions.humanVerificationUrl',
      );
    });

    it('returns 400 when machineVerificationUrl is a private address', async () => {
      delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
      const { ValidationError: VE } = jest.requireActual('@/lib/api/validation');
      mockAssertPublicUrl.mockRejectedValue(
        new VE('publishingOptions.machineVerificationUrl must not point to a private or reserved network address'),
      );

      const req = createFakeRequest(
        validBody({
          publishingOptions: {
            machineVerificationUrl: 'http://127.0.0.1:3000/verify',
          },
        }),
      );
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('private or reserved');
    });

    it('skips the private-address SSRF check when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
      process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';

      const req = createFakeRequest(
        validBody({
          publishingOptions: {
            machineVerificationUrl: 'http://127.0.0.1:3000/verify',
            humanVerificationUrl: 'http://127.0.0.1:3000/ui',
          },
        }),
      );
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockAssertPublicUrl).not.toHaveBeenCalled();
    });

    it('rejects a non-http(s) humanVerificationUrl even when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
      process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';

      const req = createFakeRequest(
        validBody({ publishingOptions: { publish: true, humanVerificationUrl: 'ftp://verify.example.com/ui' } }),
      );
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/http\(s\)/);
      // The well-formedness/scheme check runs regardless of the SSRF flag, and
      // the private-address check is still skipped; nothing is issued.
      expect(mockAssertPublicUrl).not.toHaveBeenCalled();
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('rejects a malformed humanVerificationUrl even when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
      process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';

      const req = createFakeRequest(
        validBody({ publishingOptions: { publish: true, humanVerificationUrl: 'not a url' } }),
      );
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(res.status).toBe(400);
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('rejects a non-http(s) machineVerificationUrl even when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
      process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';

      const req = createFakeRequest(
        validBody({ publishingOptions: { publish: true, machineVerificationUrl: 'ftp://verify.example.com/api' } }),
      );
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/http\(s\)/);
      expect(mockAssertPublicUrl).not.toHaveBeenCalled();
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('rejects a malformed machineVerificationUrl even when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
      process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';

      const req = createFakeRequest(
        validBody({ publishingOptions: { publish: true, machineVerificationUrl: 'not a url' } }),
      );
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(res.status).toBe(400);
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('rejects a verification URL carrying userinfo, rather than publishing the credential in the link', async () => {
      process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';

      const human = createFakeRequest(
        validBody({
          publishingOptions: { publish: true, humanVerificationUrl: 'https://user:pass@verify.example.com/ui' },
        }),
      );
      const humanRes = await POST(human, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const humanJson = await humanRes.json();
      expect(humanRes.status).toBe(400);
      expect(humanJson.error).toMatch(/username or password/);

      const machine = createFakeRequest(
        validBody({
          publishingOptions: { publish: true, machineVerificationUrl: 'https://user:pass@verify.example.com/api' },
        }),
      );
      const machineRes = await POST(machine, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(machineRes.status).toBe(400);

      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('returns 400 when publishingOptions.hreflang is a string rather than an array', async () => {
      const req = createFakeRequest(validBody({ publishingOptions: { hreflang: 'en' as unknown as string[] } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/hreflang/);
    });

    it('returns 400 when publishingOptions.public is a string rather than a boolean', async () => {
      const req = createFakeRequest(validBody({ publishingOptions: { public: 'true' as unknown as boolean } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/public/);
    });

    it('returns 400 when publishingOptions.accessRole contains a value outside the UNTP vocabulary', async () => {
      const req = createFakeRequest(
        validBody({ publishingOptions: { accessRole: ['untp:accessRole#Anyone' as unknown as string] } }),
      );
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/accessRole/);
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('returns 400 when publishingOptions.additionalRels contains a non-string entry', async () => {
      const req = createFakeRequest(validBody({ publishingOptions: { additionalRels: [123 as unknown as string] } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/additionalRels/);
    });
  });

  // ── Data model resolution ────────────────────────────────────────────

  describe('data model resolution', () => {
    it('calls resolveDataModel with correct args', async () => {
      const req = createFakeRequest(validBody());
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveDataModel).toHaveBeenCalledWith('tenant-1', 'DigitalProductPassport', '0.6.1');
    });

    it('returns 400 when resolveDataModel throws ValidationError', async () => {
      const { ValidationError: VE } = jest.requireActual('@/lib/api/validation');
      mockResolveDataModel.mockRejectedValue(new VE('No data model found for Foo v1.0'));

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('No data model found');
    });
  });

  // ── Payload validation ──────────────────────────────────────────────

  describe('payload validation', () => {
    it('calls validateCredentialPayload with correct args', async () => {
      const req = createFakeRequest(validBody());
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockValidateCredentialPayload).toHaveBeenCalledWith(
        VALID_PAYLOAD,
        [DATA_MODEL.schemaUrl],
        expect.objectContaining({ load: expect.any(Function) }),
      );
    });

    it('returns 400 when validateCredentialPayload throws ValidationError', async () => {
      const { ValidationError: VE } = jest.requireActual('@/lib/api/validation');
      mockValidateCredentialPayload.mockRejectedValue(new VE('Schema validation failed'));

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Schema validation failed');
    });
  });

  // ── DID ownership validation ────────────────────────────────────────

  describe('DID ownership validation', () => {
    it('allows issuance when issuer DID belongs to the tenant', async () => {
      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(res.status).toBe(201);
      expect(mockGetDidByDid).toHaveBeenCalledWith('did:web:vckit.example.com:tenant-1', 'tenant-1');
    });

    it('allows issuance when issuer DID is a system default', async () => {
      mockGetDidByDid.mockResolvedValue({
        id: 'sys-did',
        did: 'did:web:vckit.example.com',
        type: 'DEFAULT',
        tenantId: 'system-tenant',
        serviceInstanceId: 'system-vc-instance',
      });

      const payload = {
        ...VALID_PAYLOAD,
        issuer: { type: ['CredentialIssuer'], id: 'did:web:vckit.example.com', name: 'System' },
      };
      const req = createFakeRequest(validBody({ credentialPayload: payload }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(res.status).toBe(201);
    });

    it('returns 400 when issuer DID does not belong to the tenant', async () => {
      mockGetDidByDid.mockResolvedValue(null);

      const payload = {
        ...VALID_PAYLOAD,
        issuer: { type: ['CredentialIssuer'], id: 'did:web:other-tenant.example.com', name: 'Other' },
      };
      const req = createFakeRequest(validBody({ credentialPayload: payload }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('not registered to your tenant');
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('returns 400 when issuer is missing from credential payload', async () => {
      const { issuer: _, ...payloadWithoutIssuer } = VALID_PAYLOAD;
      const req = createFakeRequest(validBody({ credentialPayload: payloadWithoutIssuer }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('credentialPayload.issuer.id is required');
    });

    it('returns 400 when issuer is an object without an id field', async () => {
      const payload = {
        ...VALID_PAYLOAD,
        issuer: { type: ['CredentialIssuer'], name: 'No ID Issuer' },
      };
      const req = createFakeRequest(validBody({ credentialPayload: payload }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('credentialPayload.issuer.id is required');
      expect(mockGetDidByDid).not.toHaveBeenCalled();
    });

    it('returns 500 when getDidByDid throws an unexpected error', async () => {
      mockGetDidByDid.mockRejectedValue(new Error('DB connection lost'));

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(res.status).toBe(500);
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('extracts issuer.id when issuer is a string', async () => {
      const payload = { ...VALID_PAYLOAD, issuer: 'did:web:vckit.example.com:tenant-1' };
      const req = createFakeRequest(validBody({ credentialPayload: payload }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockGetDidByDid).toHaveBeenCalledWith('did:web:vckit.example.com:tenant-1', 'tenant-1');
    });

    it('does not call service resolution when DID validation fails', async () => {
      mockGetDidByDid.mockResolvedValue(null);

      const payload = {
        ...VALID_PAYLOAD,
        issuer: { type: ['CredentialIssuer'], id: 'did:web:attacker.example.com', name: 'Attacker' },
      };
      const req = createFakeRequest(validBody({ credentialPayload: payload }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveVcService).not.toHaveBeenCalled();
      expect(mockResolveStorageService).not.toHaveBeenCalled();
    });

    it('resolves the VC service using the DID serviceInstanceId', async () => {
      const req = createFakeRequest(validBody());
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveVcService).toHaveBeenCalledWith('tenant-1', 'vc-1');
    });

    it('resolves the system DID VC service instance for system default DIDs', async () => {
      mockGetDidByDid.mockResolvedValue({
        id: 'sys-did',
        did: 'did:web:vckit.example.com',
        type: 'DEFAULT',
        tenantId: 'system-tenant',
        serviceInstanceId: 'system-vc-instance',
      });

      const payload = {
        ...VALID_PAYLOAD,
        issuer: { type: ['CredentialIssuer'], id: 'did:web:vckit.example.com', name: 'System' },
      };
      const req = createFakeRequest(validBody({ credentialPayload: payload }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveVcService).toHaveBeenCalledWith('tenant-1', 'system-vc-instance');
    });

    it('returns 400 when DID has no associated VC service instance', async () => {
      mockGetDidByDid.mockResolvedValue({
        id: 'did-1',
        did: 'did:web:vckit.example.com:tenant-1',
        tenantId: 'tenant-1',
        serviceInstanceId: null,
      });

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('has no associated VC service instance');
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });
  });

  // ── Service resolution ──────────────────────────────────────────────

  describe('service resolution', () => {
    it('resolves VC service using the DID serviceInstanceId by default', async () => {
      const req = createFakeRequest(validBody());
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveVcService).toHaveBeenCalledWith('tenant-1', 'vc-1');
    });

    it('passes storageOptions.serviceInstanceId to resolveStorageService', async () => {
      const req = createFakeRequest(validBody({ storageOptions: { serviceInstanceId: 'custom-storage' } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveStorageService).toHaveBeenCalledWith('tenant-1', 'custom-storage');
    });

    it('passes undefined when no storageOptions provided', async () => {
      const req = createFakeRequest(validBody());
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveStorageService).toHaveBeenCalledWith('tenant-1', undefined);
    });
  });

  // ── Credential issuance ─────────────────────────────────────────────

  describe('credential issuance', () => {
    it('calls issueCredential with correct input shape', async () => {
      const vcService = { service: {}, instanceId: 'vc-1' };
      const storageService = { service: {}, instanceId: 'storage-1' };
      mockResolveVcService.mockResolvedValue(vcService);
      mockResolveStorageService.mockResolvedValue(storageService);

      const req = createFakeRequest(validBody());
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockIssueCredential).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        credentialPayload: VALID_PAYLOAD,
        credentialType: 'DigitalProductPassport',
        coreDataModelVersion: '0.6.1',
        coreCredentialType: 'DPP',
        refs: { organisations: [], facilities: [], products: [] },
        vcService,
        storageService,
        storageOptions: {},
        bridge: stubBridge,
      });
    });

    it('passes the parent coreDataModelVersion through for an extension data model', async () => {
      mockResolveDataModel.mockResolvedValue({
        dataModel: { ...DATA_MODEL, isExtension: true, version: '1.2.0' },
        bridge: stubBridge,
        schemaUrls: [DATA_MODEL.schemaUrl],
        coreDataModelVersion: '0.6.0',
      });

      const req = createFakeRequest(validBody({ credentialType: 'DigitalLivestockPassport', version: '1.2.0' }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockIssueCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialType: 'DigitalLivestockPassport',
          coreDataModelVersion: '0.6.0',
        }),
      );
    });

    it('passes storageOptions through to issueCredential', async () => {
      const req = createFakeRequest(validBody({ storageOptions: { serviceInstanceId: 'store-1', encrypt: false } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockIssueCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          storageOptions: { serviceInstanceId: 'store-1', encrypt: false },
        }),
      );
    });

    it('returns 201 with credentialId from issueCredential result', async () => {
      mockIssueCredential.mockResolvedValue({
        credentialId: 'cred-42',
        storageResponse: STORAGE_RESPONSE,
        primaryEntity: {},
      });

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-42');
    });
  });

  // ── Publishing ──────────────────────────────────────────────────────

  describe('publishing', () => {
    const mockPublishLinks = jest.fn();

    function setupPublishingHappyPath(overrides: Record<string, unknown> = {}) {
      const defaults = {
        primaryIdentifier: '09506000134352',
        schemePrimaryKey: 'gtin',
        schemeNamespace: 'gs1',
        schemeIdrServiceInstanceId: 'idr-scheme-1',
        entityName: 'Test Product',
        entityDescription: 'A test product for E2E',
      };
      const primaryEntity = { ...defaults, ...overrides };

      // Publishing resolves its target from the identifier now, not the
      // entity; the entity remains only as the description source.
      mockResolvePublishTarget.mockResolvedValue({
        outcome: 'resolved',
        target: {
          identifierValue: '09506000134352',
          schemePrimaryKey: 'gtin',
          schemeNamespace: 'gs1',
          schemeIdrServiceInstanceId: 'idr-scheme-1',
          registrarIdrServiceInstanceId: null,
        },
      });

      mockIssueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        storageResponse: STORAGE_RESPONSE,
        primaryEntity,
      });

      mockResolveIdrService.mockResolvedValue({
        service: { publishLinks: mockPublishLinks, defaultLinkType: 'untp:dpp' },
        instanceId: 'idr-1',
      });

      mockBuildPublishLinks.mockReturnValue([
        {
          href: STORAGE_RESPONSE.uri,
          rel: 'gs1:sustainabilityInfo',
          type: 'application/json',
          title: 'Digital Product Passport',
        },
      ]);

      mockUpdateCredentialPublished.mockResolvedValue({});
    }

    it('forwards hreflang tags to the published links exactly as sent, without canonicalising them', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(
        validBody({
          publishingOptions: { publish: true, hreflang: ['EN-au', 'x-default', 'sl-rozaj-biske'] },
        }),
      );
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(res.status).toBe(201);

      // The schema validates well-formedness only: a tag that arrives with
      // non-canonical casing must be published as the caller sent it.
      const linkOptions = mockBuildPublishLinks.mock.calls[0][2];
      expect(linkOptions.hreflang).toEqual(['EN-au', 'x-default', 'sl-rozaj-biske']);
    });

    it.each([
      [
        'the payload carries no identifier',
        { outcome: 'no-reference' },
        'PUBLISH_REFERENCE_MISSING',
        'identifier fields',
      ],
      [
        'the identifier scheme is incomplete',
        { outcome: 'incomplete', value: '09506000134352' },
        'PUBLISH_SCHEME_INCOMPLETE',
        'primary key',
      ],
    ])(
      'warns with its own code and a remediation when %s',
      async (_label, resolution, expectedCode, remediationFragment) => {
        setupPublishingHappyPath();
        mockResolvePublishTarget.mockResolvedValue(resolution);

        const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
        const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
        const json = await res.json();

        expect(res.status).toBe(201);
        expect(json.credentialId).toBe('cred-1');
        const warning = (json.warnings as Array<{ code: string; remediation?: string }>).find(
          (w) => w.code === expectedCode,
        );
        expect(warning).toBeDefined();
        expect(warning?.remediation).toContain(remediationFragment);
        expect(mockPublishLinks).not.toHaveBeenCalled();
      },
    );

    it('warns PUBLISH_IDENTIFIER_AMBIGUOUS naming the colliding schemes rather than guessing', async () => {
      setupPublishingHappyPath();
      mockResolvePublishTarget.mockResolvedValue({
        outcome: 'ambiguous',
        value: '09506000134352',
        candidates: [
          { schemeId: 'scheme-1', schemeName: 'GS1 GTIN' },
          { schemeId: 'scheme-2', schemeName: 'Internal SKU' },
        ],
      });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      const warning = (json.warnings as Array<{ code: string; message: string; remediation?: string }>).find(
        (w) => w.code === 'PUBLISH_IDENTIFIER_AMBIGUOUS',
      );
      // The caller needs the scheme id the option takes, not just its name.
      expect(warning?.remediation).toContain('identifierSchemeId');
      expect(warning?.remediation).toContain('scheme-1');
      expect(warning?.remediation).toContain('GS1 GTIN');
      expect(mockPublishLinks).not.toHaveBeenCalled();
    });

    it('warns PUBLISH_IDENTIFIER_UNKNOWN when no identifier is registered for the value', async () => {
      setupPublishingHappyPath();
      mockResolvePublishTarget.mockResolvedValue({ outcome: 'not-found', value: '09506000134352' });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      const warning = (json.warnings as Array<{ code: string; remediation?: string }>).find(
        (w) => w.code === 'PUBLISH_IDENTIFIER_UNKNOWN',
      );
      expect(warning?.remediation).toContain('Register the identifier');
      expect(mockPublishLinks).not.toHaveBeenCalled();
    });

    it('warns ENTITY_LINK_FAILED when the credential was stored without its entity links', async () => {
      setupPublishingHappyPath();
      mockIssueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        storageResponse: STORAGE_RESPONSE,
        primaryEntity: {
          primaryIdentifier: '09506000134352',
          schemePrimaryKey: 'gtin',
          schemeNamespace: 'gs1',
          schemeIdrServiceInstanceId: 'idr-scheme-1',
          entityName: 'Test Product',
        },
        entityLinkFailed: true,
      });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-1');
      const warning = (json.warnings as Array<{ code: string; remediation?: string }>).find(
        (w) => w.code === 'ENTITY_LINK_FAILED',
      );
      expect(warning).toBeDefined();
      expect(warning?.remediation).toContain('master-data');
      // Linking is enrichment: its failure must not stop the publish.
      expect(mockPublishLinks).toHaveBeenCalledTimes(1);
    });

    it('warns DETAILS_EXTRACTION_FAILED when the credential was issued but could not be read back', async () => {
      setupPublishingHappyPath();
      mockIssueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        storageResponse: STORAGE_RESPONSE,
        primaryEntity: {
          primaryIdentifier: '09506000134352',
          schemePrimaryKey: 'gtin',
          schemeNamespace: 'gs1',
          schemeIdrServiceInstanceId: 'idr-scheme-1',
          entityName: 'Test Product',
        },
        entityLinkFailed: false,
        detailsExtractionFailed: true,
      });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-1');
      const warning = (json.warnings as Array<{ code: string; remediation?: string }>).find(
        (w) => w.code === 'DETAILS_EXTRACTION_FAILED',
      );
      expect(warning).toBeDefined();
      // The caller is given the correlation ID itself, so they can quote it
      // without having to read it off a response header.
      expect(warning?.remediation).toMatch(/Quote correlation ID [0-9a-f-]{8}/i);
      // Reading the descriptive fields is enrichment: publishing carries on.
      expect(mockPublishLinks).toHaveBeenCalledTimes(1);
    });

    it('warns ENTITY_LINK_FAILED even when publishing was not requested', async () => {
      // Entity linking is enrichment in its own right (ADR-044 decision 4), so
      // the warning does not belong to the publish branch.
      setupPublishingHappyPath();
      mockIssueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        storageResponse: STORAGE_RESPONSE,
        primaryEntity: {},
        entityLinkFailed: true,
      });

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect((json.warnings as Array<{ code: string }>).map((w) => w.code)).toContain('ENTITY_LINK_FAILED');
      expect(mockPublishLinks).not.toHaveBeenCalled();
    });

    it('warns PUBLISH_TARGET_UNRESOLVED instead of losing the credential when the lookup itself fails', async () => {
      setupPublishingHappyPath();
      mockResolvePublishTarget.mockRejectedValue(new Error('connection lost'));

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-1');
      expect((json.warnings as Array<{ code: string }>).map((w) => w.code)).toContain('PUBLISH_TARGET_UNRESOLVED');
    });

    it('distinguishes a resolver rejection from an unconfirmed publish, and never leaks the upstream body', async () => {
      setupPublishingHappyPath();
      const rejection = new RealIdrPublishError(
        'gtin',
        '09520123456788',
        409,
        '{"detail":"duplicate response for /gtin/095"}',
      );
      mockPublishLinks.mockRejectedValueOnce(rejection);

      let res = await POST(
        createFakeRequest(validBody({ publishingOptions: { publish: true } })),
        AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
      );
      let json = await res.json();
      let warning = (json.warnings as Array<{ code: string; message: string }>).find((w) =>
        w.code.startsWith('IDR_PUBLISH'),
      );
      expect(warning?.code).toBe('IDR_PUBLISH_FAILED');
      expect(warning?.message).not.toContain('duplicate response');
      expect(warning?.message).not.toContain('409');

      // A transport failure may have committed upstream, so it must not be
      // reported as a confirmed rejection nor invite a blind retry.
      mockPublishLinks.mockRejectedValueOnce(new Error('socket hang up'));
      res = await POST(
        createFakeRequest(validBody({ publishingOptions: { publish: true } })),
        AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
      );
      json = await res.json();
      warning = (json.warnings as Array<{ code: string; message: string; remediation?: string }>).find((w) =>
        w.code.startsWith('IDR_PUBLISH'),
      );
      expect(warning?.code).toBe('IDR_PUBLISH_UNCONFIRMED');
      expect((warning as { remediation?: string }).remediation).toContain('duplicate');

      // A resolver 5xx may still have committed, so it is unknown, not refused.
      mockPublishLinks.mockRejectedValueOnce(
        new RealIdrPublishError('gtin', '09520123456788', 503, 'upstream unavailable'),
      );
      res = await POST(
        createFakeRequest(validBody({ publishingOptions: { publish: true } })),
        AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
      );
      json = await res.json();
      warning = (json.warnings as Array<{ code: string; message: string }>).find((w) =>
        w.code.startsWith('IDR_PUBLISH'),
      );
      expect(warning?.code).toBe('IDR_PUBLISH_UNCONFIRMED');
    });

    it('warns PUBLISH_IDR_UNAVAILABLE and still returns the credential when no IDR service resolves', async () => {
      setupPublishingHappyPath();
      // Previously this threw and destroyed the response for a credential that
      // had already been signed and stored (ADR-044 decision 2).
      mockResolveIdrService.mockRejectedValue(new Error('No service instance available for IDR'));

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-1');
      const warning = (json.warnings as Array<{ code: string; remediation?: string }>).find(
        (w) => w.code === 'PUBLISH_IDR_UNAVAILABLE',
      );
      expect(warning).toBeDefined();
      expect(warning?.remediation).toContain('identity resolver');
      expect(mockPublishLinks).not.toHaveBeenCalled();
    });

    it('warns DB_STATUS_UPDATE_FAILED with a remediation when the status write fails after a successful publish', async () => {
      setupPublishingHappyPath();
      mockUpdateCredentialPublished.mockRejectedValue(new Error('connection lost'));

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(mockPublishLinks).toHaveBeenCalledTimes(1);
      const warning = (json.warnings as Array<{ code: string; remediation?: string }>).find(
        (w) => w.code === 'DB_STATUS_UPDATE_FAILED',
      );
      expect(warning).toBeDefined();
      expect(warning?.remediation).toContain('discoverable');
    });

    it('every publish warning carries a remediation the caller can act on', async () => {
      setupPublishingHappyPath();
      mockResolvePublishTarget.mockResolvedValue({ outcome: 'incomplete', value: '09506000134352' });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      const publishWarnings = (json.warnings as Array<{ code: string; remediation?: string }>).filter((w) =>
        w.code.startsWith('PUBLISH_'),
      );
      expect(publishWarnings.length).toBeGreaterThan(0);
      for (const warning of publishWarnings) {
        expect(warning.remediation).toEqual(expect.any(String));
      }
    });

    it('does not add a publish-prerequisite warning when refs extraction already failed', async () => {
      setupPublishingHappyPath();
      const failingBridge = {
        buildSubject: jest.fn().mockReturnValue({}),
        extractRefs: jest.fn().mockImplementation(() => {
          throw new Error('bad subject');
        }),
      };
      mockResolveDataModel.mockResolvedValue({
        dataModel: DATA_MODEL,
        bridge: failingBridge,
        schemaUrls: [DATA_MODEL.schemaUrl],
        coreDataModelVersion: '0.6.1',
      });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      const codes = ((json.warnings ?? []) as Array<{ code: string }>).map((w) => w.code);
      expect(codes).toContain('REFS_EXTRACTION_FAILED');
      expect(codes).not.toContain('PUBLISH_SCHEME_INCOMPLETE');
    });

    it('publishes to IDR when publish=true and entity has scheme config', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      // Scheme, then registrar, then tenant/system default, matching the
      // identifier-links route (ADR-044).
      expect(mockResolveIdrService).toHaveBeenCalledWith('tenant-1', 'idr-scheme-1', null);

      // buildPublishLinks called with storage response, link title, and options.
      // humanVerificationUrl defaults to `${RI_APP_URL}/verify` (RI_APP_URL is
      // set to http://localhost:3003 in beforeEach) since none was supplied.
      expect(mockBuildPublishLinks).toHaveBeenCalledWith(STORAGE_RESPONSE, 'Digital Product Passport', {
        linkType: 'untp:dpp',
        machineVerificationUrl: undefined,
        humanVerificationUrl: 'http://localhost:3003/verify',
      });

      // idrService.publishLinks called
      expect(mockPublishLinks).toHaveBeenCalledWith('gtin', '09506000134352', expect.any(Array), '/', {
        namespace: 'gs1',
        description: 'A test product for E2E',
      });

      // updateCredentialPublished called
      expect(mockUpdateCredentialPublished).toHaveBeenCalledWith('cred-1', 'tenant-1', true);
    });

    it('ignores publishingOptions.serviceInstanceId (IDR determined by resolution chain)', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(
        validBody({ publishingOptions: { publish: true, serviceInstanceId: 'explicit-idr' } }),
      );
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      // serviceInstanceId should be ignored — resolveIdrService called with scheme IDR only
      expect(mockResolveIdrService).toHaveBeenCalledWith('tenant-1', 'idr-scheme-1', null);
    });

    it('uses publishingOptions.linkTitle override when provided', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true, linkTitle: 'Custom Title' } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockBuildPublishLinks).toHaveBeenCalledWith(STORAGE_RESPONSE, 'Custom Title', expect.any(Object));

      expect(mockPublishLinks).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        '/',
        expect.objectContaining({ description: 'A test product for E2E' }),
      );
    });

    it('falls back to dataModel.name for linkTitle when not provided', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockBuildPublishLinks).toHaveBeenCalledWith(
        STORAGE_RESPONSE,
        'Digital Product Passport',
        expect.any(Object),
      );
    });

    it('passes machineVerificationUrl and humanVerificationUrl to buildPublishLinks', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(
        validBody({
          publishingOptions: {
            publish: true,
            machineVerificationUrl: 'https://verify.example.com/api',
            humanVerificationUrl: 'https://verify.example.com/ui',
          },
        }),
      );
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockBuildPublishLinks).toHaveBeenCalledWith(STORAGE_RESPONSE, 'Digital Product Passport', {
        linkType: 'untp:dpp',
        machineVerificationUrl: 'https://verify.example.com/api',
        humanVerificationUrl: 'https://verify.example.com/ui',
      });
    });

    it('publishes the canonical machine verification URL, not the raw ambiguous caller string', async () => {
      setupPublishingHappyPath();

      // `https://1.1.1.1\@127.0.0.1/` parses (WHATWG) as host 1.1.1.1, but a
      // different parser reads the raw string as host 127.0.0.1. Publishing the
      // canonical href keeps validation and publication on the same host.
      const req = createFakeRequest(
        validBody({ publishingOptions: { publish: true, machineVerificationUrl: 'https://1.1.1.1\\@127.0.0.1/' } }),
      );
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockBuildPublishLinks).toHaveBeenCalledWith(
        STORAGE_RESPONSE,
        'Digital Product Passport',
        expect.objectContaining({ machineVerificationUrl: 'https://1.1.1.1/@127.0.0.1/' }),
      );
    });

    it('SSRF-checks the canonical machine URL, not the raw string, when protection is enabled', async () => {
      delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
      setupPublishingHappyPath();
      mockAssertPublicUrl.mockResolvedValue(undefined);

      const req = createFakeRequest(
        validBody({ publishingOptions: { publish: true, machineVerificationUrl: 'https://1.1.1.1\\@127.0.0.1/' } }),
      );
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      // The private-address check sees the same canonical host that is published,
      // so it cannot be fooled by a raw string a different parser reads as 127.0.0.1.
      expect(mockAssertPublicUrl).toHaveBeenCalledWith(
        'https://1.1.1.1/@127.0.0.1/',
        'publishingOptions.machineVerificationUrl',
      );
    });

    // ── humanVerificationUrl default (issue #491) ──────────────────────

    describe('human verification URL default', () => {
      it('defaults humanVerificationUrl to `${RI_APP_URL}/verify` when publishing without one', async () => {
        setupPublishingHappyPath();
        process.env.RI_APP_URL = 'https://ri.example.com';

        const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
        await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

        expect(mockBuildPublishLinks).toHaveBeenCalledWith(
          STORAGE_RESPONSE,
          'Digital Product Passport',
          expect.objectContaining({ humanVerificationUrl: 'https://ri.example.com/verify' }),
        );
      });

      it('preserves a base path on RI_APP_URL and trims its trailing slash', async () => {
        setupPublishingHappyPath();
        process.env.RI_APP_URL = 'https://ri.example.com/app/';

        const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
        await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

        expect(mockBuildPublishLinks).toHaveBeenCalledWith(
          STORAGE_RESPONSE,
          'Digital Product Passport',
          expect.objectContaining({ humanVerificationUrl: 'https://ri.example.com/app/verify' }),
        );
      });

      it('drops a query string on RI_APP_URL rather than appending after it', async () => {
        setupPublishingHappyPath();
        process.env.RI_APP_URL = 'https://ri.example.com?tenant=1';

        const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
        await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

        expect(mockBuildPublishLinks).toHaveBeenCalledWith(
          STORAGE_RESPONSE,
          'Digital Product Passport',
          expect.objectContaining({ humanVerificationUrl: 'https://ri.example.com/verify' }),
        );
      });

      it('drops a fragment on RI_APP_URL rather than appending after it', async () => {
        setupPublishingHappyPath();
        process.env.RI_APP_URL = 'https://ri.example.com#section';

        const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
        await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

        expect(mockBuildPublishLinks).toHaveBeenCalledWith(
          STORAGE_RESPONSE,
          'Digital Product Passport',
          expect.objectContaining({ humanVerificationUrl: 'https://ri.example.com/verify' }),
        );
      });

      it('preserves an explicit humanVerificationUrl over the RI_APP_URL default', async () => {
        setupPublishingHappyPath();
        process.env.RI_APP_URL = 'https://ri.example.com';

        const req = createFakeRequest(
          validBody({
            publishingOptions: { publish: true, humanVerificationUrl: 'https://verify.example.com/ui' },
          }),
        );
        await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

        expect(mockBuildPublishLinks).toHaveBeenCalledWith(
          STORAGE_RESPONSE,
          'Digital Product Passport',
          expect.objectContaining({ humanVerificationUrl: 'https://verify.example.com/ui' }),
        );
      });

      it('does not SSRF-check the derived localhost default', async () => {
        setupPublishingHappyPath();
        delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
        process.env.RI_APP_URL = 'http://localhost:3003';
        mockAssertPublicUrl.mockResolvedValue(undefined);

        const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
        const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

        expect(res.status).toBe(201);
        // No explicit URL was supplied, and the trusted default is not guarded.
        expect(mockAssertPublicUrl).not.toHaveBeenCalled();
        expect(mockBuildPublishLinks).toHaveBeenCalledWith(
          STORAGE_RESPONSE,
          'Digital Product Passport',
          expect.objectContaining({ humanVerificationUrl: 'http://localhost:3003/verify' }),
        );
      });

      it('uses an explicit humanVerificationUrl even when RI_APP_URL is unset', async () => {
        setupPublishingHappyPath();
        delete process.env.RI_APP_URL;

        const req = createFakeRequest(
          validBody({
            publishingOptions: { publish: true, humanVerificationUrl: 'https://verify.example.com/ui' },
          }),
        );
        const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

        expect(res.status).toBe(201);
        expect(mockBuildPublishLinks).toHaveBeenCalledWith(
          STORAGE_RESPONSE,
          'Digital Product Passport',
          expect.objectContaining({ humanVerificationUrl: 'https://verify.example.com/ui' }),
        );
      });

      it('does not require RI_APP_URL when publish is false', async () => {
        setupPublishingHappyPath();
        delete process.env.RI_APP_URL;

        const req = createFakeRequest(validBody({ publishingOptions: { publish: false } }));
        const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

        expect(res.status).toBe(201);
        expect(mockBuildPublishLinks).not.toHaveBeenCalled();
      });
    });

    it('passes hreflang, additionalRels, and public to buildPublishLinks', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(
        validBody({
          publishingOptions: {
            publish: true,
            hreflang: ['en', 'de'],
            additionalRels: ['gs1:certificationInfo'],
            public: true,
          },
        }),
      );
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockBuildPublishLinks).toHaveBeenCalledWith(
        STORAGE_RESPONSE,
        'Digital Product Passport',
        expect.objectContaining({
          hreflang: ['en', 'de'],
          additionalRels: ['gs1:certificationInfo'],
          public: true,
        }),
      );
    });

    it('omits hreflang, additionalRels, and public from buildPublishLinks options when unset', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      const optionsArg = mockBuildPublishLinks.mock.calls[0][2];
      expect(optionsArg).not.toHaveProperty('hreflang');
      expect(optionsArg).not.toHaveProperty('additionalRels');
      expect(optionsArg).not.toHaveProperty('public');
    });

    it("defaults linkType to the IDR service's configured default and lets an explicit one win", async () => {
      setupPublishingHappyPath();

      const omitted = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(omitted, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(mockBuildPublishLinks.mock.calls[0][2].linkType).toBe('untp:dpp');

      mockBuildPublishLinks.mockClear();
      setupPublishingHappyPath();

      const explicit = createFakeRequest(
        validBody({ publishingOptions: { publish: true, linkType: 'gs1:certificationInfo' } }),
      );
      await POST(explicit, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(mockBuildPublishLinks.mock.calls[0][2].linkType).toBe('gs1:certificationInfo');
    });

    it('passes accessRole to buildPublishLinks and omits it when unset', async () => {
      setupPublishingHappyPath();

      const withRoles = createFakeRequest(
        validBody({
          publishingOptions: { publish: true, accessRole: ['untp:accessRole#Regulator', 'untp:accessRole#Auditor'] },
        }),
      );
      await POST(withRoles, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockBuildPublishLinks).toHaveBeenCalledWith(
        STORAGE_RESPONSE,
        'Digital Product Passport',
        expect.objectContaining({ accessRole: ['untp:accessRole#Regulator', 'untp:accessRole#Auditor'] }),
      );

      mockBuildPublishLinks.mockClear();
      setupPublishingHappyPath();

      const withoutRoles = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(withoutRoles, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockBuildPublishLinks.mock.calls[0][2]).not.toHaveProperty('accessRole');
    });

    it('round-trips publishingOptions.public: false distinctly from unset', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true, public: false } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      const optionsArg = mockBuildPublishLinks.mock.calls[0][2];
      expect(optionsArg.public).toBe(false);
    });

    it('passes qualifierPath to publishLinks when provided', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(
        validBody({ publishingOptions: { publish: true, qualifierPath: '/10/LOT123/21/SER456' } }),
      );
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockPublishLinks).toHaveBeenCalledWith(
        'gtin',
        '09506000134352',
        expect.any(Array),
        '/10/LOT123/21/SER456',
        expect.objectContaining({ namespace: 'gs1' }),
      );
    });

    it('defaults qualifierPath to / when not provided', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockPublishLinks).toHaveBeenCalledWith(
        'gtin',
        '09506000134352',
        expect.any(Array),
        '/',
        expect.objectContaining({ namespace: 'gs1' }),
      );
    });

    it('skips publishing when publish not requested', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(validBody());
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveIdrService).not.toHaveBeenCalled();
      expect(mockPublishLinks).not.toHaveBeenCalled();
      expect(mockUpdateCredentialPublished).not.toHaveBeenCalled();
    });

    it('publishes from the identifier even when no master-data entity matched', async () => {
      // The decoupling this ADR makes: an identifier with no entity record
      // used to skip publishing entirely (#738's misdirection).
      setupPublishingHappyPath();
      mockIssueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        storageResponse: STORAGE_RESPONSE,
        primaryEntity: {},
        entityLinkFailed: false,
      });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(res.status).toBe(201);
      expect(mockPublishLinks).toHaveBeenCalledTimes(1);
      expect(mockUpdateCredentialPublished).toHaveBeenCalledTimes(1);
      // With no entity to describe it, the link title is the description.
      expect(mockPublishLinks.mock.calls[0][4]).toEqual(
        expect.objectContaining({ description: 'Digital Product Passport' }),
      );
    });

    it('issues credential with IDR_PUBLISH_FAILED warning when publishLinks throws', async () => {
      setupPublishingHappyPath();
      mockPublishLinks.mockRejectedValueOnce(new Error('scheme not registered'));

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-1');
      // A plain Error is not a stated resolver rejection, so the outcome is
      // unconfirmed rather than failed, and the upstream text stays in the log.
      expect(json.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'IDR_PUBLISH_UNCONFIRMED' })]),
      );
      expect(JSON.stringify(json.warnings)).not.toContain('scheme not registered');
    });

    it('does not mark credential as published when publishLinks throws', async () => {
      setupPublishingHappyPath();
      mockPublishLinks.mockRejectedValueOnce(new Error('IDR unavailable'));

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockUpdateCredentialPublished).not.toHaveBeenCalled();
    });

    it('uses the registrar IDR instance when the scheme carries none', async () => {
      setupPublishingHappyPath();
      mockResolvePublishTarget.mockResolvedValue({
        outcome: 'resolved',
        target: {
          identifierValue: '09506000134352',
          schemePrimaryKey: 'gtin',
          schemeNamespace: 'gs1',
          schemeIdrServiceInstanceId: null,
          registrarIdrServiceInstanceId: 'idr-registrar-1',
        },
      });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveIdrService).toHaveBeenCalledWith('tenant-1', null, 'idr-registrar-1');
    });
  });

  // ── Error propagation ─────────────────────────────────────────────────

  describe('error propagation', () => {
    it('returns 404 when an explicitly requested service instance no longer exists', async () => {
      const { ServiceInstanceNotFoundError } = jest.requireActual('@/lib/api/errors');
      mockResolveStorageService.mockRejectedValue(new ServiceInstanceNotFoundError('STORAGE', 'missing-instance'));

      const req = createFakeRequest(validBody({ storageOptions: { serviceInstanceId: 'missing-instance' } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(res.status).toBe(404);
    });

    it('returns 500 when issueCredential throws', async () => {
      mockIssueCredential.mockRejectedValue(new Error('Signing service unavailable'));

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain('Signing service unavailable');
    });
  });

  // ── Conformity claim validation (advisory) ──────────────────────────────
  describe('conformity claim validation', () => {
    const CLAIM = {
      scheme: 'https://example.com',
      profile: 'https://example.com/rra/v3.0',
      criteria: [{ criterion: 'https://example.com/rra/v3.0/criterion/26' }],
    };
    const SCHEME = { canonicalId: 'https://example.com', profiles: [] };
    // The extractor's map from claim pointers to paths in the submitted
    // credentialSubject; the route substitutes these before responding (#753).
    const SOURCE_MAP = { '/criteria/0/criterion': '/conformityAssessment/0/assessmentCriteria/0/id' };
    const EXTRACTED = { claim: CLAIM, sourceMap: SOURCE_MAP };

    it('validates the extracted claim against the resolved scheme and attaches no warnings on a clean match', async () => {
      stubBridge.extractConformityClaimWithProvenance.mockReturnValue(EXTRACTED);
      mockFindConformityScheme.mockResolvedValue(SCHEME);
      mockValidateConformityClaim.mockReturnValue([]);

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(mockFindConformityScheme).toHaveBeenCalledWith('https://example.com', 'tenant-1');
      expect(mockValidateConformityClaim).toHaveBeenCalledWith(CLAIM, SCHEME);
      expect(json.warnings).toBeUndefined();
    });

    it('attaches the validator warnings (with structured detail) to the response', async () => {
      stubBridge.extractConformityClaimWithProvenance.mockReturnValue(EXTRACTED);
      mockFindConformityScheme.mockResolvedValue(SCHEME);
      mockValidateConformityClaim.mockReturnValue([
        {
          code: 'conformity-criterion.not-in-profile',
          message: 'Criterion is not published by the profile.',
          received: 'https://example.com/rra/v3.0/criterion/26',
          pointer: '/criteria/0/criterion',
        },
      ]);

      // The payload has to carry the path the source map names, since a
      // remapped pointer is kept only once it resolves in the submitted
      // document.
      const req = createFakeRequest(
        validBody({
          credentialPayload: {
            ...VALID_PAYLOAD,
            credentialSubject: {
              id: 'urn:example:product:123',
              conformityAssessment: [{ assessmentCriteria: [{ id: 'https://example.com/rra/v3.0/criterion/26' }] }],
            },
          },
        }),
      );
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.warnings).toEqual([
        {
          code: 'conformity-criterion.not-in-profile',
          message: 'Criterion is not published by the profile.',
          received: 'https://example.com/rra/v3.0/criterion/26',
          // Resolves in the submitted credential, not the extracted claim.
          pointer: '/credentialSubject/conformityAssessment/0/assessmentCriteria/0/id',
        },
      ]);
    });

    it('drops a pointer the extractor recorded no source path for', async () => {
      // `/criteria` is the missing-criterion warning: its subject is absent
      // from the document, so no pointer can resolve and none is returned.
      stubBridge.extractConformityClaimWithProvenance.mockReturnValue(EXTRACTED);
      mockFindConformityScheme.mockResolvedValue(SCHEME);
      mockValidateConformityClaim.mockReturnValue([
        { code: 'conformity-criterion.missing', message: 'Profile criterion is not claimed.', pointer: '/criteria' },
      ]);

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.warnings[0]).not.toHaveProperty('pointer');
      expect(json.warnings[0].code).toBe('conformity-criterion.missing');
    });

    it('passes a null scheme to the validator when the scheme URI is unknown', async () => {
      stubBridge.extractConformityClaimWithProvenance.mockReturnValue(EXTRACTED);
      mockFindConformityScheme.mockResolvedValue(null);
      mockValidateConformityClaim.mockReturnValue([
        { code: 'conformity-scheme.not-found', message: 'Scheme URI is not in the known set.' },
      ]);

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(mockValidateConformityClaim).toHaveBeenCalledWith(CLAIM, null);
      expect(json.warnings[0].code).toBe('conformity-scheme.not-found');
    });

    it('skips validation entirely when the credential carries no conformity claim', async () => {
      stubBridge.extractConformityClaimWithProvenance.mockReturnValue(null);

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(mockFindConformityScheme).not.toHaveBeenCalled();
      expect(mockValidateConformityClaim).not.toHaveBeenCalled();
      expect(json.warnings).toBeUndefined();
    });

    it('never blocks issuance: emits an advisory warning when extraction throws', async () => {
      stubBridge.extractConformityClaimWithProvenance.mockImplementation(() => {
        throw new Error('boom');
      });

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.warnings).toEqual([expect.objectContaining({ code: 'conformity-claim.validation-error' })]);
    });

    it('never blocks issuance: degrades to an advisory warning when the scheme lookup rejects', async () => {
      stubBridge.extractConformityClaimWithProvenance.mockReturnValue(EXTRACTED);
      mockFindConformityScheme.mockRejectedValue(new Error('db down'));

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.warnings).toEqual([expect.objectContaining({ code: 'conformity-claim.validation-error' })]);
    });

    it('never blocks issuance: degrades to an advisory warning when the validator throws', async () => {
      stubBridge.extractConformityClaimWithProvenance.mockReturnValue(EXTRACTED);
      mockFindConformityScheme.mockResolvedValue(SCHEME);
      mockValidateConformityClaim.mockImplementation(() => {
        throw new Error('validator blew up');
      });

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.warnings).toEqual([expect.objectContaining({ code: 'conformity-claim.validation-error' })]);
    });
  });

  describe('idempotency', () => {
    const KEY = 'pipeline-retry-1';
    const KEY_HEADER = { 'Idempotency-Key': KEY };
    const RESPONSE_NOT_RECORDED = {
      code: 'IDEMPOTENCY_RESPONSE_NOT_RECORDED',
      message:
        'The credential was issued and a retry with this key returns it, but the warnings on this response may not be repeated.',
      remediation: 'A retry with this key returns this credential. The warnings on this response may differ.',
    };

    it('digests the raw request bytes, so equal JSON with different whitespace is a different body', async () => {
      // The claim is keyed on the bytes as received. If the digest were taken
      // over the parsed object, these two requests would collide as a replay
      // and the second would silently return the first credential.
      const compact = JSON.stringify(validBody());
      const spaced = JSON.stringify(validBody(), null, 2);
      await POST(
        createFakeRequest(undefined, KEY_HEADER, compact),
        AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
      );
      await POST(
        createFakeRequest(undefined, KEY_HEADER, spaced),
        AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
      );

      const [first, second] = mockFindIdempotencyKey.mock.calls.map((call) => call[0].bodyDigest);
      expect(first).not.toBe(second);
    });

    it('accepts a BOM-prefixed body and digests it differently from the same body without a BOM', async () => {
      const body = JSON.stringify(validBody());
      const plain = await POST(
        createFakeRequest(undefined, KEY_HEADER, body),
        AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
      );
      const withBom = await POST(
        createFakeRequest(undefined, KEY_HEADER, `\uFEFF${body}`),
        AUTH_CONTEXT as unknown as Parameters<typeof POST>[1],
      );

      expect(plain.status).toBe(201);
      expect(withBom.status).toBe(201);
      const [first, second] = mockFindIdempotencyKey.mock.calls.map((call) => call[0].bodyDigest);
      expect(first).not.toBe(second);
    });

    it('returns 400 naming the body read, not the JSON, when the body cannot be read', async () => {
      const req = {
        method: 'POST',
        url: 'http://localhost/api/v1/credentials',
        headers: new Headers({ 'Content-Type': 'application/json', ...KEY_HEADER }),
        body: {
          getReader() {
            return {
              async read() {
                throw new Error('stream interrupted');
              },
              async cancel() {},
            };
          },
        },
        arrayBuffer: async () => {
          throw new Error('stream interrupted');
        },
        text: async () => {
          throw new Error('stream interrupted');
        },
      } as unknown as Request;

      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Could not read the request body');
      expect(mockFindIdempotencyKey).not.toHaveBeenCalled();
      expect(mockResolveDataModel).not.toHaveBeenCalled();
    });

    it('does not claim when no Idempotency-Key header is supplied', async () => {
      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(res.status).toBe(201);
      expect(mockFindIdempotencyKey).not.toHaveBeenCalled();
      expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
      expect(mockCompleteIdempotencyKey).not.toHaveBeenCalled();
      expect(mockReleaseIdempotencyKey).not.toHaveBeenCalled();
      expect(mockIssueCredential).toHaveBeenCalledTimes(1);
      expect(mockIssueCredential.mock.calls[0][0].idempotencyClaimId).toBeUndefined();
    });

    it('replays a stored 201 without warnings and never validates or issues', async () => {
      mockFindIdempotencyKey.mockResolvedValue({
        outcome: 'replay',
        recordId: 'cred-original',
        responseBody: null,
      });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json).toEqual({ credentialId: 'cred-original' });
      expect(mockResolveDataModel).not.toHaveBeenCalled();
      expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('replays a stored 201 with warnings and never validates or issues', async () => {
      const warnings = [{ code: 'ENTITY_LINK_FAILED', message: 'gone' }];
      mockFindIdempotencyKey.mockResolvedValue({
        outcome: 'replay',
        recordId: 'cred-original',
        responseBody: warnings,
      });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json).toEqual({ credentialId: 'cred-original', warnings });
      expect(mockResolveDataModel).not.toHaveBeenCalled();
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('omits warnings on replay when the stored list is empty', async () => {
      mockFindIdempotencyKey.mockResolvedValue({
        outcome: 'replay',
        recordId: 'cred-original',
        responseBody: [],
      });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json).toEqual({ credentialId: 'cred-original' });
      expect(mockResolveDataModel).not.toHaveBeenCalled();
    });

    it('rejects a mismatched body with 422 IDEMPOTENCY_KEY_MISMATCH before validation', async () => {
      mockFindIdempotencyKey.mockResolvedValue({ outcome: 'mismatch' });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(422);
      expect(json).toEqual({
        error: 'This Idempotency-Key was already used with a different request body.',
        code: 'IDEMPOTENCY_KEY_MISMATCH',
      });
      expect(mockResolveDataModel).not.toHaveBeenCalled();
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('rejects an in-flight key with 409 IDEMPOTENCY_KEY_IN_FLIGHT before validation', async () => {
      mockFindIdempotencyKey.mockResolvedValue({ outcome: 'in-flight' });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json).toEqual({
        error: 'A request with this Idempotency-Key is still being processed. Retry shortly.',
        code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
      });
      expect(mockResolveDataModel).not.toHaveBeenCalled();
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('rejects with 422 when the claim, made after validation, finds a mismatched body', async () => {
      mockFindIdempotencyKey.mockResolvedValue({ outcome: 'absent' });
      mockClaimIdempotencyKey.mockResolvedValue({ outcome: 'mismatch' });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(422);
      expect(json).toEqual({
        error: 'This Idempotency-Key was already used with a different request body.',
        code: 'IDEMPOTENCY_KEY_MISMATCH',
      });
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('rejects with 409 when the claim, made after validation, finds the key in flight', async () => {
      mockFindIdempotencyKey.mockResolvedValue({ outcome: 'absent' });
      mockClaimIdempotencyKey.mockResolvedValue({ outcome: 'in-flight' });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json).toEqual({
        error: 'A request with this Idempotency-Key is still being processed. Retry shortly.',
        code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
      });
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('replays without issuing when the claim, made after validation, finds a recorded result', async () => {
      const warnings = [{ code: 'ENTITY_LINK_FAILED', message: 'gone' }];
      mockFindIdempotencyKey.mockResolvedValue({ outcome: 'absent' });
      mockClaimIdempotencyKey.mockResolvedValue({
        outcome: 'replay',
        recordId: 'cred-original',
        responseBody: warnings,
      });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json).toEqual({ credentialId: 'cred-original', warnings });
      expect(mockIssueCredential).not.toHaveBeenCalled();
      expect(mockCompleteIdempotencyKey).not.toHaveBeenCalled();
    });

    it('appends IDEMPOTENCY_RESPONSE_UNREADABLE when a replayed response body could not be read', async () => {
      mockFindIdempotencyKey.mockResolvedValue({
        outcome: 'replay',
        recordId: 'cred-original',
        responseBody: null,
        responseBodyUnreadable: true,
      });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-original');
      expect(json.warnings).toEqual([expect.objectContaining({ code: 'IDEMPOTENCY_RESPONSE_UNREADABLE' })]);
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('releases the claim and still surfaces the original error when issuance fails after claim', async () => {
      mockIssueCredential.mockRejectedValue(new Error('Signing service unavailable'));

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(mockClaimIdempotencyKey).toHaveBeenCalledTimes(1);
      expect(mockReleaseIdempotencyKey).toHaveBeenCalledWith({ claimId: 'claim-1' });
      expect(res.status).toBe(500);
      expect(json.error).toContain('Signing service unavailable');
    });

    it('passes the claim id into issuance and completes once after publish with the final warnings', async () => {
      mockIssueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        storageResponse: STORAGE_RESPONSE,
        primaryEntity: {},
        entityLinkFailed: true,
      });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(mockIssueCredential).toHaveBeenCalledWith(expect.objectContaining({ idempotencyClaimId: 'claim-1' }));
      expect(mockCompleteIdempotencyKey).toHaveBeenCalledTimes(1);
      expect(mockCompleteIdempotencyKey).toHaveBeenCalledWith({
        claimId: 'claim-1',
        recordId: 'cred-1',
        responseBody: json.warnings,
      });
      expect(json.warnings).toEqual([expect.objectContaining({ code: 'ENTITY_LINK_FAILED' })]);
    });

    it('returns 409 IDEMPOTENCY_KEY_IN_FLIGHT without releasing when the claim is lost during association', async () => {
      mockIssueCredential.mockRejectedValue(new IdempotencyClaimLostError());

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json).toEqual({
        error: "Another request now holds this Idempotency-Key. Retry to receive that request's result.",
        code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
      });
      expect(mockReleaseIdempotencyKey).not.toHaveBeenCalled();
      expect(mockCompleteIdempotencyKey).not.toHaveBeenCalled();
    });

    it('returns the winner finalised body when original finalisation loses the CAS', async () => {
      const winnerWarnings = [{ code: 'IDR_PUBLISH_FAILED', message: 'from stale replayer' }];
      mockIssueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        storageResponse: STORAGE_RESPONSE,
        primaryEntity: {},
        entityLinkFailed: true,
      });
      mockCompleteIdempotencyKey.mockResolvedValue({ applied: false });
      mockFindIdempotencyKey.mockResolvedValueOnce({ outcome: 'absent' }).mockResolvedValueOnce({
        outcome: 'replay',
        recordId: 'cred-1',
        responseBody: winnerWarnings,
      });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json).toEqual({ credentialId: 'cred-1', warnings: winnerWarnings });
      expect(mockReleaseIdempotencyKey).not.toHaveBeenCalled();
    });

    it('returns 201 with IDEMPOTENCY_RESPONSE_NOT_RECORDED and keeps other warnings when complete throws', async () => {
      mockIssueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        storageResponse: STORAGE_RESPONSE,
        primaryEntity: {},
        entityLinkFailed: true,
      });
      mockCompleteIdempotencyKey.mockRejectedValueOnce(new Error('transient database error'));

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-1');
      expect(mockReleaseIdempotencyKey).not.toHaveBeenCalled();
      expect(mockIssueCredential).toHaveBeenCalledTimes(1);
      expect(json.warnings).toEqual([expect.objectContaining({ code: 'ENTITY_LINK_FAILED' }), RESPONSE_NOT_RECORDED]);
    });

    it('passes publish-step warnings to complete unchanged', async () => {
      mockResolvePublishTarget.mockResolvedValue({ outcome: 'not-found', value: '09506000134352' });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(mockCompleteIdempotencyKey).toHaveBeenCalledTimes(1);
      expect(mockCompleteIdempotencyKey).toHaveBeenCalledWith({
        claimId: 'claim-1',
        recordId: 'cred-1',
        responseBody: json.warnings,
      });
      expect(json.warnings).toEqual([expect.objectContaining({ code: 'PUBLISH_IDENTIFIER_UNKNOWN' })]);
    });

    it('returns 400 naming the header when it is blank', async () => {
      const req = createFakeRequest(validBody(), { 'Idempotency-Key': '   ' });
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Idempotency-Key');
      expect(mockFindIdempotencyKey).not.toHaveBeenCalled();
      expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('returns 400 naming the header when it exceeds 255 characters after trimming', async () => {
      const req = createFakeRequest(validBody(), { 'Idempotency-Key': 'k'.repeat(256) });
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Idempotency-Key');
      expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
    });

    it('returns 400 naming the header and the charset rule when the key contains a newline', async () => {
      const req = createFakeRequest(validBody(), { 'Idempotency-Key': 'retry-1\nmore' });
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Idempotency-Key must contain only printable ASCII characters');
      expect(mockFindIdempotencyKey).not.toHaveBeenCalled();
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('accepts a 255-character key and claims the trimmed value', async () => {
      const key = 'k'.repeat(255);
      const req = createFakeRequest(validBody(), { 'Idempotency-Key': `  ${key}  ` });
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(res.status).toBe(201);
      expect(mockFindIdempotencyKey).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', operation: IdempotencyOperation.CREDENTIAL_ISSUE, key }),
      );
      expect(mockClaimIdempotencyKey).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', operation: IdempotencyOperation.CREDENTIAL_ISSUE, key }),
      );
    });

    it('omits warnings on replay when the stored body is not an array', async () => {
      mockFindIdempotencyKey.mockResolvedValue({
        outcome: 'replay',
        recordId: 'cred-original',
        responseBody: { code: 'not-a-list' },
      });

      const req = createFakeRequest(validBody(), KEY_HEADER);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json).toEqual({ credentialId: 'cred-original' });
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });
  });

  describe('request body size limit', () => {
    const ORIGINAL = process.env.MAX_REQUEST_BODY_BYTES;

    beforeEach(() => {
      process.env.MAX_REQUEST_BODY_BYTES = '1024';
    });

    afterEach(() => {
      if (ORIGINAL === undefined) {
        delete process.env.MAX_REQUEST_BODY_BYTES;
      } else {
        process.env.MAX_REQUEST_BODY_BYTES = ORIGINAL;
      }
    });

    it('issues a body under the cap', async () => {
      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(res.status).toBe(201);
      expect(mockIssueCredential).toHaveBeenCalledTimes(1);
    });

    it('returns 413 REQUEST_BODY_TOO_LARGE when Content-Length declares a body over the cap', async () => {
      const req = createFakeRequest(validBody(), { 'Content-Length': '2048' });
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(413);
      expect(json).toEqual({
        error: 'The request body exceeds the maximum of 1024 bytes.',
        code: 'REQUEST_BODY_TOO_LARGE',
      });
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('returns 413 REQUEST_BODY_TOO_LARGE when Content-Length is absent and the body exceeds the cap', async () => {
      const req = createFakeRequest(undefined, undefined, `{"pad":"${'x'.repeat(2000)}"}`);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(413);
      expect(json.code).toBe('REQUEST_BODY_TOO_LARGE');
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });

    it('returns 413 REQUEST_BODY_TOO_LARGE when Content-Length lies below the cap and the body exceeds it', async () => {
      const req = createFakeRequest(undefined, { 'Content-Length': '10' }, `{"pad":"${'x'.repeat(2000)}"}`);
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(413);
      expect(json.code).toBe('REQUEST_BODY_TOO_LARGE');
      expect(mockIssueCredential).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/credentials
// ---------------------------------------------------------------------------

describe('GET /api/v1/credentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListCredentials.mockResolvedValue({ data: [], total: 0 });
  });

  it('rejects a limit above the deployment maximum with a 400 naming the bound, without querying', async () => {
    const req = createFakeGetRequest({ limit: String(MAX_PAGE_LIMIT + 1) });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit');
    expect(json.error).toContain(String(MAX_PAGE_LIMIT));
    expect(mockListCredentials).not.toHaveBeenCalled();
  });

  it.each([
    ['1abc', 'limit'],
    ['0x10', 'limit'],
    ['1e3', 'limit'],
  ])('rejects the malformed strict-integer limit %s with a 400', async (value, fieldNamed) => {
    const req = createFakeGetRequest({ limit: value });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain(fieldNamed);
    expect(mockListCredentials).not.toHaveBeenCalled();
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace'],
    ['NoSuchType', 'unknown'],
  ])('keeps accepting a %j (%s) credentialType filter as a 200', async (value) => {
    const req = createFakeGetRequest({ credentialType: value });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    expect(res.status).toBe(200);
    expect(mockListCredentials).toHaveBeenCalledWith(expect.objectContaining({ credentialType: value }));
  });

  it('rejects a repeated query parameter with a 400', async () => {
    const url = new URL('http://localhost/api/v1/credentials');
    url.searchParams.append('credentialType', 'A');
    url.searchParams.append('credentialType', 'B');
    const req = { method: 'GET', url: url.toString(), headers: new Headers() } as unknown as Request;
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('credentialType');
    expect(mockListCredentials).not.toHaveBeenCalled();
  });

  it('returns 200 with default pagination when no params provided', async () => {
    const req = createFakeGetRequest();
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(mockListCredentials).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      credentialType: undefined,
      isPublished: undefined,
      limit: undefined,
      offset: undefined,
    });
    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json).toHaveProperty('pagination');
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('passes credentialType filter to repository', async () => {
    const req = createFakeGetRequest({ credentialType: 'DPP' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListCredentials).toHaveBeenCalledWith(expect.objectContaining({ credentialType: 'DPP' }));
  });

  it('returns 500 when a stored decryption key cannot be decrypted', async () => {
    mockListCredentials.mockResolvedValue({
      data: [{ id: 'cred-1', decryptionKey: 'stored-envelope' }],
      total: 1,
    });
    mockRevealDecryptionKey.mockImplementationOnce(() => {
      throw new Error('Failed to decrypt the stored credential decryption key.');
    });

    const req = createFakeGetRequest();
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    // The underlying message names the operator's encryption key and the
    // failing row, so neither reaches the caller; both go to the log.
    expect(json.error).not.toContain('cred-1');
    expect(json.error).not.toContain('DATA_ENCRYPTION_KEY');
    expect(json.error).not.toContain('decrypt the stored credential');
  });

  it('reveals stored decryption keys in the listed credentials', async () => {
    mockListCredentials.mockResolvedValue({
      data: [{ id: 'cred-1', decryptionKey: 'stored-envelope' }],
      total: 1,
    });
    mockRevealDecryptionKey.mockReturnValueOnce('plain-key');

    const req = createFakeGetRequest();
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(mockRevealDecryptionKey).toHaveBeenCalledWith('stored-envelope');
    expect(json.data[0].decryptionKey).toBe('plain-key');
  });

  it('passes isPublished=true filter to repository', async () => {
    const req = createFakeGetRequest({ isPublished: 'true' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListCredentials).toHaveBeenCalledWith(expect.objectContaining({ isPublished: true }));
  });

  it('passes isPublished=false filter to repository', async () => {
    const req = createFakeGetRequest({ isPublished: 'false' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListCredentials).toHaveBeenCalledWith(expect.objectContaining({ isPublished: false }));
  });

  it('passes limit and offset to repository', async () => {
    const req = createFakeGetRequest({ limit: '10', offset: '20' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListCredentials).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 20 }));
  });

  it('returns 400 for invalid limit', async () => {
    const req = createFakeGetRequest({ limit: 'abc' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit');
  });

  it('returns 400 for limit=0', async () => {
    const req = createFakeGetRequest({ limit: '0' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid offset', async () => {
    const req = createFakeGetRequest({ offset: '-1' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset');
  });

  it('returns 400 for invalid isPublished value', async () => {
    const req = createFakeGetRequest({ isPublished: 'yes' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('isPublished');
  });

  it('returns empty results for unknown credentialType (not 400)', async () => {
    mockListCredentials.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeGetRequest({ credentialType: 'UnknownType' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([]);
  });

  it('returns correct pagination metadata', async () => {
    mockListCredentials.mockResolvedValue({ data: [{ id: 'c1' }, { id: 'c2' }], total: 5 });

    const req = createFakeGetRequest({ limit: '2', offset: '0' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(json.pagination).toEqual({ total: 5, limit: 2, offset: 0, hasMore: true });
  });

  it('returns hasMore=false on last page', async () => {
    mockListCredentials.mockResolvedValue({ data: [{ id: 'c1' }], total: 3 });

    const req = createFakeGetRequest({ limit: '2', offset: '2' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(json.pagination).toEqual({ total: 3, limit: 2, offset: 2, hasMore: false });
  });

  it('passes combined credentialType and isPublished filters to repository', async () => {
    const req = createFakeGetRequest({ credentialType: 'DPP', isPublished: 'true' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ credentialType: 'DPP', isPublished: true }),
    );
  });

  it('returns 500 when repository throws', async () => {
    mockListCredentials.mockRejectedValue(new Error('Database connection lost'));

    const req = createFakeGetRequest();
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database connection lost');
  });
});
