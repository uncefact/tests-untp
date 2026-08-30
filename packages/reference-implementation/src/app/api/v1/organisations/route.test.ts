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

const mockCreateOrganisations = jest.fn();
const mockListOrganisations = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  createOrganisations: (tenantId: string, inputs: unknown) => mockCreateOrganisations(tenantId, inputs),
  listOrganisations: (tenantId: string, opts: unknown) => mockListOrganisations(tenantId, opts),
}));

import { NotFoundError, ConflictError } from '@/lib/api/errors';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { POST, GET } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'POST', body, url = 'http://localhost/api/v1/organisations' } = options;
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
    url: 'http://localhost/api/v1/organisations',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token n in JSON at position 0');
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('POST /api/v1/organisations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates organisations and returns 201', async () => {
    const organisations = [
      { id: 'org-a', name: 'Acme Corp' },
      { id: 'org-b', name: 'Widget Co' },
    ];
    mockCreateOrganisations.mockResolvedValue(organisations);

    const req = createFakeRequest({
      body: [{ name: 'Acme Corp' }, { name: 'Widget Co' }],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual(organisations);
  });

  it('creates an organisation with optional fields and forwards them to the repository', async () => {
    mockCreateOrganisations.mockResolvedValue([{ id: 'org-a' }]);

    const req = createFakeRequest({
      body: [
        {
          name: 'Acme Corp',
          description: 'A test organisation',
          location: { address: { streetAddress: '123 Main St' } },
          primaryIdentifierId: 'ident-1',
          secondaryIdentifierIds: ['ident-2', 'ident-3'],
        },
      ],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(201);
    expect(mockCreateOrganisations).toHaveBeenCalledWith('org-1', [
      {
        name: 'Acme Corp',
        description: 'A test organisation',
        location: { address: { streetAddress: '123 Main St' } },
        primaryIdentifierId: 'ident-1',
        secondaryIdentifierIds: ['ident-2', 'ident-3'],
      },
    ]);
  });

  it('strips an unrecognised key from an otherwise-valid item rather than rejecting or forwarding it', async () => {
    mockCreateOrganisations.mockResolvedValue([{ id: 'org-a' }]);

    const req = createFakeRequest({
      body: [{ name: 'Acme Corp', typo: 'x' }],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(201);
    expect(mockCreateOrganisations).toHaveBeenCalledWith('org-1', [{ name: 'Acme Corp' }]);
  });

  it('returns 400 for an explicit null location and does not call the repository', async () => {
    // A schema regression re-admitting null here would forward a value the
    // Prisma client's input types exclude (Json null writes require the
    // DbNull/JsonNull sentinels), and location's clear mechanism is
    // deliberately deferred to #804.
    const req = createFakeRequest({
      body: [{ name: 'Acme Corp', location: null }],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.location:/);
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when body is not an array and does not call the repository', async () => {
    const req = createFakeRequest({ body: { name: 'Acme Corp' } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Request body must be an array');
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when body is an empty array and does not call the repository', async () => {
    const req = createFakeRequest({ body: [] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Request body must not be empty');
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 for a literal null body and does not call the repository', async () => {
    const req = createFakeRequest({ body: null });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('body: Expected object, received null');
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when name is missing on an item and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ description: 'No name here' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.name:/);
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when name is an empty string and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: '' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.name:/);
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  // A separate branch from the empty-string case above: a minimum length
  // counts characters, so a whitespace-only value satisfies it and would
  // otherwise create an organisation whose name renders as blank everywhere.
  it('returns 400 when name is only whitespace and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: '   ' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('0.name: must not be only whitespace');
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when description is only whitespace and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: 'Acme', description: '  ' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('0.description: must not be only whitespace');
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when name is mistyped and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: 42 }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.name:/);
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when description is an empty string and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: 'Acme Corp', description: '' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.description:/);
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when description is an explicit null and does not call the repository', async () => {
    // Create has no null-to-clear contract for any field (there is nothing
    // to clear on a brand-new record); null is rejected the same as any
    // other mistyped value, not silently accepted as omission.
    const req = createFakeRequest({ body: [{ name: 'Acme Corp', description: null }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.description:/);
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when primaryIdentifierId is mistyped and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: 'Acme Corp', primaryIdentifierId: 42 }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.primaryIdentifierId:/);
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when primaryIdentifierId is an explicit null and does not call the repository', async () => {
    // Create has nothing to clear, so unlike PATCH, null is not a supported
    // way to say "no primary identifier"; omitting the field is.
    const req = createFakeRequest({ body: [{ name: 'Acme Corp', primaryIdentifierId: null }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.primaryIdentifierId:/);
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when secondaryIdentifierIds is not an array and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: 'Acme Corp', secondaryIdentifierIds: 'ident-1' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.secondaryIdentifierIds:/);
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when a secondaryIdentifierIds entry is an empty string and does not call the repository', async () => {
    const req = createFakeRequest({ body: [{ name: 'Acme Corp', secondaryIdentifierIds: [''] }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^0\.secondaryIdentifierIds\.0:/);
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 when secondaryIdentifierIds contains a duplicate in-request identifier and does not call the repository', async () => {
    // organisationSecondaryIdentifier.createMany runs without skipDuplicates,
    // so an in-request duplicate hits the composite primary key and surfaces
    // as the concurrent-link 409, a misleading response for what is a client
    // typo; catching it here (shape-level, boundary self-consistency) keeps
    // it a 400 naming the field instead.
    const req = createFakeRequest({
      body: [{ name: 'Acme Corp', secondaryIdentifierIds: ['ident-1', 'ident-1'] }],
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('0.secondaryIdentifierIds: must not contain duplicate identifiers');
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body and does not call the repository', async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
    expect(mockCreateOrganisations).not.toHaveBeenCalled();
  });

  it('returns 404 when repository throws NotFoundError', async () => {
    mockCreateOrganisations.mockRejectedValue(new NotFoundError('Tenant not found'));

    const req = createFakeRequest({ body: [{ name: 'Acme Corp' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Tenant not found');
  });

  it('returns 409 when repository reports a primary identifier conflict', async () => {
    mockCreateOrganisations.mockRejectedValue(
      new ConflictError('An identifier in this request is already the primary identifier of another organisation'),
    );

    const req = createFakeRequest({ body: [{ name: 'Acme Corp', primaryIdentifierId: 'ident-1' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain(
      'An identifier in this request is already the primary identifier of another organisation',
    );
  });

  it('returns 500 on unexpected error', async () => {
    mockCreateOrganisations.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ body: [{ name: 'Acme Corp' }] });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });

  describe('request body size limit', () => {
    const ORIGINAL = process.env.MAX_REQUEST_BODY_BYTES;

    beforeEach(() => {
      process.env.MAX_REQUEST_BODY_BYTES = '1024';
    });

    afterEach(() => {
      if (ORIGINAL === undefined) {
        delete process.env.MAX_REQUEST_BODY_BYTES;
      } else {
        process.env.MAX_REQUEST_BODY_BYTES = ORIGINAL;
      }
    });

    function oversizeRequest(): Request {
      return {
        method: 'POST',
        url: 'http://localhost/api/v1/organisations',
        headers: new Headers({ 'Content-Type': 'application/json', 'Content-Length': '2048' }),
        body: {
          getReader() {
            throw new Error('body must not be read once Content-Length exceeds the cap');
          },
        },
        json: async () => {
          throw new Error('json() must not run on a capped request');
        },
      } as unknown as Request;
    }

    it('returns 413 REQUEST_BODY_TOO_LARGE when the body exceeds the cap, before the repository is called', async () => {
      const res = await POST(oversizeRequest(), AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
      const json = await res.json();

      expect(res.status).toBe(413);
      expect(json).toEqual({
        error: 'The request body exceeds the maximum of 1024 bytes.',
        code: 'REQUEST_BODY_TOO_LARGE',
      });
      expect(mockCreateOrganisations).not.toHaveBeenCalled();
    });
  });
});

describe('GET /api/v1/organisations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists organisations for the tenant with pagination', async () => {
    const organisations = [{ id: 'org-a', name: 'Acme Corp', secondaryIdentifierIds: [] }];
    mockListOrganisations.mockResolvedValue({ data: organisations, total: 1 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/organisations' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(organisations);
    expect(json.pagination).toEqual({
      total: 1,
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
      hasMore: false,
    });
  });

  it('passes search and pagination params to listOrganisations', async () => {
    mockListOrganisations.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/organisations?search=acme&limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListOrganisations).toHaveBeenCalledWith('org-1', {
      search: 'acme',
      limit: 10,
      offset: 5,
    });
  });

  it('accepts an empty search filter unchanged', async () => {
    mockListOrganisations.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/organisations?search=',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(200);
    expect(mockListOrganisations).toHaveBeenCalledWith('org-1', {
      search: '',
      limit: undefined,
      offset: undefined,
    });
  });

  it('handles no query parameters', async () => {
    mockListOrganisations.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/organisations' });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListOrganisations).toHaveBeenCalledWith('org-1', {
      search: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('returns 400 for non-numeric limit and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/organisations?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit: must be a positive integer');
    expect(mockListOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 for negative offset and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/organisations?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset: must be a non-negative integer');
    expect(mockListOrganisations).not.toHaveBeenCalled();
  });

  it('rejects a limit above the maximum with a 400 and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: `http://localhost/api/v1/organisations?limit=${MAX_PAGE_LIMIT + 1}`,
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^limit:/);
    expect(mockListOrganisations).not.toHaveBeenCalled();
  });

  it('returns 400 for a repeated query key and does not query', async () => {
    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/organisations?limit=10&limit=20',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('repeated query parameter');
    expect(mockListOrganisations).not.toHaveBeenCalled();
  });

  it('returns 500 when listOrganisations throws', async () => {
    mockListOrganisations.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'GET', url: 'http://localhost/api/v1/organisations' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });

  it('returns correct pagination when limit and offset are provided', async () => {
    const organisations = [{ id: 'org-a', name: 'Acme Corp', secondaryIdentifierIds: [] }];
    mockListOrganisations.mockResolvedValue({ data: organisations, total: 25 });

    const req = createFakeRequest({
      method: 'GET',
      url: 'http://localhost/api/v1/organisations?limit=10&offset=5',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(organisations);
    expect(json.pagination).toEqual({
      total: 25,
      limit: 10,
      offset: 5,
      hasMore: true,
    });
  });
});
