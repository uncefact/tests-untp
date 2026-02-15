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

const mockGetRegistrarById = jest.fn();
const mockUpdateRegistrar = jest.fn();
const mockDeleteRegistrar = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getRegistrarById: (id: string, tenantId: string) => mockGetRegistrarById(id, tenantId),
  updateRegistrar: (id: string, tenantId: string, input: unknown) => mockUpdateRegistrar(id, tenantId, input),
  deleteRegistrar: (id: string, tenantId: string) => mockDeleteRegistrar(id, tenantId),
}));

import { NotFoundError } from '@/lib/api/errors';
import { GET, PATCH, DELETE } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/registrars/reg-1' } = options;
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

describe('GET /api/v1/registrars/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the registrar record', async () => {
    const registrar = { id: 'reg-1', name: 'GS1', namespace: 'gs1' };
    mockGetRegistrarById.mockResolvedValue(registrar);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('reg-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.registrar).toEqual(registrar);
  });

  it('returns 404 when registrar not found', async () => {
    mockGetRegistrarById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Registrar not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetRegistrarById.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await GET(req, createContext('reg-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('PATCH /api/v1/registrars/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates registrar fields', async () => {
    const updated = { id: 'reg-1', name: 'Updated GS1', namespace: 'gs1' };
    mockUpdateRegistrar.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated GS1' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.registrar.name).toBe('Updated GS1');
  });

  it('updates namespace field', async () => {
    const updated = { id: 'reg-1', name: 'GS1', namespace: 'gs1-updated' };
    mockUpdateRegistrar.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { namespace: 'gs1-updated' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.registrar.namespace).toBe('gs1-updated');
  });

  it('returns 400 when no fields provided', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one of');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      method: 'PATCH',
      url: 'http://localhost/api/v1/registrars/reg-1',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Request;
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 404 when registrar not found or access denied', async () => {
    mockUpdateRegistrar.mockRejectedValue(new NotFoundError('Registrar not found or access denied'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Registrar not found');
  });

  it('allows clearing idrServiceInstanceId with null', async () => {
    const updated = { id: 'reg-1', name: 'GS1', idrServiceInstanceId: null };
    mockUpdateRegistrar.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { idrServiceInstanceId: null } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateRegistrar).toHaveBeenCalledWith('reg-1', 'org-1', { idrServiceInstanceId: null });
  });
});

describe('DELETE /api/v1/registrars/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the registrar', async () => {
    mockDeleteRegistrar.mockResolvedValue({ id: 'reg-1' });

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('reg-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('returns 404 when registrar not found or access denied', async () => {
    mockDeleteRegistrar.mockRejectedValue(new NotFoundError('Registrar not found or access denied'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Registrar not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockDeleteRegistrar.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('reg-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
