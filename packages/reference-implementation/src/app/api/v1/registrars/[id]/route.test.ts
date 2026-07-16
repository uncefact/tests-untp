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

// Mock only assertPublicUrl (the SSRF/private-address check), keeping the
// real assertHttpUrl (scheme + userinfo, pure parsing, no network access) so
// the scheme/userinfo rejection tests exercise the real implementation.
// Mirrors the mocking approach in credentials/route.test.ts.
const mockAssertPublicUrl = jest.fn();
jest.mock('@/lib/api/validation', () => {
  const actual = jest.requireActual('@/lib/api/validation');
  return {
    ...actual,
    assertPublicUrl: (...args: unknown[]) => mockAssertPublicUrl(...args),
  };
});

import { NotFoundError, ConflictError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
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
    expect(json).toEqual(registrar);
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
    expect(json.name).toBe('Updated GS1');
    expect(mockUpdateRegistrar).toHaveBeenCalledWith('reg-1', 'org-1', { name: 'Updated GS1' });
  });

  it('updates namespace field', async () => {
    const updated = { id: 'reg-1', name: 'GS1', namespace: 'gs1-updated' };
    mockUpdateRegistrar.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { namespace: 'gs1-updated' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.namespace).toBe('gs1-updated');
  });

  it('updates url field and forwards it to the repository', async () => {
    const updated = { id: 'reg-1', name: 'GS1', url: 'https://gs1.org/new' };
    mockUpdateRegistrar.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { url: 'https://gs1.org/new' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateRegistrar).toHaveBeenCalledWith('reg-1', 'org-1', { url: 'https://gs1.org/new' });
  });

  it('returns 400 when no fields provided and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one field is required');
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 when the body only has an unrecognised (typo) field name and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { neme: 'Updated GS1' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one field is required');
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-string name and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: 12345 } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^name:/);
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty string name and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^name:/);
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-string namespace and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { namespace: 42 } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^namespace:/);
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty string namespace and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { namespace: '' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^namespace:/);
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-string url and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { url: 12345 } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^url:/);
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a url that is not a valid URL and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { url: 'not-a-url' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('url: must be a valid URL');
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a url of null (url has no clear-via-null semantic through this API) and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { url: null } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^url:/);
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('rejects a javascript: scheme url and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { url: 'javascript:alert(1)' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/http\(s\)/);
    expect(mockAssertPublicUrl).not.toHaveBeenCalled();
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('rejects a mailto: scheme url and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { url: 'mailto:test@example.com' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/http\(s\)/);
    expect(mockAssertPublicUrl).not.toHaveBeenCalled();
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('rejects a url carrying userinfo and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { url: 'https://user:pass@gs1.org' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/username or password/);
    expect(mockAssertPublicUrl).not.toHaveBeenCalled();
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 when url points to a private address and does not call the repository', async () => {
    delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
    mockAssertPublicUrl.mockRejectedValueOnce(
      new ValidationError('url must not point to a private or reserved network address'),
    );

    const req = createFakeRequest({ method: 'PATCH', body: { url: 'http://127.0.0.1/registry' } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('private or reserved');
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('skips the private-address check when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    try {
      const updated = { id: 'reg-1', name: 'GS1', url: 'http://127.0.0.1/registry' };
      mockUpdateRegistrar.mockResolvedValue(updated);

      const req = createFakeRequest({ method: 'PATCH', body: { url: 'http://127.0.0.1/registry' } });
      const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);

      expect(res.status).toBe(200);
      expect(mockAssertPublicUrl).not.toHaveBeenCalled();
    } finally {
      delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
    }
  });

  it('rejects a javascript: scheme url even when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    try {
      const req = createFakeRequest({ method: 'PATCH', body: { url: 'javascript:alert(1)' } });
      const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/http\(s\)/);
      expect(mockUpdateRegistrar).not.toHaveBeenCalled();
    } finally {
      delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
    }
  });

  it('rejects a url carrying userinfo even when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    try {
      const req = createFakeRequest({ method: 'PATCH', body: { url: 'https://user:pass@gs1.org' } });
      const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/username or password/);
      expect(mockUpdateRegistrar).not.toHaveBeenCalled();
    } finally {
      delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
    }
  });

  it('returns 400 for a non-string idrServiceInstanceId and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { idrServiceInstanceId: 12345 } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^idrServiceInstanceId:/);
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for an explicit null name and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: null } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^name:/);
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for an explicit null namespace and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { namespace: null } });
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^namespace:/);
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body and does not call the repository', async () => {
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
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a literal null body and does not call the repository', async () => {
    const req = {
      method: 'PATCH',
      url: 'http://localhost/api/v1/registrars/reg-1',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => null,
    } as unknown as Request;
    const res = await PATCH(req, createContext('reg-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Expected object, received null');
    expect(mockUpdateRegistrar).not.toHaveBeenCalled();
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

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
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

  it('returns 409 when the registrar has schemes with identifiers and cannot be deleted', async () => {
    mockDeleteRegistrar.mockRejectedValue(
      new ConflictError('The registrar has schemes with identifiers and cannot be deleted'),
    );

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('reg-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('The registrar has schemes with identifiers and cannot be deleted');
  });
});
