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

const mockCreateOrganisations = jest.fn();
const mockListOrganisations = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  createOrganisations: (tenantId: string, inputs: unknown) => mockCreateOrganisations(tenantId, inputs),
  listOrganisations: (tenantId: string, opts: unknown) => mockListOrganisations(tenantId, opts),
}));

import { NotFoundError } from '@/lib/api/errors';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import { POST, GET } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'POST', body, url = 'http://localhost/api/v1/organisations' } = options;
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
    url: 'http://localhost/api/v1/organisations',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('POST /api/v1/organisations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates organisations and returns 201', async () => {
    const organisations = [
      { id: 'org-a', name: 'Acme Corp' },
      { id: 'org-b', name: 'Widget Co' },
    ];
    mockCreateOrganisations.mockResolvedValue(organisations);

    const req = createFakeRequest({
      body: [{ name: 'Acme Corp' }, { name: 'Widget Co' }],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual(organisations);
  });

  it('returns 400 when body is not an array', async () => {
    const req = createFakeRequest({ body: { name: 'Acme Corp' } });
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

  it('returns 400 when name is missing on an item', async () => {
    const req = createFakeRequest({ body: [{ description: 'No name here' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name');
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when an array item is null', async () => {
    const req = createFakeRequest({ body: [{ name: 'Acme Corp' }, null] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when primaryIdentifierId is not a string', async () => {
    const req = createFakeRequest({ body: [{ name: 'Acme Corp', primaryIdentifierId: 42 }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('primaryIdentifierId');
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when secondaryIdentifierIds is not an array', async () => {
    const req = createFakeRequest({ body: [{ name: 'Acme Corp', secondaryIdentifierIds: 'id-1' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('secondaryIdentifierIds');
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 404 when repository throws NotFoundError', async () => {
    mockCreateOrganisations.mockRejectedValue(new NotFoundError('Tenant not found'));

    const req = createFakeRequest({ body: [{ name: 'Acme Corp' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Tenant not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockCreateOrganisations.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ body: [{ name: 'Acme Corp' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('GET /api/v1/organisations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists organisations for the tenant with pagination', async () => {
    const organisations = [{ id: 'org-a', name: 'Acme Corp', secondaryIdentifierIds: [] }];
    mockListOrganisations.mockResolvedValue({ data: organisations, total: 1 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/organisations' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(organisations);
    expect(json.pagination).toEqual({
      total: 1,
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
      hasMore: false,
    });
  });

  it('passes search and pagination params to listOrganisations', async () => {
    mockListOrganisations.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/organisations?search=acme&limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListOrganisations).toHaveBeenCalledWith('org-1', {
      search: 'acme',
      limit: 10,
      offset: 5,
    });
  });

  it('handles no query parameters', async () => {
    mockListOrganisations.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/organisations' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListOrganisations).toHaveBeenCalledWith('org-1', {
      search: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('returns 400 for non-numeric limit', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/organisations?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/organisations?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset must be a non-negative integer');
  });

  it('returns 500 when listOrganisations throws', async () => {
    mockListOrganisations.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/organisations' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });

  it('returns correct pagination when limit and offset are provided', async () => {
    const organisations = [{ id: 'org-a', name: 'Acme Corp', secondaryIdentifierIds: [] }];
    mockListOrganisations.mockResolvedValue({ data: organisations, total: 25 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/organisations?limit=10&offset=5',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(organisations);
    expect(json.pagination).toEqual({
      total: 25,
      limit: 10,
      offset: 5,
      hasMore: true,
    });
  });
});
