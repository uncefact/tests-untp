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
const mockGetInstanceByResolution = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  createIdentifierScheme: (input: unknown) => mockCreateIdentifierScheme(input),
  listIdentifierSchemes: (tenantId: string, opts: unknown) => mockListIdentifierSchemes(tenantId, opts),
  getRegistrarById: (id: string, tenantId: string) => mockGetRegistrarById(id, tenantId),
  getInstanceByResolution: (...args: unknown[]) => mockGetInstanceByResolution(...args),
}));

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { ConflictError } from '@/lib/api/errors';
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
    mockGetInstanceByResolution.mockResolvedValue({ id: 'inst-1', tenantId: 'org-1' });
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

  it('creates a scheme with a qualifier order and forwards it to the repository', async () => {
    const scheme = {
      id: 'sch-1',
      name: 'GTIN',
      qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: 2 }],
    };
    mockCreateIdentifierScheme.mockResolvedValue(scheme);

    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: 2 }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(201);
    expect(mockCreateIdentifierScheme).toHaveBeenCalledWith(
      expect.objectContaining({
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: 2 }],
      }),
    );
  });

  it.each([
    ['zero', 0],
    ['the int32 maximum', 2147483647],
  ])('accepts a qualifier order of %s and forwards it to the repository', async (_label, order) => {
    mockCreateIdentifierScheme.mockResolvedValue({ id: 'sch-1' });

    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(201);
    expect(mockCreateIdentifierScheme).toHaveBeenCalledWith(
      expect.objectContaining({
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order }],
      }),
    );
  });

  it('returns 400 for a negative qualifier order and does not call the repository', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: -5 }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^qualifiers\.0\.order:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-integer qualifier order and does not call the repository', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: 1.5 }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^qualifiers\.0\.order:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
  });

  it('returns 400 for an out-of-range qualifier order and does not call the repository', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [
          { key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: 3000000000 },
        ],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^qualifiers\.0\.order:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
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

    // Verifies the tenant-scoped accessibility check runs before the write
    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'IDR', 'inst-1');
    expect(mockCreateIdentifierScheme).toHaveBeenCalledWith(
      expect.objectContaining({
        idrServiceInstanceId: 'inst-1',
      }),
    );
  });

  it('skips the instance lookup when idrServiceInstanceId is omitted', async () => {
    mockCreateIdentifierScheme.mockResolvedValue({ id: 'sch-1' });

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

    expect(res.status).toBe(201);
    expect(mockGetInstanceByResolution).not.toHaveBeenCalled();
  });

  it('returns 404 when idrServiceInstanceId is not accessible to the tenant, and does not call the repository', async () => {
    // The row's foreign key would accept any globally-existing instance, so
    // the handler's tenant-scoped lookup is what keeps another tenant's
    // instance id from being stored; a null lookup result covers a
    // nonexistent id, another tenant's, and a non-IDR instance.
    mockGetInstanceByResolution.mockResolvedValue(null);

    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        idrServiceInstanceId: 'other-tenant-inst',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Service instance not found');
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 for missing registrarId', async () => {
    const req = createFakeRequest({
      body: { name: 'GTIN', primaryKey: 'gtin', validationPattern: '^\\d{14}$', linkTemplate: '/{primaryKey}/{value}' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^registrarId:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
  });

  it('returns 400 for missing name', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^name:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
  });

  it('returns 400 for a whitespace-only name and does not call the repository', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: '   ',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('name: must not be only whitespace');
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 for a whitespace-only qualifier key and does not call the repository', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: ' ', description: 'Batch or lot number', validationPattern: '^.+$' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('qualifiers.0.key: must not be only whitespace');
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 for missing primaryKey', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^primaryKey:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
  });

  it('returns 400 for missing validationPattern', async () => {
    const req = createFakeRequest({
      body: { registrarId: 'reg-1', name: 'GTIN', primaryKey: 'gtin', linkTemplate: '/{primaryKey}/{value}' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^validationPattern:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
  });

  it('returns 400 for a validationPattern that does not compile as a regular expression', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '[invalid',
        linkTemplate: '/{primaryKey}/{value}',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('validationPattern: must be a valid regular expression');
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid qualifier (missing key)', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^qualifiers\.0\.key:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid qualifier (missing description)', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: 'lot', validationPattern: '^[A-Za-z0-9]{1,20}$' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^qualifiers\.0\.description:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
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
    expect(json.error).toMatch(/^qualifiers\.0\.validationPattern:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
  });

  it('returns 400 for a qualifier validationPattern that does not compile as a regular expression', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '[invalid' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('qualifiers.0.validationPattern: must be a valid regular expression');
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
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
    expect(json.error).toMatch(/^qualifiers:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
  });

  it('returns 400 for missing linkTemplate', async () => {
    const req = createFakeRequest({
      body: { registrarId: 'reg-1', name: 'GTIN', primaryKey: 'gtin', validationPattern: '^\\d{14}$' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^linkTemplate:/);
    expect(mockCreateIdentifierScheme).not.toHaveBeenCalled();
    expect(mockGetRegistrarById).not.toHaveBeenCalled();
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

  it('returns 409 when the repository reports a primary-key clash for the registrar', async () => {
    mockCreateIdentifierScheme.mockRejectedValue(
      new ConflictError('An identifier scheme with this primary key already exists for the registrar'),
    );

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

    expect(res.status).toBe(409);
    expect(json.error).toBe('An identifier scheme with this primary key already exists for the registrar');
    expect(mockCreateIdentifierScheme).toHaveBeenCalled();
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
    expect(json.error).toContain('limit: must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/schemes?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset: must be a non-negative integer');
  });

  it('rejects a limit above the maximum with a 400 and does not query', async () => {
    mockListIdentifierSchemes.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: `http://localhost/api/v1/schemes?limit=${MAX_PAGE_LIMIT + 1}`,
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^limit:/);
    expect(mockListIdentifierSchemes).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty registrarId filter', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/schemes?registrarId=',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^registrarId:/);
    expect(mockListIdentifierSchemes).not.toHaveBeenCalled();
  });

  it('returns 400 for a repeated query key', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/schemes?limit=10&limit=20',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('repeated query parameter');
    expect(mockListIdentifierSchemes).not.toHaveBeenCalled();
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
