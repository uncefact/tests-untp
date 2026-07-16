// Mock next/server before importing route handlers
jest.mock('next/server', () => {
  class MockNextResponse {
    status: number;
    body: unknown;
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    async json() {
      return this.body;
    }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

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

const mockGetFacilityById = jest.fn();
const mockUpdateFacility = jest.fn();
const mockDeleteFacility = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getFacilityById: (id: string, tenantId: string) => mockGetFacilityById(id, tenantId),
  updateFacility: (id: string, tenantId: string, input: unknown) => mockUpdateFacility(id, tenantId, input),
  deleteFacility: (id: string, tenantId: string) => mockDeleteFacility(id, tenantId),
}));

import { NotFoundError, ConflictError } from '@/lib/api/errors';
import { GET, PATCH, DELETE } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/facilities/fac-1' } = options;
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
  return { tenantId: 'org-1', params: Promise.resolve({ id }) };
}

describe('GET /api/v1/facilities/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the facility record', async () => {
    const facility = { id: 'fac-1', name: 'Warehouse Alpha' };
    mockGetFacilityById.mockResolvedValue(facility);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('fac-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(facility);
    expect(json).not.toHaveProperty('ok');
  });

  it('returns 404 when facility not found', async () => {
    mockGetFacilityById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Facility not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetFacilityById.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await GET(req, createContext('fac-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('PATCH /api/v1/facilities/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates facility fields', async () => {
    const updated = { id: 'fac-1', name: 'Updated Warehouse' };
    mockUpdateFacility.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Warehouse' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(updated);
    expect(json).not.toHaveProperty('ok');
    expect(mockUpdateFacility).toHaveBeenCalledWith('fac-1', 'org-1', { name: 'Updated Warehouse' });
  });

  it('clears operatingOrganisationId and primaryIdentifierId with an explicit null', async () => {
    mockUpdateFacility.mockResolvedValue({ id: 'fac-1' });

    const req = createFakeRequest({
      method: 'PATCH',
      body: { operatingOrganisationId: null, primaryIdentifierId: null },
    });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateFacility).toHaveBeenCalledWith('fac-1', 'org-1', {
      operatingOrganisationId: null,
      primaryIdentifierId: null,
    });
  });

  it('clears description with an explicit null', async () => {
    mockUpdateFacility.mockResolvedValue({ id: 'fac-1' });

    const req = createFakeRequest({ method: 'PATCH', body: { description: null } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateFacility).toHaveBeenCalledWith('fac-1', 'org-1', { description: null });
  });

  it('clears secondaryIdentifierIds with an empty array', async () => {
    mockUpdateFacility.mockResolvedValue({ id: 'fac-1' });

    const req = createFakeRequest({ method: 'PATCH', body: { secondaryIdentifierIds: [] } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateFacility).toHaveBeenCalledWith('fac-1', 'org-1', { secondaryIdentifierIds: [] });
  });

  it('replaces secondaryIdentifierIds with a new set', async () => {
    mockUpdateFacility.mockResolvedValue({ id: 'fac-1' });

    const req = createFakeRequest({
      method: 'PATCH',
      body: { secondaryIdentifierIds: ['ident-1', 'ident-2'] },
    });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateFacility).toHaveBeenCalledWith('fac-1', 'org-1', {
      secondaryIdentifierIds: ['ident-1', 'ident-2'],
    });
  });

  it('accepts an open location object and forwards it to the repository', async () => {
    mockUpdateFacility.mockResolvedValue({ id: 'fac-1' });

    const location = { address: { addressCountry: 'AU' } };
    const req = createFakeRequest({ method: 'PATCH', body: { location } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateFacility).toHaveBeenCalledWith('fac-1', 'org-1', { location });
  });

  it('returns 400 when no updatable fields are provided and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    // Exact match, including the `body: ` scope prefix parseRequestBody renders for a
    // top-level (unpathed) issue, pinning the rendered message rather than a substring.
    expect(json.error).toBe(
      'body: At least one updatable field is required: name, description, location, operatingOrganisationId, primaryIdentifierId, secondaryIdentifierIds',
    );
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when the body only has an unrecognised (typo) field name', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { neme: 'Updated Warehouse' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one updatable field is required');
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when name is an empty string and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^name:/);
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when description is an empty string and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { description: '' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^description:/);
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when operatingOrganisationId is not a string or null and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { operatingOrganisationId: 123 } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^operatingOrganisationId:/);
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when primaryIdentifierId is an empty string and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { primaryIdentifierId: '' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^primaryIdentifierId:/);
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when secondaryIdentifierIds is not an array and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { secondaryIdentifierIds: 'ident-1' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^secondaryIdentifierIds:/);
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when secondaryIdentifierIds contains a duplicate and does not call the repository', async () => {
    const req = createFakeRequest({
      method: 'PATCH',
      body: { secondaryIdentifierIds: ['ident-1', 'ident-1'] },
    });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^secondaryIdentifierIds:/);
    expect(json.error).toContain('must not contain duplicate identifiers');
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when location is not an object and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { location: 'somewhere' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^location:/);
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when location is explicitly null and does not call the repository', async () => {
    // Unlike description, location is a Json column: Prisma requires Prisma.JsonNull
    // rather than a plain null, so there is no null-to-clear mechanism for it yet.
    const req = createFakeRequest({ method: 'PATCH', body: { location: null } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^location:/);
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body and does not call the repository', async () => {
    const req = {
      method: 'PATCH',
      url: 'http://localhost/api/v1/facilities/fac-1',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Request;
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 for a literal null body and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: null });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Expected object, received null');
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 404 when facility not found', async () => {
    mockUpdateFacility.mockRejectedValue(new NotFoundError('Facility not found'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Facility not found');
  });

  it('returns 409 when repository reports a primary identifier conflict', async () => {
    mockUpdateFacility.mockRejectedValue(
      new ConflictError('The identifier is already the primary identifier of another facility'),
    );

    const req = createFakeRequest({ method: 'PATCH', body: { primaryIdentifierId: 'ident-1' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('already the primary identifier of another facility');
  });

  it('returns 500 on unexpected error', async () => {
    mockUpdateFacility.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('DELETE /api/v1/facilities/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the facility and returns 204 with no body', async () => {
    mockDeleteFacility.mockResolvedValue({ id: 'fac-1' });

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('fac-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('returns 404 when facility not found', async () => {
    mockDeleteFacility.mockRejectedValue(new NotFoundError('Facility not found'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Facility not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockDeleteFacility.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('fac-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
