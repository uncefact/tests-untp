jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock @uncefact/untp-ri-services — spread actual to preserve error classes
// while avoiding ESM resolution issues with transitive deps like uuid
jest.mock('@uncefact/untp-ri-services', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services');
  return {
    ...actual,
  };
});

jest.mock('@/lib/api/with-tenant-auth', () => {
  const { NotFoundError, errorMessage, ServiceRegistryError } = jest.requireActual('@/lib/api/errors');
  const { ValidationError } = jest.requireActual('@/lib/api/validation');
  const { ServiceError } = jest.requireActual('@uncefact/untp-ri-services');

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
          if (e instanceof ServiceRegistryError) {
            return jsonResponse({ error: (e as Error).message }, { status: 500 });
          }
          if (e instanceof ServiceError) {
            const serviceErr = e as Error & { code?: string; statusCode?: number };
            return jsonResponse(
              { error: serviceErr.message, code: serviceErr.code },
              { status: serviceErr.statusCode },
            );
          }
          return jsonResponse({ error: errorMessage(e) }, { status: 500 });
        }
      },
  };
});

const mockGetIdentifierById = jest.fn();
const mockCreateManyLinkRegistrations = jest.fn();
const mockListLinkRegistrations = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  getIdentifierById: (...args: unknown[]) => mockGetIdentifierById(...args),
  createManyLinkRegistrations: (...args: unknown[]) => mockCreateManyLinkRegistrations(...args),
  listLinkRegistrations: (...args: unknown[]) => mockListLinkRegistrations(...args),
}));

const mockResolveIdrService = jest.fn();
jest.mock('@/lib/services/resolve-idr-service', () => ({
  resolveIdrService: (...args: unknown[]) => mockResolveIdrService(...args),
}));

import { IdrPublishError } from '@uncefact/untp-ri-services';
import { POST, GET } from './route';

// -- Helpers -------------------------------------------------------------------

function createFakeRequest(body: unknown) {
  return { json: async () => body, url: 'http://localhost/api/v1/identifiers/ident-1/links' } as unknown as Request;
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    params: Promise.resolve({ id: 'ident-1' }),
    ...overrides,
  } as unknown as { params: Promise<Record<string, string>> };
}

const MOCK_IDENTIFIER = {
  id: 'ident-1',
  tenantId: 'tenant-1',
  schemeId: 'scheme-1',
  value: '09520123456788',
  scheme: {
    id: 'scheme-1',
    primaryKey: '01',
    namespace: null,
    idrServiceInstanceId: null,
    registrar: {
      id: 'reg-1',
      namespace: 'gs1',
      idrServiceInstanceId: null,
    },
    qualifiers: [],
  },
};

const MOCK_IDR_SERVICE = {
  publishLinks: jest.fn(),
  getLinkById: jest.fn(),
  updateLink: jest.fn(),
  deleteLink: jest.fn(),
  getResolverDescription: jest.fn(),
  getLinkTypes: jest.fn(),
  buildResolverUri: jest.fn(),
};

// -- Tests ---------------------------------------------------------------------

