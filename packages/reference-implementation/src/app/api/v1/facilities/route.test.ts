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

const mockCreateFacilities = jest.fn();
const mockListFacilities = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  createFacilities: (tenantId: string, inputs: unknown) => mockCreateFacilities(tenantId, inputs),
  listFacilities: (tenantId: string, opts: unknown) => mockListFacilities(tenantId, opts),
}));

import { NotFoundError } from '@/lib/api/errors';
import { POST, GET } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'POST', body, url = 'http://localhost/api/v1/facilities' } = options;
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
    url: 'http://localhost/api/v1/facilities',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('POST /api/v1/facilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates facilities and returns 201', async () => {
    const facilities = [
      { id: 'fac-1', name: 'Warehouse Alpha' },
      { id: 'fac-2', name: 'Warehouse Beta' },
    ];
    mockCreateFacilities.mockResolvedValue(facilities);

    const req = createFakeRequest({
      body: [{ name: 'Warehouse Alpha' }, { name: 'Warehouse Beta' }],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual(facilities);
    expect(json).not.toHaveProperty('ok');
  });

  it('passes correct inputs to createFacilities', async () => {
    mockCreateFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    const input = [{ name: 'Warehouse Alpha', description: 'Main warehouse' }];
    const req = createFakeRequest({ body: input });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockCreateFacilities).toHaveBeenCalledWith('org-1', input);
  });

  it('returns 400 when body is not an array', async () => {
    const req = createFakeRequest({ body: { name: 'Not an array' } });
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

  it('returns 400 when name is missing from an item', async () => {
    const req = createFakeRequest({ body: [{ description: 'No name here' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name is required');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 404 when repository throws NotFoundError', async () => {
    mockCreateFacilities.mockRejectedValue(new NotFoundError('Organisation not found: org-999'));

    const req = createFakeRequest({ body: [{ name: 'Facility', operatingOrganisationId: 'org-999' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Organisation not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockCreateFacilities.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ body: [{ name: 'Facility' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('GET /api/v1/facilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists facilities for the tenant with pagination', async () => {
    const facilities = [{ id: 'fac-1', name: 'Warehouse Alpha' }];
    mockListFacilities.mockResolvedValue({ data: facilities, total: 1 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/facilities' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(facilities);
    expect(json.pagination).toEqual({ total: 1, limit: 20, offset: 0, hasMore: false });
    expect(json).not.toHaveProperty('ok');
  });

  it('passes search and organisationId filters', async () => {
    mockListFacilities.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/facilities?search=alpha&organisationId=org-42',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListFacilities).toHaveBeenCalledWith('org-1', {
      search: 'alpha',
      organisationId: 'org-42',
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes pagination parameters', async () => {
    mockListFacilities.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/facilities?limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListFacilities).toHaveBeenCalledWith('org-1', {
      search: undefined,
      organisationId: undefined,
      limit: 10,
      offset: 5,
    });
  });

  it('handles no query parameters', async () => {
    mockListFacilities.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/facilities' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListFacilities).toHaveBeenCalledWith('org-1', {
      search: undefined,
      organisationId: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('returns 400 for non-numeric limit', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/facilities?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/facilities?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset must be a non-negative integer');
  });

  it('returns 500 when listFacilities throws', async () => {
    mockListFacilities.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/facilities' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
