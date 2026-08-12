// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock logger to prevent real logging during tests
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

jest.mock('@/lib/api/logger', () => ({
  apiLogger: {
    child: jest.fn().mockReturnValue(mockLogger),
  },
}));

// Mock withTenantAuth — skips auth but preserves error handling via handleRouteError
jest.mock('@/lib/api/with-tenant-auth', () => {
  const { handleRouteError } = jest.requireActual('@/lib/api/handle-route-error');
  return {
    withTenantAuth:
      (handler: (...args: unknown[]) => unknown) =>
      async (...args: unknown[]) => {
        try {
          return await handler(...args);
        } catch (e) {
          return handleRouteError(e);
        }
      },
  };
});

const mockListDataModels = jest.fn();
const mockCreateDataModel = jest.fn();

const mockValidatePublicUrl = jest.fn();
jest.mock('@uncefact/untp-ri-services/server', () => ({
  validatePublicUrl: (...args: unknown[]) => mockValidatePublicUrl(...args),
}));

jest.mock('@/lib/prisma/repositories', () => ({
  listDataModels: (tenantId: string, opts: unknown) => mockListDataModels(tenantId, opts),
  createDataModel: (tenantId: string, input: unknown) => mockCreateDataModel(tenantId, input),
}));

import { NotFoundError } from '@/lib/api/errors';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { GET, POST } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'POST', body, url = 'http://localhost/api/v1/data-models' } = options;
  const bodyString = body !== undefined ? JSON.stringify(body) : undefined;
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
    url: 'http://localhost/api/v1/data-models',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'tenant-1', params: Promise.resolve({}) };

