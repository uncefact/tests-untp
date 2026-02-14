// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withTenantAuth as passthrough
jest.mock('@/lib/api/with-tenant-auth', () => ({
  withTenantAuth: (handler: (...args: unknown[]) => unknown) => handler,
}));

const mockGetIdentifierSchemeById = jest.fn();
const mockUpdateIdentifierScheme = jest.fn();
const mockDeleteIdentifierScheme = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getIdentifierSchemeById: (id: string, tenantId: string) => mockGetIdentifierSchemeById(id, tenantId),
  updateIdentifierScheme: (id: string, tenantId: string, input: unknown) =>
    mockUpdateIdentifierScheme(id, tenantId, input),
  deleteIdentifierScheme: (id: string, tenantId: string) => mockDeleteIdentifierScheme(id, tenantId),
}));

import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
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
    expect(json.ok).toBe(true);
    expect(json.scheme).toEqual(scheme);
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
  });

  it('updates scheme fields', async () => {
    const updated = { id: 'sch-1', name: 'Updated GTIN' };
    mockUpdateIdentifierScheme.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated GTIN' } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.scheme.name).toBe('Updated GTIN');
  });

  it('updates with qualifier replacement', async () => {
    const updated = {
      id: 'sch-1',
      qualifiers: [{ key: 'lot', description: 'Lot number' }],
    };
    mockUpdateIdentifierScheme.mockResolvedValue(updated);

    const req = createFakeRequest({
      method: 'PATCH',
      body: { qualifiers: [{ key: 'lot', description: 'Lot number' }] },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.scheme.qualifiers).toHaveLength(1);
    expect(mockUpdateIdentifierScheme).toHaveBeenCalledWith(
      'sch-1',
      'org-1',
      expect.objectContaining({
        qualifiers: [{ key: 'lot', description: 'Lot number' }],
      }),
    );
  });

  it('returns 400 when no fields provided', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one field is required');
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
      body: { qualifiers: [{ description: 'Lot number' }] },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('qualifier key is required');
  });

  it('returns 400 for non-array qualifiers', async () => {
    const req = createFakeRequest({
      method: 'PATCH',
      body: { qualifiers: 'not-an-array' },
    });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('qualifiers must be an array');
  });

  it('returns 404 when scheme not found or access denied', async () => {
    mockUpdateIdentifierScheme.mockRejectedValue(new NotFoundError('Identifier scheme not found or access denied'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Identifier scheme not found');
  });

  it('allows clearing idrServiceInstanceId with null', async () => {
    const updated = { id: 'sch-1', idrServiceInstanceId: null };
    mockUpdateIdentifierScheme.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { idrServiceInstanceId: null } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateIdentifierScheme).toHaveBeenCalledWith('sch-1', 'org-1', { idrServiceInstanceId: null });
  });

  it('returns 400 when repository throws ValidationError', async () => {
    mockUpdateIdentifierScheme.mockRejectedValue(new ValidationError('Invalid pattern'));

    const req = createFakeRequest({ method: 'PATCH', body: { validationPattern: '[invalid' } });
    const res = await PATCH(req, createContext('sch-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Invalid pattern');
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
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('returns 404 when scheme not found or access denied', async () => {
    mockDeleteIdentifierScheme.mockRejectedValue(new NotFoundError('Identifier scheme not found or access denied'));

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
