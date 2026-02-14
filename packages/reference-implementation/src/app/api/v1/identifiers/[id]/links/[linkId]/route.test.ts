jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/api/with-tenant-auth', () => {
  const { NotFoundError, errorMessage, ServiceRegistryError } = jest.requireActual('@/lib/api/errors');
  const { ValidationError } = jest.requireActual('@/lib/api/validation');
  const { ServiceError } = jest.requireActual('@uncefact/untp-ri-services');

  function jsonResponse(body: unknown, init?: { status?: number }) {
    return { status: init?.status ?? 200, json: async () => body };
  }

  return {
    withTenantAuth: (handler: Function) => async (req: any, ctx: any) => {
      try {
        return await handler(req, ctx);
      } catch (e: unknown) {
        if (e instanceof ValidationError) {
          return jsonResponse({ ok: false, error: (e as Error).message }, { status: 400 });
        }
        if (e instanceof NotFoundError) {
          return jsonResponse({ ok: false, error: (e as Error).message }, { status: 404 });
        }
        if (e instanceof ServiceRegistryError) {
          return jsonResponse({ ok: false, error: (e as Error).message }, { status: 500 });
        }
        if (e instanceof ServiceError) {
          return jsonResponse(
            { ok: false, error: (e as Error).message, code: (e as any).code },
            { status: (e as any).statusCode },
          );
        }
        return jsonResponse({ ok: false, error: errorMessage(e) }, { status: 500 });
      }
    },
  };
});

const mockGetIdentifierById = jest.fn();
const mockGetLinkRegistrationByIdrLinkId = jest.fn();
const mockUpdateLinkRegistration = jest.fn();
const mockDeleteLinkRegistration = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  getIdentifierById: (...args: unknown[]) => mockGetIdentifierById(...args),
  getLinkRegistrationByIdrLinkId: (...args: unknown[]) => mockGetLinkRegistrationByIdrLinkId(...args),
  updateLinkRegistration: (...args: unknown[]) => mockUpdateLinkRegistration(...args),
  deleteLinkRegistration: (...args: unknown[]) => mockDeleteLinkRegistration(...args),
}));

const mockResolveIdrService = jest.fn();
jest.mock('@/lib/services/resolve-idr-service', () => ({
  resolveIdrService: (...args: unknown[]) => mockResolveIdrService(...args),
}));

import { IdrLinkNotFoundError, IdrLinkFetchError } from '@uncefact/untp-ri-services';
import { GET, PATCH, DELETE } from './route';

// -- Helpers -------------------------------------------------------------------

function createFakeRequest(body?: unknown) {
  return {
    json:
      body !== undefined
        ? async () => body
        : async () => {
            throw new Error('no body');
          },
    url: 'http://localhost/api/v1/identifiers/ident-1/links/idr-link-1',
  } as any;
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    params: Promise.resolve({ id: 'ident-1', linkId: 'idr-link-1' }),
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
  },
};

const MOCK_LOCAL_RECORD = {
  id: 'lr-1',
  idrLinkId: 'idr-link-1',
  identifierId: 'ident-1',
  tenantId: 'tenant-1',
  linkType: 'untp:dpp',
  targetUrl: 'https://example.com/cred.json',
  mimeType: 'application/json',
  resolverUri: 'https://resolver.example.com/01/09520123456788',
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

describe('GET /api/v1/identifiers/[id]/links/[linkId]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);
    mockGetLinkRegistrationByIdrLinkId.mockResolvedValue(MOCK_LOCAL_RECORD);
    mockResolveIdrService.mockResolvedValue({ service: MOCK_IDR_SERVICE, instanceId: 'idr-1' });
    MOCK_IDR_SERVICE.getLinkById.mockResolvedValue({
      href: 'https://example.com/cred.json',
      rel: 'untp:dpp',
      type: 'application/json',
    });
  });

  it('returns link details with local record', async () => {
    const req = createFakeRequest();
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.link).toBeDefined();
    expect(body.localRecord).toBeDefined();
    expect(body.desync).toBeUndefined();
  });

  it('returns 200 with desync flag when upstream link is missing', async () => {
    MOCK_IDR_SERVICE.getLinkById.mockRejectedValue(new IdrLinkNotFoundError('idr-link-1', 404));

    const req = createFakeRequest();
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.link).toBeNull();
    expect(body.localRecord).toBeDefined();
    expect(body.desync).toBe(true);
    expect(body.warning).toContain('no longer present on the upstream IDR');
  });

  it('returns 404 when identifier not found', async () => {
    mockGetIdentifierById.mockResolvedValue(null);

    const req = createFakeRequest();
    const res = await GET(req, createContext());

    expect(res.status).toBe(404);
    expect((await res.json()).ok).toBe(false);
  });

  it('returns 404 when link registration not found', async () => {
    mockGetLinkRegistrationByIdrLinkId.mockResolvedValue(null);

    const req = createFakeRequest();
    const res = await GET(req, createContext());

    expect(res.status).toBe(404);
    expect((await res.json()).ok).toBe(false);
  });

  it('returns IDR service error with proper status when getLinkById fails', async () => {
    MOCK_IDR_SERVICE.getLinkById.mockRejectedValue(new IdrLinkFetchError('idr-link-1', 500, 'upstream timeout'));

    const req = createFakeRequest();
    const res = await GET(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('IDR_LINK_FETCH_FAILED');
  });
});

