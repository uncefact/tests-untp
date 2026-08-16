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
  apiLogger: { child: jest.fn().mockReturnValue(mockLogger) },
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

const mockListRenderTemplates = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  listRenderTemplates: (tenantId: string, opts: unknown) => mockListRenderTemplates(tenantId, opts),
}));

const mockCreateRenderTemplate = jest.fn();
jest.mock('@/lib/render-templates/create-render-template', () => ({
  createRenderTemplate: (...args: unknown[]) => mockCreateRenderTemplate(...args),
}));

const mockResolveStorageService = jest.fn();
jest.mock('@/lib/services/resolve-storage-service', () => ({
  resolveStorageService: (...args: unknown[]) => mockResolveStorageService(...args),
}));

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { GET, POST } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'POST', body, url = 'http://localhost/api/v1/render-templates' } = options;
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
    url: 'http://localhost/api/v1/render-templates',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'tenant-1', params: Promise.resolve({}) };

describe('GET /api/v1/render-templates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists render templates with paginated response', async () => {
    const renderTemplates = [
      {
        id: 'rt-1',
        name: 'DPP Template',
        dataModelId: 'dm-1',
        storageUrl: 'https://example.com/tpl1.html',
        digestMultibase: 'zTESTabc123',
      },
      {
        id: 'rt-2',
        name: 'DCC Template',
        dataModelId: 'dm-2',
        storageUrl: 'https://example.com/tpl2.html',
        digestMultibase: 'zTESTdef456',
      },
    ];
    mockListRenderTemplates.mockResolvedValue({ data: renderTemplates, total: 2 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/render-templates' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(renderTemplates);
    expect(json.pagination).toEqual({
      total: 2,
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
      hasMore: false,
    });
    expect(json).not.toHaveProperty('ok');
    expect(mockListRenderTemplates).toHaveBeenCalledWith('tenant-1', {
      dataModelId: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes dataModelId, limit, and offset query params to the repository', async () => {
    mockListRenderTemplates.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/render-templates?dataModelId=dm-1&limit=10&offset=20',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(mockListRenderTemplates).toHaveBeenCalledWith('tenant-1', {
      dataModelId: 'dm-1',
      limit: 10,
      offset: 20,
    });
    expect(json.pagination).toEqual({
      total: 0,
      limit: 10,
      offset: 20,
      hasMore: false,
    });
  });

  it('rejects a limit above the maximum with a 400 and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: `http://localhost/api/v1/render-templates?limit=${MAX_PAGE_LIMIT + 1}`,
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(`limit: must not exceed the maximum of ${MAX_PAGE_LIMIT}`);
    expect(mockListRenderTemplates).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid limit and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/render-templates?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit: must be a positive integer');
    expect(mockListRenderTemplates).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid offset and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/render-templates?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset: must be a non-negative integer');
    expect(mockListRenderTemplates).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-integer offset and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/render-templates?offset=1.5',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset: must be a non-negative integer');
    expect(mockListRenderTemplates).not.toHaveBeenCalled();
  });

  it('returns 400 for a repeated query key and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/render-templates?limit=10&limit=20',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('repeated query parameter');
    expect(mockListRenderTemplates).not.toHaveBeenCalled();
  });

  it('returns paginated response with hasMore when more records exist', async () => {
    const templates = [{ id: 'rt-1' }];
    mockListRenderTemplates.mockResolvedValue({ data: templates, total: 25 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/render-templates?limit=10&offset=0',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(json.pagination.hasMore).toBe(true);
    expect(json.pagination.total).toBe(25);
  });

  it('returns 500 when listRenderTemplates throws', async () => {
    mockListRenderTemplates.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/render-templates' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('POST /api/v1/render-templates', () => {
  const defaultStorageService = { service: {}, instanceId: 'storage-instance-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveStorageService.mockResolvedValue(defaultStorageService);
  });

  it('creates render template via orchestrator and returns 201', async () => {
    const created = {
      id: 'rt-new',
      name: 'My Template',
      dataModelId: 'dm-1',
      renderMethodType: 'RenderTemplate2024',
      storageUrl: 'https://example.com/template.html',
      hash: 'sha256-abc123',
      isDefault: false,
    };
    mockCreateRenderTemplate.mockResolvedValue(created);

    const req = createFakeRequest({
      body: {
        name: 'My Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual(created);
    expect(mockCreateRenderTemplate).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      name: 'My Template',
      dataModelId: 'dm-1',
      renderMethodType: 'RenderTemplate2024',
      template: '<div>Hello</div>',
      storageService: defaultStorageService,
      isDefault: undefined,
      inline: undefined,
      mediaType: undefined,
      mediaQuery: undefined,
    });
  });

  it('rejects when storageUrl is provided', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        storageUrl: 'https://example.com/sneaky.html',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('storageUrl: cannot be set directly');
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('rejects when digestMultibase is provided', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        digestMultibase: 'zTESTsneaky',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('digestMultibase: cannot be set directly');
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('rejects when legacy hash is provided', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        hash: 'sha256-sneaky',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('hash: is no longer accepted; use digestMultibase');
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('rejects when renderMethodType is missing', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        template: '<div>Hello</div>',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^renderMethodType:/);
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('rejects when renderMethodType is invalid', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'InvalidType',
        template: '<div>Hello</div>',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^renderMethodType:/);
    // Names the permitted values, so a client can correct the request without
    // reading the docs. Asserted by content rather than by zod's exact
    // sentence, which changes between zod versions.
    expect(json.error).toContain('RenderTemplate2024');
    expect(json.error).toContain('WebRenderingTemplate2022');
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('rejects when template is missing', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^template:/);
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('returns 400 when name is missing', async () => {
    const req = createFakeRequest({
      body: {
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^name:/);
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('returns 400 when dataModelId is missing', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^dataModelId:/);
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name', async () => {
    const req = createFakeRequest({
      body: {
        name: '   ',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('name: must not be only whitespace');
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  // A whitespace-only template and media field were accepted before the Zod
  // migration and still are. `sanitiseTemplate('   ')` returns it unchanged,
  // so nothing downstream treats a blank template as empty. Rejecting these
  // would be a separate decision, and these cases pin that this slice did not
  // quietly make it.
  it.each([
    ['template', { template: '   ' }],
    ['mediaType', { mediaType: '   ' }],
    ['mediaQuery', { mediaQuery: '   ' }],
  ])('still accepts a whitespace-only %s', async (_field, override) => {
    mockCreateRenderTemplate.mockResolvedValue({ id: 'rt-new' });

    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        ...override,
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(201);
    expect(mockCreateRenderTemplate).toHaveBeenCalledWith(expect.objectContaining(override));
  });

  it.each([
    ['name', { name: 42 }],
    ['dataModelId', { dataModelId: 42 }],
    ['template', { template: 42 }],
  ])('rejects a non-string %s, not only a missing one', async (field, override) => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        ...override,
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(`${field}: Expected string, received number`);
    expect(mockResolveStorageService).not.toHaveBeenCalled();
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('accepts null for mediaType and mediaQuery and forwards it as omitted', async () => {
    mockCreateRenderTemplate.mockResolvedValue({ id: 'rt-new' });

    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        mediaType: null,
        mediaQuery: null,
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(201);
    expect(mockCreateRenderTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: null, mediaQuery: null }),
    );
  });

  it('rejects a server-managed field sent as an explicit null', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        storageUrl: null,
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('storageUrl: cannot be set directly');
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  // The server-managed fields are declared first in the schema's shape, which
  // is what makes their issue the one reported when a body is wrong in more
  // than one way. Reordering the shape would flip this without failing any
  // single-fault test.
  it('reports the server-managed field first when the body is also otherwise invalid', async () => {
    const req = createFakeRequest({
      body: { name: 'Template', dataModelId: 'dm-1', storageUrl: 'https://example.com/sneaky.html' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('storageUrl: cannot be set directly');
  });

  it('rejects a wrong-typed storageOptions.serviceInstanceId', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        storageOptions: { serviceInstanceId: 123 },
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^storageOptions\.serviceInstanceId:/);
    expect(mockResolveStorageService).not.toHaveBeenCalled();
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it.each([
    ['isDefault', { isDefault: 'yes' }],
    ['inline', { inline: 'yes' }],
    ['mediaType', { mediaType: 42 }],
    ['mediaQuery', { mediaQuery: [] }],
  ])('rejects a wrong-typed %s and does not create', async (field, override) => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        ...override,
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(new RegExp(`^${field}:`));
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('rejects a non-object storageOptions instead of falling back to the default service', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        storageOptions: 'storage-instance-1',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^storageOptions:/);
    expect(mockResolveStorageService).not.toHaveBeenCalled();
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('returns 404 when the requested storage service instance does not resolve', async () => {
    const { ServiceInstanceNotFoundError } = jest.requireActual('@/lib/api/errors');
    mockResolveStorageService.mockRejectedValue(new ServiceInstanceNotFoundError('missing-instance'));

    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        storageOptions: { serviceInstanceId: 'missing-instance' },
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('missing-instance');
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('returns 400 for a null body', async () => {
    const req = createFakeRequest({ body: null });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('body: Expected object, received null');
    expect(mockCreateRenderTemplate).not.toHaveBeenCalled();
  });

  it('passes storageOptions.serviceInstanceId to resolveStorageService', async () => {
    mockCreateRenderTemplate.mockResolvedValue({ id: 'rt-new' });

    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
        storageOptions: { serviceInstanceId: 'custom-storage-1' },
      },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockResolveStorageService).toHaveBeenCalledWith('tenant-1', 'custom-storage-1');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 404 when orchestrator throws NotFoundError', async () => {
    const { NotFoundError } = jest.requireActual('@/lib/api/errors') as { NotFoundError: new (msg: string) => Error };
    mockCreateRenderTemplate.mockRejectedValue(new NotFoundError('Data model not found'));

    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-missing',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Data model not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockCreateRenderTemplate.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        renderMethodType: 'RenderTemplate2024',
        template: '<div>Hello</div>',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
