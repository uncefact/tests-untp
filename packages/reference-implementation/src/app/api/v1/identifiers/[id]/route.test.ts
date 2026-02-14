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

const mockGetIdentifierById = jest.fn();
const mockUpdateIdentifier = jest.fn();
const mockDeleteIdentifier = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getIdentifierById: (id: string, tenantId: string) => mockGetIdentifierById(id, tenantId),
  updateIdentifier: (id: string, tenantId: string, input: unknown) => mockUpdateIdentifier(id, tenantId, input),
  deleteIdentifier: (id: string, tenantId: string) => mockDeleteIdentifier(id, tenantId),
}));

import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { GET, PATCH, DELETE } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/identifiers/id-1' } = options;
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

describe('GET /api/v1/identifiers/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the identifier record', async () => {
    const identifier = { id: 'id-1', value: '09520123456788', schemeId: 'sch-1' };
    mockGetIdentifierById.mockResolvedValue(identifier);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('id-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.identifier).toEqual(identifier);
  });

  it('returns 404 when identifier not found', async () => {
    mockGetIdentifierById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Identifier not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetIdentifierById.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await GET(req, createContext('id-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('PATCH /api/v1/identifiers/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates identifier value', async () => {
    const updated = { id: 'id-1', value: '09520123456799' };
    mockUpdateIdentifier.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { value: '09520123456799' } });
    const res = await PATCH(req, createContext('id-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.identifier.value).toBe('09520123456799');
  });

  it('returns 400 when no value provided', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('id-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('value is required');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      method: 'PATCH',
      url: 'http://localhost/api/v1/identifiers/id-1',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Request;
    const res = await PATCH(req, createContext('id-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 when value fails scheme validation', async () => {
    mockUpdateIdentifier.mockRejectedValue(
      new ValidationError('Identifier value "abc" does not match scheme validation pattern: ^\\d{14}$'),
    );

    const req = createFakeRequest({ method: 'PATCH', body: { value: 'abc' } });
    const res = await PATCH(req, createContext('id-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('does not match scheme validation pattern');
  });

  it('returns 404 when identifier not found or access denied', async () => {
    mockUpdateIdentifier.mockRejectedValue(new NotFoundError('Identifier not found or access denied'));

    const req = createFakeRequest({ method: 'PATCH', body: { value: '09520123456799' } });
    const res = await PATCH(req, createContext('id-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Identifier not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockUpdateIdentifier.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'PATCH', body: { value: '09520123456799' } });
    const res = await PATCH(req, createContext('id-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('DELETE /api/v1/identifiers/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the identifier', async () => {
    mockDeleteIdentifier.mockResolvedValue({ id: 'id-1' });

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('id-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('returns 404 when identifier not found or access denied', async () => {
    mockDeleteIdentifier.mockRejectedValue(new NotFoundError('Identifier not found or access denied'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Identifier not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockDeleteIdentifier.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('id-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
