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

const mockCreateIdentifierScheme = jest.fn();
const mockListIdentifierSchemes = jest.fn();
const mockGetRegistrarById = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  createIdentifierScheme: (input: unknown) => mockCreateIdentifierScheme(input),
  listIdentifierSchemes: (tenantId: string, opts: unknown) => mockListIdentifierSchemes(tenantId, opts),
  getRegistrarById: (id: string, tenantId: string) => mockGetRegistrarById(id, tenantId),
}));

import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import { POST, GET } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'POST', body, url = 'http://localhost/api/v1/schemes' } = options;
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
    url: 'http://localhost/api/v1/schemes',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('POST /api/v1/schemes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRegistrarById.mockResolvedValue({ id: 'reg-1', name: 'GS1' });
  });

  it('creates a scheme and returns 201', async () => {
    const scheme = {
      id: 'sch-1',
      name: 'GTIN',
      primaryKey: 'gtin',
      validationPattern: '^\\d{14}$',
      linkTemplate: '/{primaryKey}/{value}',
    };
    mockCreateIdentifierScheme.mockResolvedValue(scheme);

    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual(scheme);
  });

  it('creates a scheme with nested qualifiers', async () => {
    const scheme = {
      id: 'sch-1',
      name: 'GTIN',
      qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$' }],
    };
    mockCreateIdentifierScheme.mockResolvedValue(scheme);

    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.qualifiers).toHaveLength(1);
    expect(mockCreateIdentifierScheme).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$' }],
      }),
    );
  });

  it('creates a scheme with optional fields', async () => {
    mockCreateIdentifierScheme.mockResolvedValue({ id: 'sch-1' });

    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        idrServiceInstanceId: 'inst-1',
      },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockCreateIdentifierScheme).toHaveBeenCalledWith(
      expect.objectContaining({
        idrServiceInstanceId: 'inst-1',
      }),
    );
  });

  it('returns 400 for missing registrarId', async () => {
    const req = createFakeRequest({
      body: { name: 'GTIN', primaryKey: 'gtin', validationPattern: '^\\d{14}$' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('registrarId');
  });

  it('returns 400 for missing name', async () => {
    const req = createFakeRequest({
      body: { registrarId: 'reg-1', primaryKey: 'gtin', validationPattern: '^\\d{14}$' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name');
  });

  it('returns 400 for missing primaryKey', async () => {
    const req = createFakeRequest({
      body: { registrarId: 'reg-1', name: 'GTIN', validationPattern: '^\\d{14}$' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('primaryKey');
  });

  it('returns 400 for missing validationPattern', async () => {
    const req = createFakeRequest({
      body: { registrarId: 'reg-1', name: 'GTIN', primaryKey: 'gtin' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('validationPattern');
  });

  it('returns 400 for invalid qualifier (missing key)', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ description: 'Lot number' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/qualifiers\.\d+\.key/);
  });

  it('returns 400 for invalid qualifier (missing description)', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: 'lot' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/qualifiers\.\d+\.description/);
  });

  it('returns 400 for invalid qualifier (missing validationPattern)', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: 'lot', description: 'Lot number' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/qualifiers\.\d+\.validationPattern/);
  });

  it('returns 400 for non-array qualifiers', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: 'not-an-array',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('qualifiers');
  });

  it('returns 400 for a non-integer qualifier order', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '.*', order: 1.5 }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('order');
  });

  it('returns 400 for a JSON null body', async () => {
    const req = createFakeRequest({ body: null });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('body');
  });

  it('returns 400 for a null qualifier item', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [null],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('qualifiers');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 for missing linkTemplate', async () => {
    const req = createFakeRequest({
      body: { registrarId: 'reg-1', name: 'GTIN', primaryKey: 'gtin', validationPattern: '^\\d{14}$' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('linkTemplate');
  });

  it('returns 404 when registrarId does not exist', async () => {
    mockGetRegistrarById.mockResolvedValue(null);

    const req = createFakeRequest({
      body: {
        registrarId: 'nonexistent-reg',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Registrar not found');
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 500 when repository throws', async () => {
    mockCreateIdentifierScheme.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('GET /api/v1/schemes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists schemes for the tenant', async () => {
    const schemes = [{ id: 'sch-1', name: 'GTIN' }];
    mockListIdentifierSchemes.mockResolvedValue({ data: schemes, total: 1 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/schemes' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(schemes);
    expect(json.pagination).toEqual({ total: 1, limit: DEFAULT_PAGE_LIMIT, offset: 0, hasMore: false });
  });

  it('passes registrarId filter to listIdentifierSchemes', async () => {
    mockListIdentifierSchemes.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/schemes?registrarId=reg-1',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListIdentifierSchemes).toHaveBeenCalledWith('org-1', {
      registrarId: 'reg-1',
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes pagination parameters', async () => {
    mockListIdentifierSchemes.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/schemes?limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListIdentifierSchemes).toHaveBeenCalledWith('org-1', {
      registrarId: undefined,
      limit: 10,
      offset: 5,
    });
  });

  it('handles no query parameters', async () => {
    mockListIdentifierSchemes.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/schemes' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListIdentifierSchemes).toHaveBeenCalledWith('org-1', {
      registrarId: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('returns 400 for non-numeric limit', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/schemes?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/schemes?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset must be a non-negative integer');
  });

  it('returns 500 when listIdentifierSchemes throws', async () => {
    mockListIdentifierSchemes.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/schemes' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
