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

import { NotFoundError, ConflictError } from '@/lib/api/errors';
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
    expect(mockUpdateOrganisation).toHaveBeenCalledWith('org-a', 'org-1', { name: 'Updated Corp' });
  });

  it('strips an unrecognised key rather than rejecting the request or forwarding it', async () => {
    // Distinct from the all-unrecognised-keys 400 case: this body has one
    // recognised field (satisfying requireAtLeastOneField) alongside a
    // typo'd key, so it must succeed with the typo silently stripped, not
    // rejected and not passed through to the repository.
    mockUpdateOrganisation.mockResolvedValue({ id: 'org-a' });

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Corp', typo: 'x' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateOrganisation).toHaveBeenCalledWith('org-a', 'org-1', { name: 'Updated Corp' });
  });

  it('updates every recognised field and forwards them all to the repository', async () => {
    mockUpdateOrganisation.mockResolvedValue({ id: 'org-a' });

    const req = createFakeRequest({
      method: 'PATCH',
      body: {
        name: 'Updated Corp',
        description: 'New description',
        location: { address: { streetAddress: '456 Other St' } },
        primaryIdentifierId: 'ident-2',
        secondaryIdentifierIds: ['ident-3'],
      },
    });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateOrganisation).toHaveBeenCalledWith('org-a', 'org-1', {
      name: 'Updated Corp',
      description: 'New description',
      location: { address: { streetAddress: '456 Other St' } },
      primaryIdentifierId: 'ident-2',
      secondaryIdentifierIds: ['ident-3'],
    });
  });

  it('forwards an explicit null primaryIdentifierId to clear it', async () => {
    mockUpdateOrganisation.mockResolvedValue({ id: 'org-a' });

    const req = createFakeRequest({ method: 'PATCH', body: { primaryIdentifierId: null } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateOrganisation).toHaveBeenCalledWith('org-a', 'org-1', { primaryIdentifierId: null });
  });

  it('forwards an explicit null description to clear it', async () => {
    // description is a nullable scalar column (String?), unlike the Json
    // location column: Prisma accepts a plain null here, and the
    // pre-migration path already forwarded it as a working clear.
    mockUpdateOrganisation.mockResolvedValue({ id: 'org-a' });

    const req = createFakeRequest({ method: 'PATCH', body: { description: null } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateOrganisation).toHaveBeenCalledWith('org-a', 'org-1', { description: null });
  });

  it('forwards an empty secondaryIdentifierIds array to clear all secondary identifiers', async () => {
    mockUpdateOrganisation.mockResolvedValue({ id: 'org-a' });

    const req = createFakeRequest({ method: 'PATCH', body: { secondaryIdentifierIds: [] } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateOrganisation).toHaveBeenCalledWith('org-a', 'org-1', { secondaryIdentifierIds: [] });
  });

  it('returns 400 for an explicit null location and does not call the repository', async () => {
    // A schema regression re-admitting null here would forward a value the
    // Prisma client's input types exclude (Json null writes require the
    // DbNull/JsonNull sentinels), and location's clear mechanism is
    // deliberately deferred to #804. Unlike primaryIdentifierId, location has
    // no null-to-clear contract.
    const req = createFakeRequest({ method: 'PATCH', body: { location: null } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^location:/);
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when no updatable fields are provided and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one updatable field must be provided');
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when the body contains only unrecognised keys and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { neme: 'Typo Corp' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one updatable field must be provided');
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when name is an empty string and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^name:/);
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when name is only whitespace and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '   ' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('name: must not be only whitespace');
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when description is only whitespace and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { description: '  ' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('description: must not be only whitespace');
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when description is mistyped and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { description: 42 } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^description:/);
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when location is not an object and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { location: 'not-an-object' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^location:/);
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when primaryIdentifierId is mistyped and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { primaryIdentifierId: 42 } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^primaryIdentifierId:/);
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when secondaryIdentifierIds is not an array and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { secondaryIdentifierIds: 'ident-1' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^secondaryIdentifierIds:/);
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 when secondaryIdentifierIds contains a duplicate in-request identifier and does not call the repository', async () => {
    // Same boundary self-consistency check as the create route: an
    // in-request duplicate would otherwise reach
    // organisationSecondaryIdentifier.createMany (no skipDuplicates) and
    // surface as the misleading concurrent-link 409 for a client typo.
    const req = createFakeRequest({
      method: 'PATCH',
      body: { secondaryIdentifierIds: ['ident-1', 'ident-1'] },
    });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('secondaryIdentifierIds: must not contain duplicate identifiers');
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 for a literal null body and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: null });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('body: Expected object, received null');
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body and does not call the repository', async () => {
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
    expect(mockUpdateOrganisation).not.toHaveBeenCalled();
  });

  it('returns 404 when organisation not found', async () => {
    mockUpdateOrganisation.mockRejectedValue(new NotFoundError('Organisation not found'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Corp' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Organisation not found');
  });

  it('returns 409 when repository reports a primary identifier conflict', async () => {
    mockUpdateOrganisation.mockRejectedValue(
      new ConflictError('The identifier is already the primary identifier of another organisation'),
    );

    const req = createFakeRequest({ method: 'PATCH', body: { primaryIdentifierId: 'ident-1' } });
    const res = await PATCH(req, createContext('org-a') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('The identifier is already the primary identifier of another organisation');
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
    mockDeleteOrganisation.mockRejectedValue(new NotFoundError('Organisation not found'));

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