describe('GET /api/v1/data-models', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists data models for the tenant with no filters', async () => {
    const dataModels = [
      { id: 'cfg-1', name: 'DPP v0.6.0', credentialType: 'DigitalProductPassport' },
      { id: 'cfg-2', name: 'DCC v0.6.0', credentialType: 'DigitalConformityCredential' },
    ];
    mockListDataModels.mockResolvedValue({ data: dataModels, total: 2 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/data-models' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(dataModels);
    expect(json.pagination).toEqual({ total: 2, limit: DEFAULT_PAGE_LIMIT, offset: 0, hasMore: false });
    expect(mockListDataModels).toHaveBeenCalledWith('tenant-1', {
      isExtension: undefined,
      credentialType: undefined,
      version: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes isExtension=true filter correctly', async () => {
    mockListDataModels.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/data-models?isExtension=true',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDataModels).toHaveBeenCalledWith('tenant-1', {
      isExtension: true,
      credentialType: undefined,
      version: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes isExtension=false filter correctly', async () => {
    mockListDataModels.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/data-models?isExtension=false',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDataModels).toHaveBeenCalledWith('tenant-1', {
      isExtension: false,
      credentialType: undefined,
      version: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('returns 400 for invalid isExtension value', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/data-models?isExtension=maybe',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('isExtension must be "true" or "false"');
  });

  it('passes credentialType filter correctly', async () => {
    mockListDataModels.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/data-models?credentialType=DigitalProductPassport',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDataModels).toHaveBeenCalledWith('tenant-1', {
      isExtension: undefined,
      credentialType: 'DigitalProductPassport',
      version: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('accepts any non-empty credentialType string as a filter', async () => {
    mockListDataModels.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/data-models?credentialType=DigitalLivestockPassport',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDataModels).toHaveBeenCalledWith('tenant-1', {
      isExtension: undefined,
      credentialType: 'DigitalLivestockPassport',
      version: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes version filter correctly', async () => {
    mockListDataModels.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/data-models?version=0.6.0',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDataModels).toHaveBeenCalledWith('tenant-1', {
      isExtension: undefined,
      credentialType: undefined,
      version: '0.6.0',
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes pagination parameters correctly', async () => {
    mockListDataModels.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/data-models?limit=10&offset=20',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDataModels).toHaveBeenCalledWith('tenant-1', {
      isExtension: undefined,
      credentialType: undefined,
      version: undefined,
      limit: 10,
      offset: 20,
    });
  });

  it('passes all filters together', async () => {
    mockListDataModels.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/data-models?isExtension=true&credentialType=DigitalFacilityRecord&version=0.6.0&limit=5&offset=0',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDataModels).toHaveBeenCalledWith('tenant-1', {
      isExtension: true,
      credentialType: 'DigitalFacilityRecord',
      version: '0.6.0',
      limit: 5,
      offset: 0,
    });
  });

  it('strips parentConfig from the response data', async () => {
    const dataModels = [
      {
        id: 'cfg-1',
        name: 'DPP v0.6.0',
        credentialType: 'DigitalProductPassport',
        parentConfig: { id: 'parent-1', name: 'Parent' },
      },
      {
        id: 'cfg-2',
        name: 'DCC v0.6.0',
        credentialType: 'DigitalConformityCredential',
        parentConfig: { id: 'parent-2', name: 'Parent 2' },
      },
    ];
    mockListDataModels.mockResolvedValue({ data: dataModels, total: 2 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/data-models' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    for (const item of json.data) {
      expect(item).not.toHaveProperty('parentConfig');
    }
    expect(json.data[0]).toEqual({ id: 'cfg-1', name: 'DPP v0.6.0', credentialType: 'DigitalProductPassport' });
  });

  it('clamps limit to maximum', async () => {
    mockListDataModels.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/data-models?limit=500',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDataModels).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ limit: MAX_PAGE_LIMIT }));
  });

  it('returns 400 for non-numeric limit', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/data-models?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/data-models?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset must be a non-negative integer');
  });

  it('returns 500 when listDataModels throws', async () => {
    mockListDataModels.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/data-models' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('POST /api/v1/data-models', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a data model extension and returns 201', async () => {
    const created = {
      id: 'cfg-new',
      name: 'Custom DPP Extension',
      credentialType: 'DigitalProductPassport',
      version: '0.6.0',
      schemaUrl: 'https://example.com/schema.json',
      contextUrl: 'https://example.com/context.jsonld',
      isExtension: true,
      parentConfigId: 'cfg-parent',
    };
    mockCreateDataModel.mockResolvedValue(created);

    const req = createFakeRequest({
      body: {
        name: 'Custom DPP Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual(created);
  });

  it('passes isExtension=true and all fields to the repository', async () => {
    mockCreateDataModel.mockResolvedValue({ id: 'cfg-new' });

    const req = createFakeRequest({
      body: {
        name: 'My Extension',
        credentialType: 'DigitalConformityCredential',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
        websiteUrl: 'https://example.com',
      },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockCreateDataModel).toHaveBeenCalledWith('tenant-1', {
      name: 'My Extension',
      credentialType: 'DigitalConformityCredential',
      version: '0.6.0',
      schemaUrl: 'https://example.com/schema.json',
      contextUrl: 'https://example.com/context.jsonld',
      parentConfigId: 'cfg-parent',
      websiteUrl: 'https://example.com',
      isExtension: true,
    });
  });

  it('defaults isExtension to true even when not provided', async () => {
    mockCreateDataModel.mockResolvedValue({ id: 'cfg-new' });

    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockCreateDataModel).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ isExtension: true }));
  });

  it('returns 400 when name is missing', async () => {
    const req = createFakeRequest({
      body: {
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name is required');
  });

  it('returns 400 when credentialType is missing', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Extension',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('credentialType is required');
  });

  it('accepts a custom credentialType string', async () => {
    const created = {
      id: 'cfg-custom',
      name: 'Livestock Passport Extension',
      credentialType: 'DigitalLivestockPassport',
      version: '0.6.0',
      schemaUrl: 'https://example.com/schema.json',
      contextUrl: 'https://example.com/context.jsonld',
      isExtension: true,
      parentConfigId: 'cfg-parent',
    };
    mockCreateDataModel.mockResolvedValue(created);

    const req = createFakeRequest({
      body: {
        name: 'Livestock Passport Extension',
        credentialType: 'DigitalLivestockPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.credentialType).toBe('DigitalLivestockPassport');
    expect(mockCreateDataModel).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        credentialType: 'DigitalLivestockPassport',
      }),
    );
  });

  it('returns 400 when version is missing', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('version is required');
  });

  it('returns 400 when schemaUrl is missing', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('schemaUrl is required');
  });

  it('returns 400 when contextUrl is missing', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        parentConfigId: 'cfg-parent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('contextUrl is required');
  });

  it('returns 400 when parentConfigId is missing', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('parentConfigId is required');
  });

  it('returns 400 when websiteUrl is empty string', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
        websiteUrl: '',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('websiteUrl must be a non-empty string');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 404 when repository throws NotFoundError', async () => {
    mockCreateDataModel.mockRejectedValue(new NotFoundError('Parent data model configuration not found'));

    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-nonexistent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Parent data model configuration not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockCreateDataModel.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });

  it('includes optional websiteUrl when provided', async () => {
    mockCreateDataModel.mockResolvedValue({ id: 'cfg-new' });

    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
        websiteUrl: 'https://example.com',
      },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockCreateDataModel).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ websiteUrl: 'https://example.com' }),
    );
  });

  it('omits websiteUrl when not provided', async () => {
    mockCreateDataModel.mockResolvedValue({ id: 'cfg-new' });

    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    const callArgs = mockCreateDataModel.mock.calls[0][1];
    expect(callArgs).not.toHaveProperty('websiteUrl');
  });

  it('returns 400 when schemaUrl points to a private address', async () => {
    mockValidatePublicUrl.mockRejectedValueOnce(
      new Error('uri must not point to a private or reserved network address'),
    );

    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'http://127.0.0.1/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/schemaUrl.*private or reserved/);
  });

  it('returns 400 when contextUrl points to a private address', async () => {
    mockValidatePublicUrl
      .mockResolvedValueOnce(undefined) // schemaUrl passes
      .mockRejectedValueOnce(new Error('uri must not point to a private or reserved network address')); // contextUrl fails

    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'http://169.254.169.254/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/contextUrl.*private or reserved/);
  });

  it('returns 400 when schemaUrl is not a valid URL', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Extension',
        credentialType: 'DigitalProductPassport',
        version: '0.6.0',
        schemaUrl: 'not-a-url',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'cfg-parent',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/schemaUrl.*valid URL/);
  });
});
