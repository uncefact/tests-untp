// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withTenantAuth to mirror handleRouteError behaviour
jest.mock('@/lib/api/with-tenant-auth', () => {
  const { NotFoundError, errorMessage } = jest.requireActual('@/lib/api/errors');
  const { ValidationError } = jest.requireActual('@/lib/api/validation');

  function jsonResponse(body: unknown, init?: { status?: number }) {
    return { status: init?.status ?? 200, json: async () => body };
  }

  return {
    withTenantAuth:
      (handler: (req: unknown, ctx: unknown) => Promise<unknown>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
        } catch (e: unknown) {
          if (e instanceof ValidationError) {
            return jsonResponse({ error: (e as Error).message }, { status: 400 });
          }
          if (e instanceof NotFoundError) {
            return jsonResponse({ error: (e as Error).message }, { status: 404 });
          }
          return jsonResponse({ error: errorMessage(e) }, { status: 500 });
        }
      },
  };
});

const mockListCatalogues = jest.fn();
const mockImportCvc = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  listCatalogues: (...args: unknown[]) => mockListCatalogues(...args),
}));

jest.mock('@/lib/services/cvc-import.service', () => ({
  importCvc: (...args: unknown[]) => mockImportCvc(...args),
}));

import { GET, POST } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/cvc/catalogues' } = options;
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

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('GET /api/v1/cvc/catalogues', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists catalogues with default pagination', async () => {
    const catalogues = [{ id: 'cat-1', name: 'Test Catalogue' }];
    mockListCatalogues.mockResolvedValue({ data: catalogues, total: 1 });

    const req = createFakeRequest({ method: 'GET' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(catalogues);
    expect(json.pagination).toEqual({ total: 1, limit: 20, offset: 0, hasMore: false });
    expect(mockListCatalogues).toHaveBeenCalledWith('org-1', {
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes limit and offset from query params', async () => {
    mockListCatalogues.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/cvc/catalogues?limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListCatalogues).toHaveBeenCalledWith('org-1', {
      limit: 10,
      offset: 5,
    });
  });

  it('returns validation error for invalid limit', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/cvc/catalogues?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 500 when listCatalogues throws', async () => {
    mockListCatalogues.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Database error');
  });
});

describe('POST /api/v1/cvc/catalogues', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('imports catalogue from URL and returns 201', async () => {
    const catalogue = { id: 'cat-1', name: 'Imported Catalogue' };
    const summary = { schemes: 2, profiles: 4, criteria: 10 };
    mockImportCvc.mockResolvedValue({ catalogue, summary });

    const req = createFakeRequest({
      method: 'POST',
      body: { url: 'https://example.com/cvc.jsonld', version: '0.7.0' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.catalogue).toEqual(catalogue);
    expect(json.summary).toEqual(summary);
    expect(json).not.toHaveProperty('ok');
    expect(mockImportCvc).toHaveBeenCalledWith('org-1', 'https://example.com/cvc.jsonld', '0.7.0');
  });

  it('returns validation error when url is missing', async () => {
    const req = createFakeRequest({ method: 'POST', body: { version: '0.7.0' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('url is required');
  });

  it('returns validation error when version is missing', async () => {
    const req = createFakeRequest({
      method: 'POST',
      body: { url: 'https://example.com/cvc.jsonld' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('version is required');
  });

  it('returns validation error for invalid URL format', async () => {
    const req = createFakeRequest({
      method: 'POST',
      body: { url: 'not-a-valid-url', version: '0.7.0' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('url must be a valid URL');
  });

  it('returns validation error for invalid JSON body', async () => {
    const req = {
      method: 'POST',
      url: 'http://localhost/api/v1/cvc/catalogues',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected token n in JSON at position 0');
      },
    } as unknown as Request;
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 500 when importCvc throws', async () => {
    mockImportCvc.mockRejectedValue(new Error('Fetch failed'));

    const req = createFakeRequest({
      method: 'POST',
      body: { url: 'https://example.com/cvc.jsonld', version: '0.7.0' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Fetch failed');
  });
});
