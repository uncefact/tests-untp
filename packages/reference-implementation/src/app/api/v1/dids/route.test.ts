// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withTenantAuth — skips auth but delegates error mapping to the real
// handleRouteError, so this suite is checked against production's actual
// status/code mapping (e.g. ServiceInstanceNotFoundError -> 404, other
// ServiceRegistryError subtypes -> 500) rather than a hand-rolled duplicate
// that can drift from it.
jest.mock('@/lib/api/with-tenant-auth', () => {
  const { handleRouteError } = jest.requireActual('@/lib/api/handle-route-error');
  return {
    withTenantAuth:
      (handler: (req: unknown, ctx: unknown) => Promise<unknown>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
        } catch (e) {
          return handleRouteError(e);
        }
      },
  };
});

const mockResolveDidService = jest.fn();
const mockCreateDid = jest.fn();
const mockListDids = jest.fn();
const mockFindDidByAliasAndService = jest.fn();

jest.mock('@/lib/services/resolve-did-service', () => ({
  resolveDidService: (...args: unknown[]) => mockResolveDidService(...args),
}));

jest.mock('@/lib/prisma/repositories', () => ({
  createDid: (input: unknown) => mockCreateDid(input),
  listDids: (orgId: string, opts: unknown) => mockListDids(orgId, opts),
  findDidByAliasAndService: (alias: string, serviceInstanceId: string) =>
    mockFindDidByAliasAndService(alias, serviceInstanceId),
}));