describe('POST /api/v1/identifiers/[id]/links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);
    mockResolveIdrService.mockResolvedValue({ service: MOCK_IDR_SERVICE, instanceId: 'idr-1' });
    MOCK_IDR_SERVICE.publishLinks.mockResolvedValue({
      resolverUri: 'https://resolver.example.com/01/09520123456788',
      identifierScheme: '01',
      identifier: '09520123456788',
      links: [
        {
          idrLinkId: 'idr-link-1',
          link: { href: 'https://example.com/cred.json', rel: 'untp:dpp', type: 'application/json' },
        },
      ],
    });
    mockCreateManyLinkRegistrations.mockResolvedValue(undefined);
  });

  it('publishes links and returns 201', async () => {
    const req = createFakeRequest({
      links: [{ href: 'https://example.com/cred.json', rel: 'untp:dpp', type: 'application/json' }],
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.resolverUri).toBe('https://resolver.example.com/01/09520123456788');
    expect(mockCreateManyLinkRegistrations).toHaveBeenCalledTimes(1);
  });

  it('passes description through to publishLinks options', async () => {
    const req = createFakeRequest({
      links: [{ href: 'https://example.com/cred.json', rel: 'untp:dpp', type: 'application/json' }],
      description: 'A test product description',
    });

    const res = await POST(req, createContext());

    expect(res.status).toBe(201);
    expect(MOCK_IDR_SERVICE.publishLinks).toHaveBeenCalledWith('01', '09520123456788', expect.any(Array), undefined, {
      namespace: 'gs1',
      description: 'A test product description',
    });
  });

  it('passes undefined description when not provided in request body', async () => {
    const req = createFakeRequest({
      links: [{ href: 'https://example.com/cred.json', rel: 'untp:dpp', type: 'application/json' }],
    });

    const res = await POST(req, createContext());

    expect(res.status).toBe(201);
    expect(MOCK_IDR_SERVICE.publishLinks).toHaveBeenCalledWith('01', '09520123456788', expect.any(Array), undefined, {
      namespace: 'gs1',
      description: undefined,
    });
  });

  it('passes qualifierPath through to publishLinks', async () => {
    const req = createFakeRequest({
      links: [{ href: 'https://example.com/cred.json', rel: 'untp:dpp', type: 'application/json' }],
      qualifierPath: '/lot/ABC123',
      description: 'Product with qualifier',
    });

    const res = await POST(req, createContext());

    expect(res.status).toBe(201);
    expect(MOCK_IDR_SERVICE.publishLinks).toHaveBeenCalledWith(
      '01',
      '09520123456788',
      expect.any(Array),
      '/lot/ABC123',
      { namespace: 'gs1', description: 'Product with qualifier' },
    );
  });

  it('returns 400 for missing links', async () => {
    const req = createFakeRequest({});

    const res = await POST(req, createContext());

    expect(res.status).toBe(400);
  });

  it('returns 400 for empty links array', async () => {
    const req = createFakeRequest({ links: [] });

    const res = await POST(req, createContext());

    expect(res.status).toBe(400);
  });

  it('returns 404 when identifier not found', async () => {
    mockGetIdentifierById.mockResolvedValue(null);

    const req = createFakeRequest({
      links: [{ href: 'https://example.com', rel: 'untp:dpp', type: 'application/json' }],
    });

    const res = await POST(req, createContext());

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      json: async () => {
        throw new Error('bad json');
      },
      url: 'http://localhost/test',
    } as unknown as Request;

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid JSON body');
  });

  it('returns IDR service error with proper status when publishLinks fails', async () => {
    MOCK_IDR_SERVICE.publishLinks.mockRejectedValue(
      new IdrPublishError('01', '09520123456788', 500, 'upstream timeout'),
    );

    const req = createFakeRequest({
      links: [{ href: 'https://example.com/cred.json', rel: 'untp:dpp', type: 'application/json' }],
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe('IDR_PUBLISH_FAILED');
  });
});

describe('GET /api/v1/identifiers/[id]/links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns link registrations with pagination', async () => {
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);
    mockListLinkRegistrations.mockResolvedValue({
      data: [{ id: 'lr-1', idrLinkId: 'idr-link-1', linkType: 'untp:dpp' }],
      total: 1,
    });

    const req = { url: 'http://localhost/api/v1/identifiers/ident-1/links' } as unknown as Request;
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.total).toBe(1);
  });

  it('returns 404 when identifier not found', async () => {
    mockGetIdentifierById.mockResolvedValue(null);

    const req = { url: 'http://localhost/api/v1/identifiers/ident-1/links' } as unknown as Request;
    const res = await GET(req, createContext());

    expect(res.status).toBe(404);
  });

  it('returns 400 for non-numeric limit', async () => {
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);

    const req = { url: 'http://localhost/api/v1/identifiers/ident-1/links?limit=abc' } as unknown as Request;
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);

    const req = { url: 'http://localhost/api/v1/identifiers/ident-1/links?offset=-1' } as unknown as Request;
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('offset must be a non-negative integer');
  });
});