describe('PATCH /api/v1/identifiers/[id]/links/[linkId]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);
    mockGetLinkRegistrationByIdrLinkId.mockResolvedValue(MOCK_LOCAL_RECORD);
    mockResolveIdrService.mockResolvedValue({ service: MOCK_IDR_SERVICE, instanceId: 'idr-1' });
    MOCK_IDR_SERVICE.updateLink.mockResolvedValue({
      href: 'https://updated.com/cred.json',
      rel: 'untp:dpp',
      type: 'application/json',
    });
  });

  it('updates a link and returns 200', async () => {
    const req = createFakeRequest({ href: 'https://updated.com/cred.json' });
    const res = await PATCH(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(MOCK_IDR_SERVICE.updateLink).toHaveBeenCalledWith('idr-link-1', {
      href: 'https://updated.com/cred.json',
    });
    expect(mockUpdateLinkRegistration).toHaveBeenCalledWith('idr-link-1', 'ident-1', 'tenant-1', {
      linkType: 'untp:dpp',
      targetUrl: 'https://updated.com/cred.json',
      mimeType: 'application/json',
    });
  });

  it('returns 409 with desync flag when upstream link is missing', async () => {
    MOCK_IDR_SERVICE.updateLink.mockRejectedValue(new IdrLinkNotFoundError('idr-link-1', 404));

    const req = createFakeRequest({ href: 'https://updated.com/cred.json' });
    const res = await PATCH(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.desync).toBe(true);
    expect(body.error).toContain('no longer exists on the upstream IDR');
  });

  it('returns 404 when link registration not found', async () => {
    mockGetLinkRegistrationByIdrLinkId.mockResolvedValue(null);

    const req = createFakeRequest({ href: 'https://updated.com' });
    const res = await PATCH(req, createContext());

    expect(res.status).toBe(404);
    expect((await res.json()).ok).toBe(false);
  });
});

describe('DELETE /api/v1/identifiers/[id]/links/[linkId]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIdentifierById.mockResolvedValue(MOCK_IDENTIFIER);
    mockGetLinkRegistrationByIdrLinkId.mockResolvedValue(MOCK_LOCAL_RECORD);
    mockResolveIdrService.mockResolvedValue({ service: MOCK_IDR_SERVICE, instanceId: 'idr-1' });
    MOCK_IDR_SERVICE.deleteLink.mockResolvedValue(undefined);
    mockDeleteLinkRegistration.mockResolvedValue(MOCK_LOCAL_RECORD);
  });

  it('deletes link from IDR and local record, returns 200', async () => {
    const req = createFakeRequest();
    const res = await DELETE(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(true);
    expect(body.desync).toBeUndefined();
    expect(MOCK_IDR_SERVICE.deleteLink).toHaveBeenCalledWith('idr-link-1');
    expect(mockDeleteLinkRegistration).toHaveBeenCalledWith('idr-link-1', 'ident-1', 'tenant-1');
  });

  it('still cleans up local record when upstream link is already gone', async () => {
    MOCK_IDR_SERVICE.deleteLink.mockRejectedValue(new IdrLinkNotFoundError('idr-link-1', 404));

    const req = createFakeRequest();
    const res = await DELETE(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(true);
    expect(body.desync).toBe(true);
    expect(body.warning).toContain('already absent from the upstream IDR');
    expect(mockDeleteLinkRegistration).toHaveBeenCalledWith('idr-link-1', 'ident-1', 'tenant-1');
  });

  it('returns 404 when link registration not found', async () => {
    mockGetLinkRegistrationByIdrLinkId.mockResolvedValue(null);

    const req = createFakeRequest();
    const res = await DELETE(req, createContext());

    expect(res.status).toBe(404);
    expect((await res.json()).ok).toBe(false);
  });
});
