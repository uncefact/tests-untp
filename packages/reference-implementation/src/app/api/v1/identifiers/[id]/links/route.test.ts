jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/api/with-tenant-auth', () => ({
  withTenantAuth: (handler: Function) => handler,
}));

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

import { POST, GET } from './route';

// -- Helpers -------------------------------------------------------------------

function createFakeRequest(body: unknown) {
  return { json: async () => body, url: 'http://localhost/api/v1/identifiers/ident-1/links' } as any;
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    params: Promise.resolve({ id: 'ident-1' }),
    ...overrides,
  } as any;
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
    expect(body.ok).toBe(true);
    expect(body.registration.resolverUri).toBe('https://resolver.example.com/01/09520123456788');
    expect(mockCreateManyLinkRegistrations).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for missing links', async () => {
    const req = createFakeRequest({});

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it('returns 400 for empty links array', async () => {
    const req = createFakeRequest({ links: [] });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it('returns 404 when identifier not found', async () => {
    mockGetIdentifierById.mockResolvedValue(null);

    const req = createFakeRequest({
      links: [{ href: 'https://example.com', rel: 'untp:dpp', type: 'application/json' }],
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      json: async () => {
        throw new Error('bad json');
      },
      url: 'http://localhost/test',
    } as any;

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid JSON body');
  });
});

describe('GET /api/v1/identifiers/[id]/links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns link registrations for an identifier', async () => {
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);
    mockListLinkRegistrations.mockResolvedValue([{ id: 'lr-1', idrLinkId: 'idr-link-1', linkType: 'untp:dpp' }]);

    const req = { url: 'http://localhost/test' } as any;
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.linkRegistrations).toHaveLength(1);
  });

  it('returns 404 when identifier not found', async () => {
    mockGetIdentifierById.mockResolvedValue(null);

    const req = { url: 'http://localhost/test' } as any;
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});
