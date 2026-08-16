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
import { MAX_PAGE_LIMIT } from '@/lib/api/pagination';
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

const VALID_ITEM = { name: 'Widget', level: 'MODEL' };

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
    expect(json.error).toMatch(/^0\.name:/);
  });

  it('returns 400 when level is missing', async () => {
    const req = createFakeRequest({ body: [{ name: 'Widget A' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.level:/);
  });

  it('returns 400 when level is not a valid enum value', async () => {
    const req = createFakeRequest({ body: [{ name: 'Widget A', level: 'INVALID' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.level:/);
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

  // The previous handler read `item.name` straight off each array element, so
  // a null item threw a TypeError that reached the client as a 500 carrying
  // the raw JavaScript message. Only null did this: a string or array element
  // yields undefined on property access and failed cleanly.
  it('returns 400 for a null array item and does not reach the repository', async () => {
    const req = createFakeRequest({ body: [null] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0:/);
    expect(mockCreateProducts).not.toHaveBeenCalled();
  });

  it('returns 400 for a whitespace-only name', async () => {
    const req = createFakeRequest({ body: [{ name: '   ', level: 'MODEL' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('0.name: must not be only whitespace');
    expect(mockCreateProducts).not.toHaveBeenCalled();
  });

  // Create has no null-to-clear contract, so an optional field sent as null is
  // rejected rather than stored as null. Omitting it is how a client skips it.
  it.each([
    ['description'],
    ['parentId'],
    ['producedByOrganisationId'],
    ['manufacturingFacilityId'],
    ['primaryIdentifierId'],
    ['secondaryIdentifierIds'],
  ])('returns 400 when the optional %s is sent as null on create', async (field) => {
    const req = createFakeRequest({ body: [{ name: 'Widget', level: 'MODEL', [field]: null }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(new RegExp(`^0\\.${field}:`));
    expect(mockCreateProducts).not.toHaveBeenCalled();
  });

  it('returns 400 for duplicate secondary identifiers in one item', async () => {
    const req = createFakeRequest({
      body: [{ name: 'Widget', level: 'MODEL', secondaryIdentifierIds: ['id-1', 'id-1'] }],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('0.secondaryIdentifierIds: must not contain duplicate identifiers');
    expect(mockCreateProducts).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-array secondaryIdentifierIds', async () => {
    const req = createFakeRequest({ body: [{ name: 'Widget', level: 'MODEL', secondaryIdentifierIds: 'id-1' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    expect(mockCreateProducts).not.toHaveBeenCalled();
  });

  it('forwards a valid item with every optional field omitted', async () => {
    mockCreateProducts.mockResolvedValue([{ id: 'p-1', name: 'Widget', level: 'MODEL' }]);

    const req = createFakeRequest({ body: [VALID_ITEM] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(201);
    expect(mockCreateProducts).toHaveBeenCalledWith('org-1', [VALID_ITEM]);
  });

  it.each([[''], ['   ']])('returns 400 for a description of %p on create', async (description) => {
    const req = createFakeRequest({ body: [{ ...VALID_ITEM, description }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    expect(mockCreateProducts).not.toHaveBeenCalled();
  });

  // An empty string reached the repository's `?.length` check as zero and was
  // treated as "no secondary identifiers", so this created a product. It is
  // now a type error at the boundary.
  it('returns 400 for an empty-string secondaryIdentifierIds on create', async () => {
    const req = createFakeRequest({ body: [{ ...VALID_ITEM, secondaryIdentifierIds: '' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    expect(mockCreateProducts).not.toHaveBeenCalled();
  });

  // These reached the repository's `?.length` check as falsy, so the old code
  // treated them as "no secondary identifiers" and created the product.
  it.each([[false], [0]])('returns 400 for a falsy non-array secondaryIdentifierIds of %p', async (value) => {
    const req = createFakeRequest({ body: [{ ...VALID_ITEM, secondaryIdentifierIds: value }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    expect(mockCreateProducts).not.toHaveBeenCalled();
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
    expect(json.error).toMatch(/^level:/);
  });

  it('returns 400 for non-numeric limit', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/products?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('limit: must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/products?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('offset: must be a non-negative integer');
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

  // The route rejects an over-maximum limit rather than clamping it, so the
  // client is told the bound instead of receiving a quietly smaller page.
  it('returns 400 when limit exceeds the maximum and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: `http://localhost/api/v1/products?limit=${MAX_PAGE_LIMIT + 1}`,
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(`limit: must not exceed the maximum of ${MAX_PAGE_LIMIT}`);
    expect(mockListProducts).not.toHaveBeenCalled();
  });

  // parseInt read the leading digits of each of these, so most were accepted
  // as a smaller number. `0x10` is the exception on `limit`: it parsed to 0
  // and already failed the positive check, though it was accepted as an
  // `offset`. The strict parser rejects the whole set, which is the
  // tightening #795 asks for.
  it.each([['1abc'], ['5.5'], ['10.0'], ['1e1'], ['0x10']])('returns 400 for a limit of %s', async (value) => {
    const req = createFakeRequest({ method: 'GET', url: `http://localhost/api/v1/products?limit=${value}` });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    expect(mockListProducts).not.toHaveBeenCalled();
  });

  it('returns 400 for a repeated query key', async () => {
    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/products?limit=5&limit=6' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    expect(mockListProducts).not.toHaveBeenCalled();
  });

  // A bad filter is reported ahead of a bad pagination value, which is the
  // parameter this route named before the migration.
  it('names the level filter when both level and limit are invalid', async () => {
    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/products?level=NOPE&limit=abc' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^level:/);
  });

  // Empty filter values are accepted today and stay accepted: `search` is
  // skipped by a falsy check, and the id filters match by exact equality.
  it('accepts empty filter values and forwards them unchanged', async () => {
    mockListProducts.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/products?search=&parentId=&organisationId=&facilityId=',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(200);
    expect(mockListProducts).toHaveBeenCalledWith('org-1', {
      search: '',
      level: undefined,
      parentId: '',
      organisationId: '',
      facilityId: '',
      limit: undefined,
      offset: undefined,
    });
  });

  // `offset=0x10` is the case the old radix-10 parseInt accepted as 0.
  it.each([['1abc'], ['5.5'], ['0x10']])('returns 400 for an offset of %s', async (value) => {
    const req = createFakeRequest({ method: 'GET', url: `http://localhost/api/v1/products?offset=${value}` });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    expect(mockListProducts).not.toHaveBeenCalled();
  });

  it('names limit ahead of offset when both are invalid', async () => {
    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/products?limit=abc&offset=xyz' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^limit:/);
  });
});
