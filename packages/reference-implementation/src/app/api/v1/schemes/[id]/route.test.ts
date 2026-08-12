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

const mockGetIdentifierSchemeById = jest.fn();
const mockUpdateIdentifierScheme = jest.fn();
const mockDeleteIdentifierScheme = jest.fn();
const mockGetInstanceByResolution = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getIdentifierSchemeById: (id: string, tenantId: string) => mockGetIdentifierSchemeById(id, tenantId),
  updateIdentifierScheme: (id: string, tenantId: string, input: unknown) =>
    mockUpdateIdentifierScheme(id, tenantId, input),
  deleteIdentifierScheme: (id: string, tenantId: string) => mockDeleteIdentifierScheme(id, tenantId),
  getInstanceByResolution: (...args: unknown[]) => mockGetInstanceByResolution(...args),
}));

import { NotFoundError, ConflictError } from '@/lib/api/errors';
import { GET, PATCH, DELETE } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/schemes/sch-1' } = options;
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

describe('GET /api/v1/schemes/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the scheme record', async () => {
    const scheme = { id: 'sch-1', name: 'GTIN', primaryKey: 'gtin' };
    mockGetIdentifierSchemeById.mockResolvedValue(scheme);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('sch-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(scheme);
  });

  it('returns 404 when scheme not found', async () => {
    mockGetIdentifierSchemeById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Identifier scheme not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetIdentifierSchemeById.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await GET(req, createContext('sch-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('PATCH /api/v1/schemes/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetInstanceByResolution.mockResolvedValue({ id: 'inst-1', tenantId: 'org-1' });
  });

  it('updates scheme fields', async () => {
    const updated = { id: 'sch-1', name: 'Updated GTIN' };
    mockUpdateIdentifierScheme.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated GTIN' } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.name).toBe('Updated GTIN');
  });

  it('updates with qualifier replacement', async () => {
    const updated = {
      id: 'sch-1',
      qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$' }],
    };
    mockUpdateIdentifierScheme.mockResolvedValue(updated);

    const req = createFakeRequest({
      method: 'PATCH',
      body: { qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$' }] },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.qualifiers).toHaveLength(1);
    expect(mockUpdateIdentifierScheme).toHaveBeenCalledWith(
      'sch-1',
      'org-1',
      expect.objectContaining({
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$' }],
      }),
    );
  });

  it('updates with a qualifier order and forwards it to the repository', async () => {
    const updated = {
      id: 'sch-1',
      qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: 2 }],
    };
    mockUpdateIdentifierScheme.mockResolvedValue(updated);

    const req = createFakeRequest({
      method: 'PATCH',
      body: {
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: 2 }],
      },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateIdentifierScheme).toHaveBeenCalledWith(
      'sch-1',
      'org-1',
      expect.objectContaining({
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: 2 }],
      }),
    );
  });

  it.each([
    ['zero', 0],
    ['the int32 maximum', 2147483647],
  ])('accepts a qualifier order of %s and forwards it to the repository', async (_label, order) => {
    const updated = {
      id: 'sch-1',
      qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order }],
    };
    mockUpdateIdentifierScheme.mockResolvedValue(updated);

    const req = createFakeRequest({
      method: 'PATCH',
      body: {
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order }],
      },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateIdentifierScheme).toHaveBeenCalledWith(
      'sch-1',
      'org-1',
      expect.objectContaining({
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order }],
      }),
    );
  });

  it('returns 400 for a negative qualifier order and does not call the repository', async () => {
    const req = createFakeRequest({
      method: 'PATCH',
      body: {
        qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: -5 }],
      },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^qualifiers\.0\.order:/);
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-integer qualifier order and does not call the repository', async () => {
    const req = createFakeRequest({
      method: 'PATCH',
      body: {
        qualifiers: [
          { key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: 'first' },
        ],
      },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^qualifiers\.0\.order:/);
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 for an out-of-range qualifier order and does not call the repository', async () => {
    const req = createFakeRequest({
      method: 'PATCH',
      body: {
        qualifiers: [
          { key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$', order: 3000000000 },
        ],
      },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^qualifiers\.0\.order:/);
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 when no fields provided', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one field is required');
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 for a whitespace-only primaryKey and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { primaryKey: '  ' } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('primaryKey: must not be only whitespace');
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 when the body only has an unrecognised (typo) field name', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { neme: 'Updated GTIN' } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one field is required');
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      method: 'PATCH',
      url: 'http://localhost/api/v1/schemes/sch-1',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Request;
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 for invalid qualifier (missing key)', async () => {
    const req = createFakeRequest({
      method: 'PATCH',
      body: { qualifiers: [{ description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$' }] },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^qualifiers\.0\.key:/);
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid qualifier (missing validationPattern)', async () => {
    const req = createFakeRequest({
      method: 'PATCH',
      body: { qualifiers: [{ key: 'lot', description: 'Lot number' }] },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^qualifiers\.0\.validationPattern:/);
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 for non-array qualifiers', async () => {
    const req = createFakeRequest({
      method: 'PATCH',
      body: { qualifiers: 'not-an-array' },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^qualifiers:/);
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 for a validationPattern that does not compile as a regular expression', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { validationPattern: '[invalid' } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('validationPattern: must be a valid regular expression');
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 400 for a qualifier validationPattern that does not compile as a regular expression', async () => {
    const req = createFakeRequest({
      method: 'PATCH',
      body: { qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '[invalid' }] },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('qualifiers.0.validationPattern: must be a valid regular expression');
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 404 when scheme not found', async () => {
    mockUpdateIdentifierScheme.mockRejectedValue(new NotFoundError('Identifier scheme not found'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Identifier scheme not found');
  });

  it('allows clearing idrServiceInstanceId with null, without an instance lookup', async () => {
    const updated = { id: 'sch-1', idrServiceInstanceId: null };
    mockUpdateIdentifierScheme.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { idrServiceInstanceId: null } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    // A null clears the linkage rather than referencing an instance, so there
    // is nothing to verify.
    expect(mockGetInstanceByResolution).not.toHaveBeenCalled();
    expect(mockUpdateIdentifierScheme).toHaveBeenCalledWith('sch-1', 'org-1', { idrServiceInstanceId: null });
  });

  it('verifies the instance is accessible to the tenant before updating idrServiceInstanceId', async () => {
    const updated = { id: 'sch-1', idrServiceInstanceId: 'inst-1' };
    mockUpdateIdentifierScheme.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { idrServiceInstanceId: 'inst-1' } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'IDR', 'inst-1');
    expect(mockUpdateIdentifierScheme).toHaveBeenCalledWith('sch-1', 'org-1', { idrServiceInstanceId: 'inst-1' });
  });

  it('returns 404 when idrServiceInstanceId is not accessible to the tenant, and does not call the repository', async () => {
    mockGetInstanceByResolution.mockResolvedValue(null);

    const req = createFakeRequest({ method: 'PATCH', body: { idrServiceInstanceId: 'other-tenant-inst' } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Service instance not found');
    expect(mockUpdateIdentifierScheme).not.toHaveBeenCalled();
  });

  it('returns 409 when repository reports a qualifier key conflict', async () => {
    mockUpdateIdentifierScheme.mockRejectedValue(
      new ConflictError('A qualifier with this key already exists for the scheme'),
    );

    const req = createFakeRequest({
      method: 'PATCH',
      body: { qualifiers: [{ key: 'lot', description: 'Lot number', validationPattern: '^[A-Za-z0-9]{1,20}$' }] },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('A qualifier with this key already exists for the scheme');
  });
});

describe('DELETE /api/v1/schemes/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the scheme', async () => {
    mockDeleteIdentifierScheme.mockResolvedValue({ id: 'sch-1' });

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('sch-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
  });

  it('returns 404 when scheme not found', async () => {
    mockDeleteIdentifierScheme.mockRejectedValue(new NotFoundError('Identifier scheme not found'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Identifier scheme not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockDeleteIdentifierScheme.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('sch-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
