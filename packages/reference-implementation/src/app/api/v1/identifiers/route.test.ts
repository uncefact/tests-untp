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

const mockCreateIdentifier = jest.fn();
const mockListIdentifiers = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  createIdentifier: (input: unknown) => mockCreateIdentifier(input),
  listIdentifiers: (tenantId: string, opts: unknown) => mockListIdentifiers(tenantId, opts),
}));

import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { POST, GET } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'POST', body, url = 'http://localhost/api/v1/identifiers' } = options;
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
    url: 'http://localhost/api/v1/identifiers',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('POST /api/v1/identifiers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates an identifier and returns 201', async () => {
    const identifier = { id: 'id-1', schemeId: 'sch-1', value: '09520123456788' };
    mockCreateIdentifier.mockResolvedValue(identifier);

    const req = createFakeRequest({
      body: { schemeId: 'sch-1', value: '09520123456788' },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.identifier).toEqual(identifier);
  });

  it('passes correct input to createIdentifier', async () => {
    mockCreateIdentifier.mockResolvedValue({ id: 'id-1' });

    const req = createFakeRequest({
      body: { schemeId: 'sch-1', value: '09520123456788' },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockCreateIdentifier).toHaveBeenCalledWith({
      tenantId: 'org-1',
      schemeId: 'sch-1',
      value: '09520123456788',
    });
  });

  it('returns 400 for missing schemeId', async () => {
    const req = createFakeRequest({ body: { value: '09520123456788' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('schemeId is required');
  });

  it('returns 400 for missing value', async () => {
    const req = createFakeRequest({ body: { schemeId: 'sch-1' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('value is required');
  });

  it('returns 400 when value fails scheme validation', async () => {
    mockCreateIdentifier.mockRejectedValue(
      new ValidationError('Identifier value "abc" does not match scheme validation pattern: ^\\d{14}$'),
    );

    const req = createFakeRequest({ body: { schemeId: 'sch-1', value: 'abc' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('does not match scheme validation pattern');
  });

  it('returns 404 when scheme not found', async () => {
    mockCreateIdentifier.mockRejectedValue(new NotFoundError('Identifier scheme not found'));

    const req = createFakeRequest({ body: { schemeId: 'nonexistent', value: '09520123456788' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Identifier scheme not found');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 500 when repository throws unexpected error', async () => {
    mockCreateIdentifier.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ body: { schemeId: 'sch-1', value: '09520123456788' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('GET /api/v1/identifiers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists identifiers for the tenant', async () => {
    const identifiers = [{ id: 'id-1', value: '09520123456788' }];
    mockListIdentifiers.mockResolvedValue(identifiers);

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/identifiers' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.identifiers).toEqual(identifiers);
  });

  it('passes schemeId filter to listIdentifiers', async () => {
    mockListIdentifiers.mockResolvedValue([]);

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/identifiers?schemeId=sch-1',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListIdentifiers).toHaveBeenCalledWith('org-1', {
      schemeId: 'sch-1',
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes pagination parameters', async () => {
    mockListIdentifiers.mockResolvedValue([]);

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/identifiers?limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListIdentifiers).toHaveBeenCalledWith('org-1', {
      schemeId: undefined,
      limit: 10,
      offset: 5,
    });
  });

  it('handles no query parameters', async () => {
    mockListIdentifiers.mockResolvedValue([]);

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/identifiers' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListIdentifiers).toHaveBeenCalledWith('org-1', {
      schemeId: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('returns 400 for non-numeric limit', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/identifiers?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/identifiers?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset must be a non-negative integer');
  });

  it('returns 500 when listIdentifiers throws', async () => {
    mockListIdentifiers.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/identifiers' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
