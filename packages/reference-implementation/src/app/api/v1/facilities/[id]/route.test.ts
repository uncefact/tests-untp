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
    expect(json.facility).toEqual(facility);
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
    expect(json.facility).toEqual(updated);
    expect(json).not.toHaveProperty('ok');
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one updatable field is required');
  });

  it('returns 400 when name is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('fac-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name must be a non-empty string');
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

  it('deletes the facility and returns empty object', async () => {
    mockDeleteFacility.mockResolvedValue({ id: 'fac-1' });

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('fac-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({});
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
