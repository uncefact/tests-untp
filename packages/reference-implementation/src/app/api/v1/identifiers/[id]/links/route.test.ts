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
import { MAX_PAGE_LIMIT } from '@/lib/api/pagination';
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

  it('returns 400 naming links for a missing links array, without attempting a publish', async () => {
    const req = createFakeRequest({});

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/links/);
    expect(MOCK_IDR_SERVICE.publishLinks).not.toHaveBeenCalled();
  });

  it('returns 400 naming links for an empty links array, without attempting a publish', async () => {
    const req = createFakeRequest({ links: [] });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/links/);
    expect(MOCK_IDR_SERVICE.publishLinks).not.toHaveBeenCalled();
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

  it('forwards hreflang, additionalRels, and public on each link to publishLinks', async () => {
    const req = createFakeRequest({
      links: [
        {
          href: 'https://example.com/cred.json',
          rel: 'untp:dpp',
          type: 'application/json',
          hreflang: ['en', 'de'],
          additionalRels: ['gs1:certificationInfo'],
          public: true,
        },
      ],
    });

    const res = await POST(req, createContext());
    expect(res.status).toBe(201);

    const linksArg = MOCK_IDR_SERVICE.publishLinks.mock.calls[0][2];
    expect(linksArg[0]).toMatchObject({
      hreflang: ['en', 'de'],
      additionalRels: ['gs1:certificationInfo'],
      public: true,
    });
  });

  it('forwards accessRole on a link to publishLinks', async () => {
    const req = createFakeRequest({
      links: [
        {
          href: 'https://example.com/cred.json',
          rel: 'untp:dpp',
          type: 'application/json',
          accessRole: ['untp:accessRole#Regulator', 'untp:accessRole#Owner'],
        },
      ],
    });

    const res = await POST(req, createContext());
    expect(res.status).toBe(201);

    const linksArg = MOCK_IDR_SERVICE.publishLinks.mock.calls[0][2];
    expect(linksArg[0]).toMatchObject({ accessRole: ['untp:accessRole#Regulator', 'untp:accessRole#Owner'] });
  });

  it('returns 400 when accessRole contains a value outside the UNTP vocabulary', async () => {
    const req = createFakeRequest({
      links: [
        {
          href: 'https://example.com/cred.json',
          rel: 'untp:dpp',
          type: 'application/json',
          accessRole: ['untp:accessRole#Anyone'],
        },
      ],
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/accessRole/);
    expect(MOCK_IDR_SERVICE.publishLinks).not.toHaveBeenCalled();
  });

  it('returns 400 when hreflang is a string rather than an array', async () => {
    const req = createFakeRequest({
      links: [{ href: 'https://example.com/cred.json', rel: 'untp:dpp', type: 'application/json', hreflang: 'en' }],
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/hreflang/);
  });

  it.each([
    ['href', { rel: 'untp:dpp', type: 'application/json' }],
    ['rel', { href: 'https://example.com/cred.json', type: 'application/json' }],
    ['type', { href: 'https://example.com/cred.json', rel: 'untp:dpp' }],
  ])('returns 400 naming %s when a link omits it, without attempting a publish', async (field, link) => {
    const req = createFakeRequest({ links: [link] });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(new RegExp(field));
    expect(MOCK_IDR_SERVICE.publishLinks).not.toHaveBeenCalled();
  });

  it.each([
    ['rel', { href: 'https://example.com/cred.json', rel: 42, type: 'application/json' }],
    ['type', { href: 'https://example.com/cred.json', rel: 'untp:dpp', type: true }],
  ])('returns 400 naming %s when a link mistypes it, without attempting a publish', async (field, link) => {
    const req = createFakeRequest({ links: [link] });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(new RegExp(field));
    expect(MOCK_IDR_SERVICE.publishLinks).not.toHaveBeenCalled();
  });

  it.each([
    ['rel', { href: 'https://example.com/cred.json', rel: '   ', type: 'application/json' }],
    ['type', { href: 'https://example.com/cred.json', rel: 'untp:dpp', type: '   ' }],
    [
      'additionalRels',
      { href: 'https://example.com/cred.json', rel: 'untp:dpp', type: 'application/json', additionalRels: ['  '] },
    ],
  ])('returns 400 naming %s for a whitespace-only value, without attempting a publish', async (field, link) => {
    const req = createFakeRequest({ links: [link] });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(new RegExp(field));
    expect(MOCK_IDR_SERVICE.publishLinks).not.toHaveBeenCalled();
  });

  // A relative value is rejected earlier, by the schema's own `.url()` check,
  // so it is covered by 'returns 400 when href is not a valid URL' below and
  // reports zod's dotted path rather than the guard's bracketed one.
  it.each([
    ['a non-http scheme', 'ftp://example.com/cred.json'],
    ['embedded userinfo', 'https://user:pass@example.com/cred.json'],
  ])('returns 400 naming the offending link when href carries %s', async (_case, href) => {
    const req = createFakeRequest({
      links: [
        { href: 'https://example.com/ok.json', rel: 'untp:dpp', type: 'application/json' },
        { href, rel: 'untp:dpp', type: 'application/json' },
      ],
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/links\.1\.href/);
    expect(MOCK_IDR_SERVICE.publishLinks).not.toHaveBeenCalled();
  });

  describe('private-address guard', () => {
    const originalValue = process.env.VERIFY_ALLOW_PRIVATE_URLS;

    afterEach(() => {
      if (originalValue === undefined) delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
      else process.env.VERIFY_ALLOW_PRIVATE_URLS = originalValue;
    });

    it('rejects a private target address with a 400 when the guard is active', async () => {
      delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
      const req = createFakeRequest({
        links: [{ href: 'http://127.0.0.1/cred.json', rel: 'untp:dpp', type: 'application/json' }],
      });

      const res = await POST(req, createContext());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/links\.0\.href/);
      expect(MOCK_IDR_SERVICE.publishLinks).not.toHaveBeenCalled();
    });

    it('publishes to a private target address when VERIFY_ALLOW_PRIVATE_URLS relaxes the guard', async () => {
      process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
      const req = createFakeRequest({
        links: [{ href: 'http://127.0.0.1/cred.json', rel: 'untp:dpp', type: 'application/json' }],
      });

      const res = await POST(req, createContext());

      expect(res.status).toBe(201);
      expect(MOCK_IDR_SERVICE.publishLinks).toHaveBeenCalledWith(
        '01',
        '09520123456788',
        [expect.objectContaining({ href: 'http://127.0.0.1/cred.json' })],
        undefined,
        expect.anything(),
      );
    });
  });

  it('audits the href the IDR echoed back, so a canonical publish cannot be audited raw', async () => {
    // This mock echoes its input, unlike the suite's default hard-coded reply,
    // so the assertion fails if the route ever publishes one value and audits
    // another.
    MOCK_IDR_SERVICE.publishLinks.mockImplementation(
      async (_key: string, _value: string, links: { href: string }[]) => ({
        resolverUri: 'https://resolver.example.com/01/09520123456788',
        identifierScheme: '01',
        identifier: '09520123456788',
        links: links.map((link, index) => ({ idrLinkId: `idr-link-${index}`, link })),
      }),
    );

    const req = createFakeRequest({
      links: [{ href: 'https://example.com', rel: 'untp:dpp', type: 'application/json' }],
    });

    const res = await POST(req, createContext());

    expect(res.status).toBe(201);
    expect(mockCreateManyLinkRegistrations).toHaveBeenCalledWith([
      expect.objectContaining({ targetUrl: 'https://example.com/' }),
    ]);
  });

  it('publishes the canonical href rather than the raw caller string', async () => {
    const req = createFakeRequest({
      links: [{ href: 'https://example.com', rel: 'untp:dpp', type: 'application/json' }],
    });

    const res = await POST(req, createContext());

    expect(res.status).toBe(201);
    expect(MOCK_IDR_SERVICE.publishLinks).toHaveBeenCalledWith(
      '01',
      '09520123456788',
      [expect.objectContaining({ href: 'https://example.com/' })],
      undefined,
      expect.anything(),
    );
  });

  it('returns 400 naming hreflang when an entry is not a well-formed BCP 47 language tag', async () => {
    const req = createFakeRequest({
      links: [
        { href: 'https://example.com/cred.json', rel: 'untp:dpp', type: 'application/json', hreflang: ['en', 'e n'] },
      ],
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/hreflang/);
    expect(MOCK_IDR_SERVICE.publishLinks).not.toHaveBeenCalled();
  });

  it('accepts well-formed hreflang tags across the BCP 47 forms and forwards them verbatim', async () => {
    const req = createFakeRequest({
      links: [
        {
          href: 'https://example.com/cred.json',
          rel: 'untp:dpp',
          type: 'application/json',
          hreflang: ['en', 'en-AU', 'zh-Hans-CN', 'x-default'],
        },
      ],
    });

    const res = await POST(req, createContext());

    expect(res.status).toBe(201);
    expect(MOCK_IDR_SERVICE.publishLinks).toHaveBeenCalledWith(
      '01',
      '09520123456788',
      [expect.objectContaining({ hreflang: ['en', 'en-AU', 'zh-Hans-CN', 'x-default'] })],
      undefined,
      expect.anything(),
    );
  });

  it('returns 400 when href is not a valid URL', async () => {
    const req = createFakeRequest({
      links: [{ href: 'not-a-url', rel: 'untp:dpp', type: 'application/json' }],
    });

    const res = await POST(req, createContext());
    expect(res.status).toBe(400);
  });

  it('returns 400 when public is not a boolean', async () => {
    const req = createFakeRequest({
      links: [{ href: 'https://example.com/cred.json', rel: 'untp:dpp', type: 'application/json', public: 'true' }],
    });

    const res = await POST(req, createContext());
    expect(res.status).toBe(400);
  });

  it('round-trips public: false distinctly from unset when forwarding to publishLinks', async () => {
    const req = createFakeRequest({
      links: [
        { href: 'https://example.com/a.json', rel: 'untp:dpp', type: 'application/json', public: false },
        { href: 'https://example.com/b.json', rel: 'untp:dpp', type: 'application/json' },
      ],
    });

    await POST(req, createContext());

    const linksArg = MOCK_IDR_SERVICE.publishLinks.mock.calls[0][2];
    expect(linksArg[0].public).toBe(false);
    expect(linksArg[1]).not.toHaveProperty('public');
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

  it.each(['abc', '1.5', '1e3', '0x10', '1abc', '0', '-1'])(
    'returns 400 naming limit for the non-integer or out-of-range value %s',
    async (value) => {
      mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);

      const req = { url: `http://localhost/api/v1/identifiers/ident-1/links?limit=${value}` } as unknown as Request;
      const res = await GET(req, createContext());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain('limit: must be a positive integer');
      expect(mockListLinkRegistrations).not.toHaveBeenCalled();
    },
  );

  it.each(['abc', '1.5', '-1'])('returns 400 naming offset for the invalid value %s', async (value) => {
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);

    const req = { url: `http://localhost/api/v1/identifiers/ident-1/links?offset=${value}` } as unknown as Request;
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('offset: must be a non-negative integer');
    expect(mockListLinkRegistrations).not.toHaveBeenCalled();
  });

  it('rejects a limit above the maximum with a 400 naming the maximum, rather than clamping it', async () => {
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);

    const req = {
      url: `http://localhost/api/v1/identifiers/ident-1/links?limit=${MAX_PAGE_LIMIT + 1}`,
    } as unknown as Request;
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain(`limit: must not exceed the maximum of ${MAX_PAGE_LIMIT}`);
    expect(mockListLinkRegistrations).not.toHaveBeenCalled();
  });

  it('passes a valid limit and offset through to the repository', async () => {
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);
    mockListLinkRegistrations.mockResolvedValue({ data: [], total: 0 });

    const req = { url: 'http://localhost/api/v1/identifiers/ident-1/links?limit=5&offset=10' } as unknown as Request;
    const res = await GET(req, createContext());

    expect(res.status).toBe(200);
    expect(mockListLinkRegistrations).toHaveBeenCalledWith('ident-1', 'tenant-1', 5, 10);
  });

  it('reports an invalid limit rather than the missing identifier when both are wrong', async () => {
    mockGetIdentifierById.mockResolvedValue(null);

    const req = { url: 'http://localhost/api/v1/identifiers/ident-1/links?limit=abc' } as unknown as Request;
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('limit: must be a positive integer');
  });

  it('returns 400 for a repeated query parameter', async () => {
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);

    const req = { url: 'http://localhost/api/v1/identifiers/ident-1/links?limit=5&limit=6' } as unknown as Request;
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('limit: repeated query parameter');
    expect(mockListLinkRegistrations).not.toHaveBeenCalled();
  });
});
