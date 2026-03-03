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
const mockCreateRenderTemplate = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  listRenderTemplates: (tenantId: string, opts: unknown) => mockListRenderTemplates(tenantId, opts),
  createRenderTemplate: (tenantId: string, input: unknown) => mockCreateRenderTemplate(tenantId, input),
}));

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

  it('lists render templates for the tenant with no filters', async () => {
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
    mockListRenderTemplates.mockResolvedValue(renderTemplates);

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/render-templates' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.renderTemplates).toEqual(renderTemplates);
    expect(mockListRenderTemplates).toHaveBeenCalledWith('tenant-1', {
      dataModelId: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes dataModelId, limit, and offset query params to the repository', async () => {
    mockListRenderTemplates.mockResolvedValue([]);

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/render-templates?dataModelId=dm-1&limit=10&offset=20',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListRenderTemplates).toHaveBeenCalledWith('tenant-1', {
      dataModelId: 'dm-1',
      limit: 10,
      offset: 20,
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a render template and returns 201', async () => {
    const created = {
      id: 'rt-new',
      name: 'My Template',
      dataModelId: 'dm-1',
      storageUrl: 'https://example.com/template.html',
      hash: 'sha256-abc123',
      isPrimary: false,
    };
    mockCreateRenderTemplate.mockResolvedValue(created);

    const req = createFakeRequest({
      body: {
        name: 'My Template',
        dataModelId: 'dm-1',
        storageUrl: 'https://example.com/template.html',
        hash: 'sha256-abc123',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.renderTemplate).toEqual(created);
  });

  it('passes isPrimary to the repository when provided', async () => {
    mockCreateRenderTemplate.mockResolvedValue({ id: 'rt-new' });

    const req = createFakeRequest({
      body: {
        name: 'Primary Template',
        dataModelId: 'dm-1',
        storageUrl: 'https://example.com/template.html',
        hash: 'sha256-abc123',
        isPrimary: true,
      },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockCreateRenderTemplate).toHaveBeenCalledWith('tenant-1', {
      name: 'Primary Template',
      dataModelId: 'dm-1',
      storageUrl: 'https://example.com/template.html',
      hash: 'sha256-abc123',
      isPrimary: true,
    });
  });

  it('omits isPrimary when not provided', async () => {
    mockCreateRenderTemplate.mockResolvedValue({ id: 'rt-new' });

    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        storageUrl: 'https://example.com/template.html',
        hash: 'sha256-abc123',
      },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    const callArgs = mockCreateRenderTemplate.mock.calls[0][1];
    expect(callArgs).not.toHaveProperty('isPrimary');
  });

  it('returns 400 when name is missing', async () => {
    const req = createFakeRequest({
      body: {
        dataModelId: 'dm-1',
        storageUrl: 'https://example.com/template.html',
        hash: 'sha256-abc123',
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
        storageUrl: 'https://example.com/template.html',
        hash: 'sha256-abc123',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('dataModelId is required');
  });

  it('returns 400 when storageUrl is missing', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        hash: 'sha256-abc123',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('storageUrl is required');
  });

  it('returns 400 when hash is missing', async () => {
    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        storageUrl: 'https://example.com/template.html',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('hash is required');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 500 on unexpected error', async () => {
    mockCreateRenderTemplate.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({
      body: {
        name: 'Template',
        dataModelId: 'dm-1',
        storageUrl: 'https://example.com/template.html',
        hash: 'sha256-abc123',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
