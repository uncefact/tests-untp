// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
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

import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
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
        hash: 'abc123',
      },
      {
        id: 'rt-2',
        name: 'DCC Template',
        dataModelId: 'dm-2',
        storageUrl: 'https://example.com/tpl2.html',
        hash: 'def456',
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

  it('returns 400 for invalid limit', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/render-templates?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for invalid offset', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/render-templates?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset must be a non-negative integer');
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
      isPrimary: false,
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
      isPrimary: undefined,
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
    expect(json.error).toContain('storageUrl cannot be set directly');
  });

  it('rejects when hash is provided', async () => {
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
    expect(json.error).toContain('hash cannot be set directly');
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
    expect(json.error).toContain('renderMethodType is required');
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
    expect(json.error).toContain('renderMethodType must be one of:');
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
    expect(json.error).toContain('template is required');
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
    expect(json.error).toContain('name is required');
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
    expect(json.error).toContain('dataModelId is required');
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