import { ServiceResolutionError, ServiceInstanceNotFoundError } from '@/lib/api/errors';
import { DidType, DidMethod, DidStatus, DidCreateError, DidDocumentFetchError } from '@uncefact/untp-ri-services';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { POST, GET } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string; rawBody?: string }): Request {
  const { method = 'POST', body, url = 'http://localhost/api/v1/dids', rawBody } = options;
  const bodyString = rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined);
  return {
    method,
    url,
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
    url: 'http://localhost/api/v1/dids',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('POST /api/v1/dids', () => {
  const mockDidService = {
    create: jest.fn(),
    normaliseAlias: jest.fn().mockImplementation((alias: string) => alias),
    getSupportedTypes: jest.fn().mockReturnValue(['MANAGED', 'SELF_MANAGED']),
    getSupportedMethods: jest.fn().mockReturnValue(['DID_WEB']),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveDidService.mockResolvedValue({ service: mockDidService, instanceId: 'inst-1' });
    mockFindDidByAliasAndService.mockResolvedValue(false);
  });

  it('creates a managed DID and returns 201', async () => {
    mockDidService.create.mockResolvedValue({
      did: 'did:web:example.com:org:123',
      keyId: 'key-1',
      document: { '@context': 'https://www.w3.org/ns/did/v1', id: 'did:web:example.com:org:123' },
    });
    mockCreateDid.mockResolvedValue({
      id: 'record-1',
      did: 'did:web:example.com:org:123',
      type: DidType.MANAGED,
      status: DidStatus.ACTIVE,
    });

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'my-did', name: 'My DID' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.did).toBe('did:web:example.com:org:123');
  });

  it('creates a self-managed DID with UNVERIFIED status and serviceInstanceId', async () => {
    mockDidService.create.mockResolvedValue({
      did: 'did:web:example.com:org:456',
      keyId: 'key-2',
      document: { '@context': 'https://www.w3.org/ns/did/v1', id: 'did:web:example.com:org:456' },
    });
    mockCreateDid.mockResolvedValue({
      id: 'record-2',
      status: DidStatus.UNVERIFIED,
    });

    const req = createFakeRequest({
      body: { type: DidType.SELF_MANAGED, method: DidMethod.DID_WEB, alias: 'self-managed' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(201);
    expect(mockCreateDid).toHaveBeenCalledWith(
      expect.objectContaining({ status: DidStatus.UNVERIFIED, serviceInstanceId: 'inst-1' }),
    );
  });

  it('passes isDefault to createDid when provided', async () => {
    mockDidService.create.mockResolvedValue({
      did: 'did:web:example.com:org:789',
      keyId: 'key-3',
      document: { '@context': 'https://www.w3.org/ns/did/v1', id: 'did:web:example.com:org:789' },
    });
    mockCreateDid.mockResolvedValue({
      id: 'record-3',
      did: 'did:web:example.com:org:789',
      type: DidType.MANAGED,
      status: DidStatus.ACTIVE,
      isDefault: true,
    });

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'default-did', isDefault: true },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(mockCreateDid).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }));
    expect(json.isDefault).toBe(true);
  });

  it('returns 400 for invalid type and does not resolve a service or call the repository', async () => {
    const req = createFakeRequest({
      body: { type: 'INVALID', method: DidMethod.DID_WEB, alias: 'test' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^type:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockFindDidByAliasAndService).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for the DEFAULT type (system-managed, not creatable via this endpoint)', async () => {
    const req = createFakeRequest({
      body: { type: DidType.DEFAULT, method: DidMethod.DID_WEB, alias: 'test' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^type:/);
    // Asserts the Zod boundary itself rejects DEFAULT, not a later capability check: if
    // creatableDidTypeSchema were ever widened to include DEFAULT, the request would reach
    // resolveDidService before failing, which this assertion would catch.
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for missing type and does not resolve a service or call the repository', async () => {
    const req = createFakeRequest({ body: { method: DidMethod.DID_WEB, alias: 'test' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^type:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid method and does not resolve a service or call the repository', async () => {
    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: 'INVALID', alias: 'test' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^method:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for missing method and does not resolve a service or call the repository', async () => {
    const req = createFakeRequest({ body: { type: DidType.MANAGED, alias: 'test' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^method:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for missing alias and does not resolve a service or call the repository', async () => {
    const req = createFakeRequest({ body: { type: DidType.MANAGED, method: DidMethod.DID_WEB } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^alias:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty alias string', async () => {
    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: '' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^alias:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
  });

  it('returns 400 when isDefault is not a boolean (mistyped optional field)', async () => {
    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test', isDefault: 'yes' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^isDefault:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when name is an empty string (mistyped optional field)', async () => {
    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test', name: '' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^name:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
  });

  it('returns 400 when name is an explicit null (omission, not null, leaves it unset)', async () => {
    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test', name: null },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^name:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when description is an empty string (mistyped optional field)', async () => {
    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test', description: '' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^description:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when serviceInstanceId is an empty string (mistyped optional field)', async () => {
    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test', serviceInstanceId: '' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^serviceInstanceId:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body and does not resolve a service or call the repository', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for a literal null body', async () => {
    const req = createFakeRequest({ rawBody: 'null' });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^body:/);
    expect(mockResolveDidService).not.toHaveBeenCalled();
  });

  it('returns 500 when DID service fails', async () => {
    mockDidService.create.mockRejectedValue(new Error('VCKit error'));

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('VCKit error');
  });

  it('returns 502 with code DID_CREATE_FAILED when the upstream create call fails', async () => {
    mockDidService.create.mockRejectedValue(new DidCreateError('HTTP 500: Internal Server Error'));

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.code).toBe('DID_CREATE_FAILED');
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 502 with code DID_DOCUMENT_FETCH_FAILED when the post-create document fetch fails', async () => {
    // create() calls getDocument() internally after a successful upstream create; a failure there
    // propagates as DidDocumentFetchError, not DidCreateError, and the RI never saves a record
    // (mockCreateDid must stay uncalled) since the route never receives a providerResult.
    mockDidService.create.mockRejectedValue(new DidDocumentFetchError('did:web:example.com', 'HTTP 500'));

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.code).toBe('DID_DOCUMENT_FETCH_FAILED');
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 404 when the specified service instance does not exist', async () => {
    mockResolveDidService.mockRejectedValue(new ServiceInstanceNotFoundError('inst-missing'));

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test', serviceInstanceId: 'inst-missing' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('inst-missing');
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('passes correct options to didService.create', async () => {
    mockDidService.create.mockResolvedValue({
      did: 'did:web:example.com',
      keyId: 'key-1',
      document: { '@context': 'https://www.w3.org/ns/did/v1', id: 'did:web:example.com' },
    });
    mockCreateDid.mockResolvedValue({ id: 'record-1' });

    const req = createFakeRequest({
      body: {
        type: DidType.MANAGED,
        method: DidMethod.DID_WEB,
        alias: 'test-org',
        name: 'Test',
        description: 'A test DID',
      },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockDidService.create).toHaveBeenCalledWith({
      type: DidType.MANAGED,
      method: DidMethod.DID_WEB,
      alias: 'test-org',
      name: 'Test',
      description: 'A test DID',
    });
  });

  it('returns 500 when service resolution fails', async () => {
    mockResolveDidService.mockRejectedValue(new ServiceResolutionError('DID', 'org-1'));

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('No service instance available');
  });

  it('returns 400 when service does not support the requested type', async () => {
    mockDidService.getSupportedTypes.mockReturnValue(['MANAGED']);

    const req = createFakeRequest({
      body: { type: DidType.SELF_MANAGED, method: DidMethod.DID_WEB, alias: 'test' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('type: must be one of MANAGED');
  });

  it('returns 400 when alias normalisation fails', async () => {
    mockDidService.normaliseAlias.mockImplementation(() => {
      throw new Error('Invalid DID alias: "!!!" produces an empty identifier after normalisation');
    });

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: '!!!' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('alias: Invalid DID alias: "!!!" produces an empty identifier after normalisation');
  });

  it('passes the normalised alias to didService.create', async () => {
    mockDidService.normaliseAlias.mockReturnValue('my-normalised-alias');
    mockDidService.create.mockResolvedValue({
      did: 'did:web:example.com:my-normalised-alias',
      keyId: 'key-1',
      document: { '@context': 'https://www.w3.org/ns/did/v1', id: 'did:web:example.com:my-normalised-alias' },
    });
    mockCreateDid.mockResolvedValue({ id: 'record-1' });

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'My Normalised Alias' },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockDidService.normaliseAlias).toHaveBeenCalledWith(
      'My Normalised Alias',
      DidMethod.DID_WEB,
      DidType.MANAGED,
    );
    expect(mockDidService.create).toHaveBeenCalledWith(expect.objectContaining({ alias: 'my-normalised-alias' }));
  });

  it('returns 409 when DID with same alias already exists on service instance', async () => {
    mockDidService.normaliseAlias.mockReturnValue('existing-alias');
    mockFindDidByAliasAndService.mockResolvedValue(true);

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'existing-alias' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBeDefined();
    expect(mockFindDidByAliasAndService).toHaveBeenCalledWith('existing-alias', 'inst-1');
    expect(mockDidService.create).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 409 when upstream provider reports DID already exists', async () => {
    const { DidConflictError } = jest.requireActual('@uncefact/untp-ri-services');
    mockDidService.create.mockRejectedValue(new DidConflictError('existing-alias'));

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'existing-alias' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('already exists');
  });

  it('returns 400 when service does not support the requested method', async () => {
    mockDidService.getSupportedMethods.mockReturnValue(['DID_WEB']);

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB_VH, alias: 'test' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('method: must be one of DID_WEB');
  });

  it('resolves the DID service with the organisation ID', async () => {
    mockDidService.create.mockResolvedValue({
      did: 'did:web:example.com',
      keyId: 'key-1',
      document: { '@context': 'https://www.w3.org/ns/did/v1', id: 'did:web:example.com' },
    });
    mockCreateDid.mockResolvedValue({ id: 'record-1' });

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'test' },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockResolveDidService).toHaveBeenCalledWith('org-1', undefined);
  });

  describe('root DID protection', () => {
    const SYSTEM_TENANT_CONTEXT = { tenantId: 'caq0ibyulrnh85itqtbgusfp3', params: Promise.resolve({}) };
    const TENANT_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

    beforeEach(() => {
      process.env.SYSTEM_VC_BASE_URL = 'http://vckit.example.com:3332';
      mockDidService.getSupportedTypes.mockReturnValue(['MANAGED', 'SELF_MANAGED']);
      mockDidService.getSupportedMethods.mockReturnValue(['DID_WEB']);
      mockDidService.normaliseAlias.mockImplementation((alias: string) =>
        alias.toLowerCase().replace(/[^a-z0-9.:-]/g, ''),
      );
      mockDidService.create.mockResolvedValue({ did: 'did:web:vckit.example.com%3A3332', keyId: 'key-1' });
      mockCreateDid.mockResolvedValue({ id: 'record-1' });
    });

    afterEach(() => {
      delete process.env.SYSTEM_VC_BASE_URL;
    });

    it('returns 403 when a tenant creates a self-managed root DID matching the system VC domain', async () => {
      const req = createFakeRequest({
        body: { type: DidType.SELF_MANAGED, method: DidMethod.DID_WEB, alias: 'vckit.example.com:3332' },
      });
      const res = await POST(req, TENANT_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('system VC service domain');
    });

    it('returns 403 when a tenant creates a self-managed root DID matching the hostname without port', async () => {
      const req = createFakeRequest({
        body: { type: DidType.SELF_MANAGED, method: DidMethod.DID_WEB, alias: 'vckit.example.com' },
      });
      const res = await POST(req, TENANT_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('system VC service domain');
    });

    it('allows the system tenant to create a self-managed root DID for the VC domain', async () => {
      const req = createFakeRequest({
        body: { type: DidType.SELF_MANAGED, method: DidMethod.DID_WEB, alias: 'vckit.example.com%3A3332' },
      });
      const res = await POST(req, SYSTEM_TENANT_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(res.status).toBe(201);
    });

    it('allows a tenant to create a self-managed DID with a path under the VC domain', async () => {
      mockDidService.normaliseAlias.mockReturnValue('vckit.example.com:org:acme');
      mockDidService.create.mockResolvedValue({ did: 'did:web:vckit.example.com:org:acme', keyId: 'key-2' });
      mockCreateDid.mockResolvedValue({ id: 'record-2' });

      const req = createFakeRequest({
        body: { type: DidType.SELF_MANAGED, method: DidMethod.DID_WEB, alias: 'vckit.example.com:org:acme' },
      });
      const res = await POST(req, TENANT_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(res.status).toBe(201);
    });

    it('allows a tenant to create a managed DID (not affected by root DID protection)', async () => {
      mockDidService.create.mockResolvedValue({ did: 'did:web:vckit.example.com:org:123', keyId: 'key-3' });
      mockCreateDid.mockResolvedValue({ id: 'record-3' });

      const req = createFakeRequest({
        body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: 'my-did' },
      });
      const res = await POST(req, TENANT_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(res.status).toBe(201);
    });

    it('skips the check when SYSTEM_VC_BASE_URL is not set', async () => {
      delete process.env.SYSTEM_VC_BASE_URL;
      mockDidService.create.mockResolvedValue({ did: 'did:web:anything.com', keyId: 'key-4' });
      mockCreateDid.mockResolvedValue({ id: 'record-4' });

      const req = createFakeRequest({
        body: { type: DidType.SELF_MANAGED, method: DidMethod.DID_WEB, alias: 'anything.com' },
      });
      const res = await POST(req, TENANT_CONTEXT as unknown as Parameters<typeof POST>[1]);
      expect(res.status).toBe(201);
    });
  });
});

describe('GET /api/v1/dids', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists DIDs for the organisation with pagination', async () => {
    const dids = [{ id: '1', did: 'did:web:example.com' }];
    mockListDids.mockResolvedValue({ data: dids, total: 1 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/dids' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(dids);
    expect(json.pagination).toEqual({
      total: 1,
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
      hasMore: false,
    });
  });

  it('passes query parameters to listDids', async () => {
    mockListDids.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/dids?type=MANAGED&status=ACTIVE&serviceInstanceId=inst-1&limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDids).toHaveBeenCalledWith('org-1', {
      type: 'MANAGED',
      status: 'ACTIVE',
      serviceInstanceId: 'inst-1',
      limit: 10,
      offset: 5,
    });
  });

  it('handles no query parameters', async () => {
    mockListDids.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/dids' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDids).toHaveBeenCalledWith('org-1', {
      type: undefined,
      status: undefined,
      serviceInstanceId: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('returns hasMore: true when more results exist', async () => {
    const dids = [{ id: '1' }, { id: '2' }];
    mockListDids.mockResolvedValue({ data: dids, total: 5 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/dids?limit=2&offset=0',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(json.pagination).toEqual({
      total: 5,
      limit: 2,
      offset: 0,
      hasMore: true,
    });
  });

  it('returns 400 for invalid type query parameter, and does not query the repository', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/dids?type=GARBAGE',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^type:/);
    expect(mockListDids).not.toHaveBeenCalled();
  });

  it('accepts the DEFAULT type in the query filter (the full enum, unlike the creatable POST subset)', async () => {
    mockListDids.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/dids?type=DEFAULT',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(200);
    expect(mockListDids).toHaveBeenCalledWith('org-1', expect.objectContaining({ type: 'DEFAULT' }));
  });

  it('returns 400 for invalid status query parameter, and does not query the repository', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/dids?status=GARBAGE',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^status:/);
    expect(mockListDids).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty serviceInstanceId filter, and does not query the repository', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/dids?serviceInstanceId=',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^serviceInstanceId:/);
    expect(mockListDids).not.toHaveBeenCalled();
  });

  it('returns 400 for non-numeric limit, and does not query the repository', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/dids?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('limit: must be a positive integer');
    expect(mockListDids).not.toHaveBeenCalled();
  });

  it('returns 400 for negative offset, and does not query the repository', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/dids?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('offset: must be a non-negative integer');
    expect(mockListDids).not.toHaveBeenCalled();
  });

  it('rejects a limit above the maximum with a 400, and does not query the repository', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: `http://localhost/api/v1/dids?limit=${MAX_PAGE_LIMIT + 1}`,
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/^limit:/);
    expect(mockListDids).not.toHaveBeenCalled();
  });

  it('returns 400 for a repeated query key, and does not query the repository', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/dids?limit=10&limit=20',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('repeated query parameter');
    expect(mockListDids).not.toHaveBeenCalled();
  });

  it('returns 500 when listDids throws', async () => {
    mockListDids.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/dids' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Database error');
  });
});
