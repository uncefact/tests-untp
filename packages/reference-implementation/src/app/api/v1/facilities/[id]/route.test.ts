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

import { NotFoundError } from '@/lib/api/errors';
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
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one of');
  });

  it('returns 400 when name is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name');
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when secondaryIdentifierIds is not an array', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { secondaryIdentifierIds: 'id-1' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('secondaryIdentifierIds');
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when operatingOrganisationId is not a string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { operatingOrganisationId: 42 } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('operatingOrganisationId');
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 when primaryIdentifierId is not a string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { primaryIdentifierId: 42 } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('primaryIdentifierId');
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('allows clearing primaryIdentifierId with null', async () => {
    const updated = { id: 'fac-1', name: 'Warehouse Alpha', primaryIdentifierId: null };
    mockUpdateFacility.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { primaryIdentifierId: null } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateFacility).toHaveBeenCalledWith('fac-1', 'org-1', { primaryIdentifierId: null });
  });

  it('returns 400 for a JSON null body', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: null });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('body');
    expect(mockUpdateFacility).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body', async () => {
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
  });

  it('returns 404 when facility not found', async () => {
    mockUpdateFacility.mockRejectedValue(new NotFoundError('Facility not found or access denied'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Facility not found');
  });

  it('allows clearing operatingOrganisationId with null', async () => {
    const updated = { id: 'fac-1', name: 'Warehouse Alpha', operatingOrganisationId: null };
    mockUpdateFacility.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { operatingOrganisationId: null } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateFacility).toHaveBeenCalledWith('fac-1', 'org-1', { operatingOrganisationId: null });
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
    mockDeleteFacility.mockRejectedValue(new NotFoundError('Facility not found or access denied'));

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
