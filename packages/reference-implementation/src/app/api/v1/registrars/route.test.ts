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
const mockGetInstanceByResolution = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  createRegistrar: (input: unknown) => mockCreateRegistrar(input),
  listRegistrars: (tenantId: string, opts: unknown) => mockListRegistrars(tenantId, opts),
  getInstanceByResolution: (...args: unknown[]) => mockGetInstanceByResolution(...args),
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

import { MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { ValidationError } from '@/lib/api/validation';
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

function createNullBodyRequest(): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/registrars',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => null,
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('POST /api/v1/registrars', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetInstanceByResolution.mockResolvedValue({ id: 'inst-1', tenantId: 'org-1' });
  });

  it('creates a registrar and returns 201', async () => {
    const registrar = { id: 'reg-1', name: 'GS1', namespace: 'gs1', url: 'https://gs1.org' };
    mockCreateRegistrar.mockResolvedValue(registrar);

    const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual(registrar);
    expect(mockCreateRegistrar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1', name: 'GS1', namespace: 'gs1', url: 'https://gs1.org' }),
    );
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
    expect(json.url).toBe('https://gs1.org');
    // Verifies the tenant-scoped accessibility check runs before the write
    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('org-1', 'IDR', 'inst-1');
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

  it('skips the instance lookup when idrServiceInstanceId is omitted', async () => {
    mockCreateRegistrar.mockResolvedValue({ id: 'reg-1', name: 'GS1', namespace: 'gs1', url: 'https://gs1.org' });

    const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(201);
    expect(mockGetInstanceByResolution).not.toHaveBeenCalled();
  });

  it('returns 404 when idrServiceInstanceId is not accessible to the tenant, and does not call the repository', async () => {
    // The row's foreign key would accept any globally-existing instance, so
    // the handler's tenant-scoped lookup is what keeps another tenant's
    // instance id from being stored; a null lookup result covers both a
    // nonexistent id and one belonging to a different tenant.
    mockGetInstanceByResolution.mockResolvedValue(null);

    const req = createFakeRequest({
      body: { name: 'GS1', namespace: 'gs1', url: 'https://gs1.org', idrServiceInstanceId: 'other-tenant-inst' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Service instance not found');
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for missing name and does not call the repository', async () => {
    const req = createFakeRequest({ body: { namespace: 'gs1', url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^name:/);
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-string name and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 12345, namespace: 'gs1', url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^name:/);
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty string name and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: '', namespace: 'gs1', url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^name:/);
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a whitespace-only name and does not call the repository', async () => {
    // min(1) counts characters, so without the non-blank refinement a single
    // space would create a registrar with a blank name.
    const req = createFakeRequest({ body: { name: '   ', namespace: 'gs1', url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('name: must not be only whitespace');
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for missing namespace and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 'GS1', url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^namespace:/);
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-string namespace and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 'GS1', namespace: 42, url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^namespace:/);
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty string namespace and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 'GS1', namespace: '', url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^namespace:/);
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a whitespace-only namespace and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 'GS1', namespace: ' \t ', url: 'https://gs1.org' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('namespace: must not be only whitespace');
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for missing url and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^url:/);
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-string url and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: 12345 } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^url:/);
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a url that is not a valid URL and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: 'not-a-url' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('url: must be a valid URL');
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a url with leading or trailing whitespace and does not call the repository', async () => {
    // WHATWG URL parsing strips surrounding whitespace, so without the
    // schema's trim refinement a padded url would pass every URL check yet
    // be stored verbatim with the padding intact.
    const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: ' https://gs1.org ' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('url: must not have leading or trailing whitespace');
    expect(mockAssertPublicUrl).not.toHaveBeenCalled();
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('rejects a javascript: scheme url and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: 'javascript:alert(1)' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/http\(s\)/);
    expect(mockAssertPublicUrl).not.toHaveBeenCalled();
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('rejects a mailto: scheme url and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: 'mailto:test@example.com' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/http\(s\)/);
    expect(mockAssertPublicUrl).not.toHaveBeenCalled();
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('rejects a url carrying userinfo and does not call the repository', async () => {
    const req = createFakeRequest({
      body: { name: 'GS1', namespace: 'gs1', url: 'https://user:pass@gs1.org' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/username or password/);
    expect(mockAssertPublicUrl).not.toHaveBeenCalled();
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 when url points to a private address and does not call the repository', async () => {
    delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
    mockAssertPublicUrl.mockRejectedValueOnce(
      new ValidationError('url must not point to a private or reserved network address'),
    );

    const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: 'http://127.0.0.1/registry' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('private or reserved');
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('skips the private-address check when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    try {
      const registrar = { id: 'reg-1', name: 'GS1', namespace: 'gs1', url: 'http://127.0.0.1/registry' };
      mockCreateRegistrar.mockResolvedValue(registrar);

      const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: 'http://127.0.0.1/registry' } });
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

      expect(res.status).toBe(201);
      expect(mockAssertPublicUrl).not.toHaveBeenCalled();
    } finally {
      delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
    }
  });

  it('rejects a javascript: scheme url even when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    try {
      const req = createFakeRequest({ body: { name: 'GS1', namespace: 'gs1', url: 'javascript:alert(1)' } });
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/http\(s\)/);
      expect(mockCreateRegistrar).not.toHaveBeenCalled();
    } finally {
      delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
    }
  });

  it('rejects a url carrying userinfo even when VERIFY_ALLOW_PRIVATE_URLS=true', async () => {
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    try {
      const req = createFakeRequest({
        body: { name: 'GS1', namespace: 'gs1', url: 'https://user:pass@gs1.org' },
      });
      const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/username or password/);
      expect(mockCreateRegistrar).not.toHaveBeenCalled();
    } finally {
      delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
    }
  });

  it('returns 400 for a non-string idrServiceInstanceId and does not call the repository', async () => {
    const req = createFakeRequest({
      body: { name: 'GS1', namespace: 'gs1', url: 'https://gs1.org', idrServiceInstanceId: 12345 },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^idrServiceInstanceId:/);
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty string idrServiceInstanceId and does not call the repository', async () => {
    const req = createFakeRequest({
      body: { name: 'GS1', namespace: 'gs1', url: 'https://gs1.org', idrServiceInstanceId: '' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^idrServiceInstanceId:/);
    expect(mockGetInstanceByResolution).not.toHaveBeenCalled();
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for an explicit null idrServiceInstanceId and does not call the repository', async () => {
    // Unlike PATCH, the create schema's idrServiceInstanceId has no
    // nullable "clear" semantic (there is nothing to clear on create), so a
    // literal null is rejected rather than accepted as absent.
    const req = createFakeRequest({
      body: { name: 'GS1', namespace: 'gs1', url: 'https://gs1.org', idrServiceInstanceId: null },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^idrServiceInstanceId:/);
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body and does not call the repository', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it('returns 400 for a literal null body and does not call the repository', async () => {
    const req = createNullBodyRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Expected object, received null');
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
  });

  it.each([
    ['array', [{ name: 'GS1' }], 'array'],
    ['string', 'GS1', 'string'],
    ['number', 42, 'number'],
  ])('returns 400 for a top-level %s body and does not call the repository', async (_kind, body, received) => {
    const req = createFakeRequest({ body });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain(`Expected object, received ${received}`);
    expect(mockCreateRegistrar).not.toHaveBeenCalled();
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
    mockListRegistrars.mockResolvedValue({ data: registrars, total: 1 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/registrars' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(registrars);
    expect(json.pagination).toBeDefined();
    expect(json.pagination.total).toBe(1);
  });

  it('passes pagination parameters to listRegistrars', async () => {
    mockListRegistrars.mockResolvedValue({ data: [], total: 0 });

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
    mockListRegistrars.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/registrars' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListRegistrars).toHaveBeenCalledWith('org-1', {
      limit: undefined,
      offset: undefined,
    });
  });

  it('returns 400 for non-numeric limit and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/registrars?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit: must be a positive integer');
    expect(mockListRegistrars).not.toHaveBeenCalled();
  });

  it('returns 400 for negative offset and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/registrars?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset: must be a non-negative integer');
    expect(mockListRegistrars).not.toHaveBeenCalled();
  });

  it('rejects a limit above the maximum with a 400 and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: `http://localhost/api/v1/registrars?limit=${MAX_PAGE_LIMIT + 1}`,
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^limit:/);
    expect(mockListRegistrars).not.toHaveBeenCalled();
  });

  it('returns 400 for a repeated query key and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/registrars?limit=10&limit=20',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('repeated query parameter');
    expect(mockListRegistrars).not.toHaveBeenCalled();
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
