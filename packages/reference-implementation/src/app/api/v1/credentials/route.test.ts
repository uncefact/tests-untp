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
  const { NotFoundError, errorMessage, ServiceRegistryError } = jest.requireActual('@/lib/api/errors');
  const { ValidationError } = jest.requireActual('@/lib/api/validation');
  const { ServiceError } = jest.requireActual('@uncefact/untp-ri-services');

  function jsonResponse(body: unknown, init?: { status?: number }) {
    return { status: init?.status ?? 200, json: async () => body };
  }

  return {
    withTenantAuth:
      (handler: (req: unknown, ctx: unknown) => Promise<unknown>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
        } catch (e: unknown) {
          if (e instanceof ValidationError) {
            return jsonResponse({ error: (e as Error).message }, { status: 400 });
          }
          if (e instanceof NotFoundError) {
            return jsonResponse({ error: (e as Error).message }, { status: 404 });
          }
          if (e instanceof ServiceRegistryError) {
            return jsonResponse({ error: (e as Error).message }, { status: 500 });
          }
          if (e instanceof ServiceError) {
            const serviceErr = e as Error & { code?: string; statusCode?: number };
            return jsonResponse(
              { error: serviceErr.message, code: serviceErr.code },
              { status: serviceErr.statusCode },
            );
          }
          return jsonResponse({ error: errorMessage(e) }, { status: 500 });
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

// Services package mocks
const mockBuildPublishLinks = jest.fn();
jest.mock('@uncefact/untp-ri-services', () => ({
  buildPublishLinks: (...args: unknown[]) => mockBuildPublishLinks(...args),
}));

// Repository mocks
const mockUpdateCredentialPublished = jest.fn();
const mockListCredentials = jest.fn();
const mockGetDidByDid = jest.fn();
const mockFindConformityScheme = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  updateCredentialPublished: (...args: unknown[]) => mockUpdateCredentialPublished(...args),
  listCredentials: (...args: unknown[]) => mockListCredentials(...args),
  getDidByDid: (...args: unknown[]) => mockGetDidByDid(...args),
  findConformitySchemeByCanonicalId: (...args: unknown[]) => mockFindConformityScheme(...args),
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

import { POST, GET } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeRequest(body?: unknown): Request {
  const bodyString = body !== undefined ? JSON.stringify(body) : undefined;
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/credentials',
    headers: new Headers({ 'Content-Type': 'application/json' }),
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
  mockValidateConformityClaim.mockReturnValue([]);
  mockFindConformityScheme.mockResolvedValue(null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/credentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
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
      expect(json.error).toContain('credentialPayload is required');
    });

    it('returns 400 when credentialPayload is not an object', async () => {
      const req = createFakeRequest(validBody({ credentialPayload: 'not-an-object' }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('credentialPayload is required');
    });

    it('returns 400 when credentialType is missing', async () => {
      const req = createFakeRequest(validBody({ credentialType: undefined }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('credentialType is required');
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
      expect(json.error).toContain('version is required');
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

    it('skips SSRF validation when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
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
        refs: { organisations: [], facilities: [], products: [] },
        vcService,
        storageService,
        storageOptions: {},
      });
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

      mockIssueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        storageResponse: STORAGE_RESPONSE,
        primaryEntity,
      });

      mockResolveIdrService.mockResolvedValue({
        service: { publishLinks: mockPublishLinks },
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

    it('does not add PUBLISH_SKIPPED when refs extraction already failed', async () => {
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
      });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      const codes = ((json.warnings ?? []) as Array<{ code: string }>).map((w) => w.code);
      expect(codes).toContain('REFS_EXTRACTION_FAILED');
      expect(codes).not.toContain('PUBLISH_SKIPPED');
    });

    it('publishes to IDR when publish=true and entity has scheme config', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      // resolveIdrService called with scheme IDR only
      expect(mockResolveIdrService).toHaveBeenCalledWith('tenant-1', 'idr-scheme-1');

      // buildPublishLinks called with storage response, link title, and options
      expect(mockBuildPublishLinks).toHaveBeenCalledWith(STORAGE_RESPONSE, 'Digital Product Passport', {
        machineVerificationUrl: undefined,
        humanVerificationUrl: undefined,
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
      expect(mockResolveIdrService).toHaveBeenCalledWith('tenant-1', 'idr-scheme-1');
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
        machineVerificationUrl: 'https://verify.example.com/api',
        humanVerificationUrl: 'https://verify.example.com/ui',
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

    it('skips publishing when primaryEntity has no schemePrimaryKey', async () => {
      setupPublishingHappyPath({ schemePrimaryKey: undefined });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveIdrService).not.toHaveBeenCalled();
      expect(mockUpdateCredentialPublished).not.toHaveBeenCalled();
    });

    it('skips publishing when primaryEntity has no schemeNamespace', async () => {
      setupPublishingHappyPath({ schemeNamespace: undefined });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveIdrService).not.toHaveBeenCalled();
      expect(mockUpdateCredentialPublished).not.toHaveBeenCalled();
    });

    it('issues credential with IDR_PUBLISH_FAILED warning when publishLinks throws', async () => {
      setupPublishingHappyPath();
      mockPublishLinks.mockRejectedValueOnce(new Error('scheme not registered'));

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-1');
      expect(json.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'IDR_PUBLISH_FAILED',
            message: expect.stringContaining('scheme not registered'),
          }),
        ]),
      );
    });

    it('does not mark credential as published when publishLinks throws', async () => {
      setupPublishingHappyPath();
      mockPublishLinks.mockRejectedValueOnce(new Error('IDR unavailable'));

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockUpdateCredentialPublished).not.toHaveBeenCalled();
    });

    it('skips publishing when primaryEntity is empty (no scheme info)', async () => {
      // primaryEntity returned from issueCredential has no scheme fields
      mockIssueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        storageResponse: STORAGE_RESPONSE,
        primaryEntity: {},
      });

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveIdrService).not.toHaveBeenCalled();
      expect(mockUpdateCredentialPublished).not.toHaveBeenCalled();
    });
  });

  // ── Error propagation ─────────────────────────────────────────────────

  describe('error propagation', () => {
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

    it('validates the extracted claim against the resolved scheme and attaches no warnings on a clean match', async () => {
      stubBridge.extractConformityClaim.mockReturnValue(CLAIM);
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
      stubBridge.extractConformityClaim.mockReturnValue(CLAIM);
      mockFindConformityScheme.mockResolvedValue(SCHEME);
      mockValidateConformityClaim.mockReturnValue([
        {
          code: 'conformity-criterion.not-in-profile',
          message: 'Criterion is not published by the profile.',
          received: 'https://example.com/rra/v3.0/criterion/26',
          pointer: '/criteria/0',
        },
      ]);

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.warnings).toEqual([
        {
          code: 'conformity-criterion.not-in-profile',
          message: 'Criterion is not published by the profile.',
          received: 'https://example.com/rra/v3.0/criterion/26',
          pointer: '/criteria/0',
        },
      ]);
    });

    it('passes a null scheme to the validator when the scheme URI is unknown', async () => {
      stubBridge.extractConformityClaim.mockReturnValue(CLAIM);
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
      stubBridge.extractConformityClaim.mockReturnValue(null);

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(mockFindConformityScheme).not.toHaveBeenCalled();
      expect(mockValidateConformityClaim).not.toHaveBeenCalled();
      expect(json.warnings).toBeUndefined();
    });

    it('never blocks issuance: emits an advisory warning when extraction throws', async () => {
      stubBridge.extractConformityClaim.mockImplementation(() => {
        throw new Error('boom');
      });

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.warnings).toEqual([expect.objectContaining({ code: 'conformity-claim.validation-error' })]);
    });

    it('never blocks issuance: degrades to an advisory warning when the scheme lookup rejects', async () => {
      stubBridge.extractConformityClaim.mockReturnValue(CLAIM);
      mockFindConformityScheme.mockRejectedValue(new Error('db down'));

      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.warnings).toEqual([expect.objectContaining({ code: 'conformity-claim.validation-error' })]);
    });

    it('never blocks issuance: degrades to an advisory warning when the validator throws', async () => {
      stubBridge.extractConformityClaim.mockReturnValue(CLAIM);
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
});

// ---------------------------------------------------------------------------
// GET /api/v1/credentials
// ---------------------------------------------------------------------------

describe('GET /api/v1/credentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListCredentials.mockResolvedValue({ data: [], total: 0 });
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
