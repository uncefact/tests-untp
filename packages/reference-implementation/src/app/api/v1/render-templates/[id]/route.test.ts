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

const mockGetRenderTemplateById = jest.fn();
const mockUpdateRenderTemplate = jest.fn();
const mockDeleteRenderTemplate = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getRenderTemplateById: (id: string, tenantId: string) => mockGetRenderTemplateById(id, tenantId),
  updateRenderTemplate: (id: string, tenantId: string, input: unknown) => mockUpdateRenderTemplate(id, tenantId, input),
  deleteRenderTemplate: (id: string, tenantId: string) => mockDeleteRenderTemplate(id, tenantId),
}));

import { NotFoundError } from '@/lib/api/errors';
import { GET, PATCH, DELETE } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/render-templates/rt-1' } = options;
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

function createContext(id: string) {
  return { tenantId: 'tenant-1', params: Promise.resolve({ id }) };
}

describe('GET /api/v1/render-templates/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the render template by id', async () => {
    const renderTemplate = {
      id: 'rt-1',
      name: 'DPP Default Template',
      storageUrl: 'https://storage.example.com/templates/dpp.html',
      hash: 'abc123',
      isPrimary: true,
      dataModel: { id: 'dm-1', name: 'DPP v0.6.0' },
    };
    mockGetRenderTemplateById.mockResolvedValue(renderTemplate);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('rt-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.renderTemplate).toEqual(renderTemplate);
    expect(mockGetRenderTemplateById).toHaveBeenCalledWith('rt-1', 'tenant-1');
  });

  it('returns 404 when render template not found', async () => {
    mockGetRenderTemplateById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Render template not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetRenderTemplateById.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await GET(req, createContext('rt-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('PATCH /api/v1/render-templates/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates the render template metadata', async () => {
    const updated = {
      id: 'rt-1',
      name: 'Updated Template',
      storageUrl: 'https://storage.example.com/templates/dpp-v2.html',
      hash: 'def456',
      isPrimary: false,
      dataModel: { id: 'dm-1', name: 'DPP v0.6.0' },
    };
    mockUpdateRenderTemplate.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Template' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.renderTemplate).toEqual(updated);
    expect(mockUpdateRenderTemplate).toHaveBeenCalledWith('rt-1', 'tenant-1', {
      name: 'Updated Template',
    });
  });

  it('updates isPrimary', async () => {
    const updated = {
      id: 'rt-1',
      name: 'DPP Default Template',
      isPrimary: true,
      dataModel: { id: 'dm-1', name: 'DPP v0.6.0' },
    };
    mockUpdateRenderTemplate.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { isPrimary: true } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.renderTemplate).toEqual(updated);
    expect(mockUpdateRenderTemplate).toHaveBeenCalledWith('rt-1', 'tenant-1', {
      isPrimary: true,
    });
  });

  it('returns 400 for empty body (no updatable fields)', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one updatable field must be provided');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      method: 'PATCH',
      url: 'http://localhost/api/v1/render-templates/rt-1',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Request;
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 when name is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name must be a non-empty string');
  });

  it('returns 400 when storageUrl is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { storageUrl: '' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('storageUrl must be a non-empty string');
  });

  it('returns 400 when hash is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { hash: '' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('hash must be a non-empty string');
  });

  it('returns 400 when isPrimary is not a boolean', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { isPrimary: 'yes' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('isPrimary must be a boolean');
  });

  it('returns 404 when repository throws NotFoundError', async () => {
    mockUpdateRenderTemplate.mockRejectedValue(new NotFoundError('Render template not found or access denied'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Render template not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockUpdateRenderTemplate.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('rt-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('DELETE /api/v1/render-templates/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the render template and returns it', async () => {
    const deleted = { id: 'rt-1', name: 'Deleted Template' };
    mockDeleteRenderTemplate.mockResolvedValue(deleted);

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('rt-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.renderTemplate).toEqual(deleted);
    expect(mockDeleteRenderTemplate).toHaveBeenCalledWith('rt-1', 'tenant-1');
  });

  it('returns 404 when repository throws NotFoundError', async () => {
    mockDeleteRenderTemplate.mockRejectedValue(new NotFoundError('Render template not found or access denied'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Render template not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockDeleteRenderTemplate.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('rt-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
