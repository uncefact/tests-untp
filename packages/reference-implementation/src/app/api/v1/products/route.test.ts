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

const mockCreateProducts = jest.fn();
const mockListProducts = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  createProducts: (tenantId: string, inputs: unknown) => mockCreateProducts(tenantId, inputs),
  listProducts: (tenantId: string, opts: unknown) => mockListProducts(tenantId, opts),
}));

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { POST, GET } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'POST', body, url = 'http://localhost/api/v1/products' } = options;
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
    url: 'http://localhost/api/v1/products',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('POST /api/v1/products', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates products and returns 201', async () => {
    const products = [
      { id: 'p-1', name: 'Widget A', level: 'MODEL' },
      { id: 'p-2', name: 'Widget B', level: 'BATCH' },
    ];
    mockCreateProducts.mockResolvedValue(products);

    const req = createFakeRequest({
      body: [
        { name: 'Widget A', level: 'MODEL' },
        { name: 'Widget B', level: 'BATCH' },
      ],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual(products);
  });

  it('returns 400 when body is not an array', async () => {
    const req = createFakeRequest({ body: { name: 'Widget A', level: 'MODEL' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Request body must be an array');
  });

  it('returns 400 when body is an empty array', async () => {
    const req = createFakeRequest({ body: [] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Request body must not be empty');
  });

  it('returns 400 when name is missing', async () => {
    const req = createFakeRequest({ body: [{ level: 'MODEL' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name is required for all items');
  });

  it('returns 400 when level is missing', async () => {
    const req = createFakeRequest({ body: [{ name: 'Widget A' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('level is required for all items');
  });

  it('returns 400 when level is not a valid enum value', async () => {
    const req = createFakeRequest({ body: [{ name: 'Widget A', level: 'INVALID' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('level must be one of: MODEL, BATCH, ITEM');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 404 when repository throws NotFoundError', async () => {
    mockCreateProducts.mockRejectedValue(new NotFoundError('Parent product not found'));

    const req = createFakeRequest({ body: [{ name: 'Widget A', level: 'BATCH' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Parent product not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockCreateProducts.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ body: [{ name: 'Widget A', level: 'MODEL' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });

  it('returns 409 when an identifier already belongs to another product', async () => {
    mockCreateProducts.mockRejectedValue(
      new ConflictError('An identifier in this request is already the primary identifier of another product'),
    );

    const req = createFakeRequest({
      body: [{ name: 'Widget A', level: 'MODEL', primaryIdentifierId: 'ident-1' }],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('An identifier in this request is already the primary identifier of another product');
    // The identifier the conflict is about must actually reach the repository.
    expect(mockCreateProducts).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ primaryIdentifierId: 'ident-1' })]),
    );
  });
});

describe('GET /api/v1/products', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists products for the tenant', async () => {
    const products = [{ id: 'p-1', name: 'Widget A', level: 'MODEL' }];
    mockListProducts.mockResolvedValue({ data: products, total: 1 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/products' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(products);
    expect(json.pagination).toEqual(expect.objectContaining({ total: 1, offset: 0 }));
  });

  it('passes all filter parameters to listProducts', async () => {
    mockListProducts.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/products?search=widget&level=MODEL&parentId=p-0&organisationId=org-2&facilityId=fac-1&limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListProducts).toHaveBeenCalledWith('org-1', {
      search: 'widget',
      level: 'MODEL',
      parentId: 'p-0',
      organisationId: 'org-2',
      facilityId: 'fac-1',
      limit: 10,
      offset: 5,
    });
  });

  it('handles no query parameters', async () => {
    mockListProducts.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/products' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListProducts).toHaveBeenCalledWith('org-1', {
      search: undefined,
      level: undefined,
      parentId: undefined,
      organisationId: undefined,
      facilityId: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('returns 400 for invalid level enum', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/products?level=INVALID',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('level must be one of: MODEL, BATCH, ITEM');
  });

  it('returns 400 for non-numeric limit', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/products?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/products?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset must be a non-negative integer');
  });

  it('returns pagination metadata with custom limit and offset', async () => {
    mockListProducts.mockResolvedValue({ data: [], total: 50 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/products?limit=10&offset=20',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(json.pagination).toEqual({ total: 50, limit: 10, offset: 20, hasMore: true });
  });

  it('returns 500 when listProducts throws', async () => {
    mockListProducts.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/products' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
