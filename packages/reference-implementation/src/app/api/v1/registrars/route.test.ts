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

const mockCreateRegistrar = jest.fn();
const mockListRegistrars = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  createRegistrar: (input: unknown) => mockCreateRegistrar(input),
  listRegistrars: (tenantId: string, opts: unknown) => mockListRegistrars(tenantId, opts),
}));

import { POST, GET } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'POST', body, url = 'http://localhost/api/v1/registrars' } = options;
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

function createBadJsonRequest(): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/registrars',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('POST /api/v1/registrars', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a registrar and returns 201', async () => {
    const registrar = { id: 'reg-1', name: 'GS1', namespace: 'gs1', url: 'https://gs1.org' };
    mockCreateRegistrar.mockResolvedValue(registrar);

    const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.registrar).toEqual(registrar);
  });

  it('creates a registrar with optional fields', async () => {
    const registrar = {
      id: 'reg-1',
      name: 'GS1',
      namespace: 'gs1',
      url: 'https://gs1.org',
      idrServiceInstanceId: 'inst-1',
    };
    mockCreateRegistrar.mockResolvedValue(registrar);

    const req = createFakeRequest({
      body: { name: 'GS1', namespace: 'gs1', url: 'https://gs1.org', idrServiceInstanceId: 'inst-1' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.registrar.url).toBe('https://gs1.org');
    expect(mockCreateRegistrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        name: 'GS1',
        namespace: 'gs1',
        url: 'https://gs1.org',
        idrServiceInstanceId: 'inst-1',
      }),
    );
  });

  it('returns 400 for missing name', async () => {
    const req = createFakeRequest({ body: { namespace: 'gs1' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name is required');
  });

  it('returns 400 for missing namespace', async () => {
    const req = createFakeRequest({ body: { name: 'GS1' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('namespace is required');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 500 when repository throws', async () => {
    mockCreateRegistrar.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('GET /api/v1/registrars', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists registrars for the tenant', async () => {
    const registrars = [{ id: 'reg-1', name: 'GS1', namespace: 'gs1' }];
    mockListRegistrars.mockResolvedValue(registrars);

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/registrars' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.registrars).toEqual(registrars);
  });

  it('passes pagination parameters to listRegistrars', async () => {
    mockListRegistrars.mockResolvedValue([]);

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/registrars?limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListRegistrars).toHaveBeenCalledWith('org-1', {
      limit: 10,
      offset: 5,
    });
  });

  it('handles no query parameters', async () => {
    mockListRegistrars.mockResolvedValue([]);

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/registrars' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListRegistrars).toHaveBeenCalledWith('org-1', {
      limit: undefined,
      offset: undefined,
    });
  });

  it('returns 400 for non-numeric limit', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/registrars?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/registrars?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset must be a non-negative integer');
  });

  it('returns 500 when listRegistrars throws', async () => {
    mockListRegistrars.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/registrars' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
