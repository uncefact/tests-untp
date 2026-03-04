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

// Mock the Prisma generated enum so the route can validate credentialType
jest.mock('@/lib/prisma/generated', () => ({
  CredentialType: {
    DigitalProductPassport: 'DigitalProductPassport',
    DigitalConformityCredential: 'DigitalConformityCredential',
    DigitalFacilityRecord: 'DigitalFacilityRecord',
    DigitalIdentityAnchor: 'DigitalIdentityAnchor',
    DigitalTraceabilityEvent: 'DigitalTraceabilityEvent',
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
jest.mock('@/lib/prisma/repositories', () => ({
  updateCredentialPublished: (...args: unknown[]) => mockUpdateCredentialPublished(...args),
}));

const mockValidateCvcCompliance = jest.fn();
jest.mock('@/lib/services/cvc-validation.service', () => ({
  validateCvcCompliance: (...args: unknown[]) => mockValidateCvcCompliance(...args),
}));

import { POST } from './route';

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

const AUTH_CONTEXT = { tenantId: 'tenant-1', params: Promise.resolve({}) };

/** Minimal credential payload for a valid request. */
const VALID_PAYLOAD = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
  credentialSubject: { id: 'urn:example:product:123' },
};

const STORAGE_RESPONSE = {
  uri: 'https://storage.example.com/cred/abc123',
  hash: 'sha256-abc',
  decryptionKey: 'key-xyz',
};

const stubMapper = {
  extractEntityRefs: jest.fn().mockReturnValue({ primaryIdentifier: '09506000134352' }),
  buildPayload: jest.fn(),
  extractCvcRefs: jest.fn().mockReturnValue({ scopeUrl: undefined, criteriaUrls: [] }),
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
    mapper: stubMapper,
    schemaUrls: [DATA_MODEL.schemaUrl],
  });
  mockValidateCredentialPayload.mockResolvedValue(undefined);
  mockValidateCvcCompliance.mockResolvedValue({ warnings: [] });
  mockResolveVcService.mockResolvedValue({ service: {}, instanceId: 'vc-1' });
  mockResolveStorageService.mockResolvedValue({ service: {}, instanceId: 'storage-1' });
  mockIssueCredential.mockResolvedValue({
    credentialId: 'cred-1',
    storageResponse: STORAGE_RESPONSE,
    primaryEntity: {},
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/credentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    it('returns 400 when credentialType is not a valid enum value', async () => {
      const req = createFakeRequest(validBody({ credentialType: 'InvalidType' }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('credentialType must be one of');
    });

    it('returns 400 when version is missing', async () => {
      const req = createFakeRequest(validBody({ version: undefined }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('version is required');
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

      expect(mockValidateCredentialPayload).toHaveBeenCalledWith(VALID_PAYLOAD, [DATA_MODEL.schemaUrl]);
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

  // ── CVC validation ──────────────────────────────────────────────────

  describe('CVC validation', () => {
    it('skips CVC validation for non-DCC credential types', async () => {
      const req = createFakeRequest(validBody());
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockValidateCvcCompliance).not.toHaveBeenCalled();
    });

    it('runs CVC validation for DCC credential type', async () => {
      mockResolveDataModel.mockResolvedValue({
        dataModel: {
          ...DATA_MODEL,
          credentialType: 'DigitalConformityCredential',
          name: 'Digital Conformity Credential',
        },
        mapper: stubMapper,
        schemaUrls: [DATA_MODEL.schemaUrl],
      });
      mockValidateCvcCompliance.mockResolvedValue({ warnings: [] });

      const req = createFakeRequest(validBody({ credentialType: 'DigitalConformityCredential' }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(stubMapper.extractCvcRefs).toHaveBeenCalled();
      expect(mockValidateCvcCompliance).toHaveBeenCalledWith('tenant-1', {
        scopeUrl: undefined,
        criteriaUrls: [],
      });
    });

    it('includes CVC warnings in response when present', async () => {
      mockResolveDataModel.mockResolvedValue({
        dataModel: {
          ...DATA_MODEL,
          credentialType: 'DigitalConformityCredential',
          name: 'Digital Conformity Credential',
        },
        mapper: stubMapper,
        schemaUrls: [DATA_MODEL.schemaUrl],
      });
      const warnings = [{ code: 'CVC_NO_SCOPE', message: 'No conformity scope found in credential payload' }];
      mockValidateCvcCompliance.mockResolvedValue({ warnings });

      const req = createFakeRequest(validBody({ credentialType: 'DigitalConformityCredential' }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-1');
      expect(json.warnings).toEqual(warnings);
    });

    it('does not include warnings key when no CVC warnings', async () => {
      const req = createFakeRequest(validBody());
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-1');
      expect(json).not.toHaveProperty('warnings');
    });

    it('continues issuing credential even when CVC validation throws', async () => {
      mockResolveDataModel.mockResolvedValue({
        dataModel: {
          ...DATA_MODEL,
          credentialType: 'DigitalConformityCredential',
          name: 'Digital Conformity Credential',
        },
        mapper: stubMapper,
        schemaUrls: [DATA_MODEL.schemaUrl],
      });
      mockValidateCvcCompliance.mockRejectedValue(new Error('DB connection lost'));

      const req = createFakeRequest(validBody({ credentialType: 'DigitalConformityCredential' }));
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.credentialId).toBe('cred-1');
      expect(json).not.toHaveProperty('warnings');
    });

    it('runs CVC validation for DCC extension credential types', async () => {
      mockResolveDataModel.mockResolvedValue({
        dataModel: {
          ...DATA_MODEL,
          credentialType: 'DigitalConformityCredential',
          isExtension: true,
          parentConfig: {
            credentialType: 'DigitalConformityCredential',
            version: '0.6.1',
            schemaUrl: 'https://example.com/schema.json',
          },
        },
        mapper: stubMapper,
        schemaUrls: [DATA_MODEL.schemaUrl],
      });
      mockValidateCvcCompliance.mockResolvedValue({ warnings: [] });

      const req = createFakeRequest(validBody({ credentialType: 'DigitalConformityCredential' }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockValidateCvcCompliance).toHaveBeenCalled();
    });
  });

  // ── Service resolution ──────────────────────────────────────────────

  describe('service resolution', () => {
    it('passes signingOptions.serviceInstanceId to resolveVcService', async () => {
      const req = createFakeRequest(validBody({ signingOptions: { serviceInstanceId: 'custom-vc' } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveVcService).toHaveBeenCalledWith('tenant-1', 'custom-vc');
    });

    it('passes storageOptions.serviceInstanceId to resolveStorageService', async () => {
      const req = createFakeRequest(validBody({ storageOptions: { serviceInstanceId: 'custom-storage' } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveStorageService).toHaveBeenCalledWith('tenant-1', 'custom-storage');
    });

    it('passes undefined when no signingOptions provided', async () => {
      const req = createFakeRequest(validBody());
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveVcService).toHaveBeenCalledWith('tenant-1', undefined);
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
        mapper: stubMapper,
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

    it('publishes to IDR when publish=true and entity has scheme config', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(validBody({ publishingOptions: { publish: true } }));
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      // resolveIdrService called with scheme and publishing service instance IDs
      expect(mockResolveIdrService).toHaveBeenCalledWith('tenant-1', 'idr-scheme-1', undefined);

      // buildPublishLinks called with storage response, link title, and options
      expect(mockBuildPublishLinks).toHaveBeenCalledWith(STORAGE_RESPONSE, 'Digital Product Passport', {
        machineVerificationUrl: undefined,
        humanVerificationUrl: undefined,
      });

      // idrService.publishLinks called
      expect(mockPublishLinks).toHaveBeenCalledWith('gtin', '09506000134352', expect.any(Array), '/', {
        namespace: 'gs1',
        itemDescription: 'Digital Product Passport',
      });

      // updateCredentialPublished called
      expect(mockUpdateCredentialPublished).toHaveBeenCalledWith('cred-1', 'tenant-1', true);
    });

    it('passes publishingOptions.serviceInstanceId to resolveIdrService', async () => {
      setupPublishingHappyPath();

      const req = createFakeRequest(
        validBody({ publishingOptions: { publish: true, serviceInstanceId: 'explicit-idr' } }),
      );
      await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(mockResolveIdrService).toHaveBeenCalledWith('tenant-1', 'idr-scheme-1', 'explicit-idr');
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
        expect.objectContaining({ itemDescription: 'Custom Title' }),
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
});
