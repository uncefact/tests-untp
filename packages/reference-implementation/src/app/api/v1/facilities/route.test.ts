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

import { NotFoundError, ConflictError } from '@/lib/api/errors';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
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

  it('passes identifier and organisation fields to createFacilities', async () => {
    mockCreateFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    const input = [
      {
        name: 'Warehouse Alpha',
        operatingOrganisationId: 'org-42',
        primaryIdentifierId: 'ident-1',
        secondaryIdentifierIds: ['ident-2', 'ident-3'],
      },
    ];
    const req = createFakeRequest({ body: input });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockCreateFacilities).toHaveBeenCalledWith('org-1', input);
  });

  it('returns 400 when body is not an array and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 'Not an array' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Request body must be an array');
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 when body is an empty array and does not call the repository', async () => {
    const req = createFakeRequest({ body: [] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Request body must not be empty');
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 when name is missing from an item and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ description: 'No name here' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.name:/);
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 when name is an empty string and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: '' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.name:/);
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 when description is an empty string and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: 'Warehouse Alpha', description: '' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.description:/);
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 when operatingOrganisationId is an empty string and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: 'Warehouse Alpha', operatingOrganisationId: '' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.operatingOrganisationId:/);
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 when primaryIdentifierId is not a string and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: 'Warehouse Alpha', primaryIdentifierId: 123 }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.primaryIdentifierId:/);
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 when secondaryIdentifierIds is not an array and does not call the repository', async () => {
    const req = createFakeRequest({
      body: [{ name: 'Warehouse Alpha', secondaryIdentifierIds: 'ident-1' }],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.secondaryIdentifierIds:/);
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 when a secondaryIdentifierIds entry is an empty string and does not call the repository', async () => {
    const req = createFakeRequest({
      body: [{ name: 'Warehouse Alpha', secondaryIdentifierIds: [''] }],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.secondaryIdentifierIds\.0:/);
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 when secondaryIdentifierIds contains a duplicate and does not call the repository', async () => {
    // Boundary self-consistency (shape-level): without this, the duplicate would
    // reach facilitySecondaryIdentifier.createMany, hit the composite primary key,
    // and surface as a misleading 409 "concurrently linked" conflict for a typo.
    const req = createFakeRequest({
      body: [{ name: 'Warehouse Alpha', secondaryIdentifierIds: ['ident-1', 'ident-1'] }],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.secondaryIdentifierIds:/);
    expect(json.error).toContain('must not contain duplicate identifiers');
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 when location is not an object and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: 'Warehouse Alpha', location: 'somewhere' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.location:/);
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 when location is explicitly null and does not call the repository', async () => {
    // location is a Json column: Prisma requires Prisma.JsonNull rather than a plain
    // null, so a literal null is rejected the same as any other malformed value.
    const req = createFakeRequest({ body: [{ name: 'Warehouse Alpha', location: null }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.location:/);
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it.each([
    ['description', { description: null }, /^0\.description:/],
    ['operatingOrganisationId', { operatingOrganisationId: null }, /^0\.operatingOrganisationId:/],
    ['primaryIdentifierId', { primaryIdentifierId: null }, /^0\.primaryIdentifierId:/],
    ['secondaryIdentifierIds', { secondaryIdentifierIds: null }, /^0\.secondaryIdentifierIds:/],
  ] as const)(
    'returns 400 when %s is explicitly null and does not call the repository',
    async (_field, overrides, pattern) => {
      // None of these fields has clear-on-create semantics (nothing yet exists to
      // clear): an explicit null is rejected the same as any other malformed value,
      // never treated as equivalent to omitting the field.
      const req = createFakeRequest({ body: [{ name: 'Warehouse Alpha', ...overrides }] });
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(pattern);
      expect(mockCreateFacilities).not.toHaveBeenCalled();
    },
  );

  it('accepts an open location object and forwards it to the repository', async () => {
    mockCreateFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    const location = { address: { addressCountry: 'AU' } };
    const req = createFakeRequest({ body: [{ name: 'Warehouse Alpha', location }] });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockCreateFacilities).toHaveBeenCalledWith('org-1', [{ name: 'Warehouse Alpha', location }]);
  });

  it('returns 400 for invalid JSON body and does not call the repository', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 for a literal null body and does not call the repository', async () => {
    const req = createFakeRequest({ body: null });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Expected object, received null');
    expect(mockCreateFacilities).not.toHaveBeenCalled();
  });

  it('returns 404 when repository throws NotFoundError', async () => {
    mockCreateFacilities.mockRejectedValue(new NotFoundError('Organisation not found: org-999'));

    const req = createFakeRequest({ body: [{ name: 'Facility', operatingOrganisationId: 'org-999' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Organisation not found');
  });

  it('returns 409 when repository reports a primary identifier conflict', async () => {
    mockCreateFacilities.mockRejectedValue(
      new ConflictError('An identifier in this request is already the primary identifier of another facility'),
    );

    const req = createFakeRequest({ body: [{ name: 'Facility', primaryIdentifierId: 'ident-1' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('already the primary identifier of another facility');
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
    expect(json.pagination).toEqual({ total: 1, limit: DEFAULT_PAGE_LIMIT, offset: 0, hasMore: false });
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

  it('accepts an empty search filter unchanged', async () => {
    mockListFacilities.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/facilities?search=',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(200);
    expect(mockListFacilities).toHaveBeenCalledWith('org-1', {
      search: '',
      organisationId: undefined,
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

  it('returns 400 for non-numeric limit and does not call the repository', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/facilities?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit: must be a positive integer');
    expect(mockListFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 for negative offset and does not call the repository', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/facilities?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset: must be a non-negative integer');
    expect(mockListFacilities).not.toHaveBeenCalled();
  });

  it('rejects a limit above the maximum with a 400 and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: `http://localhost/api/v1/facilities?limit=${MAX_PAGE_LIMIT + 1}`,
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^limit:/);
    expect(mockListFacilities).not.toHaveBeenCalled();
  });

  it('returns 400 for a repeated query key and does not call the repository', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/facilities?limit=10&limit=20',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('repeated query parameter');
    expect(mockListFacilities).not.toHaveBeenCalled();
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
