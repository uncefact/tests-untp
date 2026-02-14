// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withTenantAuth as passthrough
jest.mock('@/lib/api/with-tenant-auth', () => ({
  withTenantAuth: (handler: (...args: unknown[]) => unknown) => handler,
}));

const mockCreateIdentifierScheme = jest.fn();
const mockListIdentifierSchemes = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  createIdentifierScheme: (input: unknown) => mockCreateIdentifierScheme(input),
  listIdentifierSchemes: (tenantId: string, opts: unknown) => mockListIdentifierSchemes(tenantId, opts),
}));

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
  });

  it('creates a scheme and returns 201', async () => {
    const scheme = { id: 'sch-1', name: 'GTIN', primaryKey: 'gtin', validationPattern: '^\\d{14}$' };
    mockCreateIdentifierScheme.mockResolvedValue(scheme);

    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.scheme).toEqual(scheme);
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
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.scheme.qualifiers).toHaveLength(1);
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
        namespace: 'gs1',
        idrServiceInstanceId: 'inst-1',
      },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockCreateIdentifierScheme).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'gs1',
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
    expect(json.error).toContain('registrarId is required');
  });

  it('returns 400 for missing name', async () => {
    const req = createFakeRequest({
      body: { registrarId: 'reg-1', primaryKey: 'gtin', validationPattern: '^\\d{14}$' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name is required');
  });

  it('returns 400 for missing primaryKey', async () => {
    const req = createFakeRequest({
      body: { registrarId: 'reg-1', name: 'GTIN', validationPattern: '^\\d{14}$' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('primaryKey is required');
  });

  it('returns 400 for missing validationPattern', async () => {
    const req = createFakeRequest({
      body: { registrarId: 'reg-1', name: 'GTIN', primaryKey: 'gtin' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('validationPattern is required');
  });

  it('returns 400 for invalid qualifier (missing key)', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        qualifiers: [{ description: 'Lot number' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('qualifier key is required');
  });

  it('returns 400 for invalid qualifier (missing description)', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        qualifiers: [{ key: 'lot' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('qualifier description is required');
  });

  it('returns 400 for invalid qualifier (missing validationPattern)', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        qualifiers: [{ key: 'lot', description: 'Lot number' }],
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('qualifier validationPattern is required');
  });

  it('returns 400 for non-array qualifiers', async () => {
    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
        qualifiers: 'not-an-array',
      },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('qualifiers must be an array');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 500 when repository throws', async () => {
    mockCreateIdentifierScheme.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({
      body: {
        registrarId: 'reg-1',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{14}$',
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
    mockListIdentifierSchemes.mockResolvedValue(schemes);

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/schemes' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.schemes).toEqual(schemes);
  });

  it('passes registrarId filter to listIdentifierSchemes', async () => {
    mockListIdentifierSchemes.mockResolvedValue([]);

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
    mockListIdentifierSchemes.mockResolvedValue([]);

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
    mockListIdentifierSchemes.mockResolvedValue([]);

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
