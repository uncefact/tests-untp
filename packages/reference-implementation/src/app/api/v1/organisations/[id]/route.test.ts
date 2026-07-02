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

const mockGetOrganisationById = jest.fn();
const mockUpdateOrganisation = jest.fn();
const mockDeleteOrganisation = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getOrganisationById: (id: string, tenantId: string) => mockGetOrganisationById(id, tenantId),
  updateOrganisation: (id: string, tenantId: string, input: unknown) => mockUpdateOrganisation(id, tenantId, input),
  deleteOrganisation: (id: string, tenantId: string) => mockDeleteOrganisation(id, tenantId),
}));

import { NotFoundError } from '@/lib/api/errors';
import { GET, PATCH, DELETE } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/organisations/org-a' } = options;
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

describe('GET /api/v1/organisations/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the organisation record', async () => {
    const organisation = { id: 'org-a', name: 'Acme Corp' };
    mockGetOrganisationById.mockResolvedValue(organisation);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('org-a') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(organisation);
  });

  it('returns 404 when organisation not found', async () => {
    mockGetOrganisationById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Organisation not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetOrganisationById.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await GET(req, createContext('org-a') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('PATCH /api/v1/organisations/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates the organisation', async () => {
    const updated = { id: 'org-a', name: 'Updated Corp' };
    mockUpdateOrganisation.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Corp' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(updated);
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one of');
  });

  it('returns 400 when name is empty string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name');
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when primaryIdentifierId is not a string', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { primaryIdentifierId: 42 } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('primaryIdentifierId');
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when secondaryIdentifierIds is not an array', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { secondaryIdentifierIds: 'id-1' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('secondaryIdentifierIds');
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('accepts an empty secondaryIdentifierIds array to clear all secondary identifiers', async () => {
    const updated = { id: 'org-ent-1', name: 'Acme', secondaryIdentifierIds: [] };
    mockUpdateOrganisation.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { secondaryIdentifierIds: [] } });
    const res = await PATCH(req, createContext('org-ent-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateOrganisation).toHaveBeenCalledWith('org-ent-1', 'org-1', { secondaryIdentifierIds: [] });
  });

  it('returns 400 for a JSON null body', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: null });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('body');
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      method: 'PATCH',
      url: 'http://localhost/api/v1/organisations/org-a',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Request;
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 404 when organisation not found', async () => {
    mockUpdateOrganisation.mockRejectedValue(new NotFoundError('Organisation not found or access denied'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Corp' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Organisation not found');
  });

  it('allows clearing primaryIdentifierId with null', async () => {
    const updated = { id: 'org-a', name: 'Acme Corp', primaryIdentifierId: null };
    mockUpdateOrganisation.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { primaryIdentifierId: null } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateOrganisation).toHaveBeenCalledWith('org-a', 'org-1', { primaryIdentifierId: null });
  });

  it('returns 500 on unexpected error', async () => {
    mockUpdateOrganisation.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Corp' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('DELETE /api/v1/organisations/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the organisation and returns 204 with no body', async () => {
    mockDeleteOrganisation.mockResolvedValue({ id: 'org-a' });

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('org-a') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('returns 404 when organisation not found', async () => {
    mockDeleteOrganisation.mockRejectedValue(new NotFoundError('Organisation not found or access denied'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Organisation not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockDeleteOrganisation.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('org-a') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
