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

const mockCreateDid = jest.fn();
const mockGetInstanceByResolution = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  createDid: (...args: unknown[]) => mockCreateDid(...args),
  getInstanceByResolution: (...args: unknown[]) => mockGetInstanceByResolution(...args),
}));

jest.mock('@uncefact/untp-ri-services', () => {
  const { ServiceError } = jest.requireActual('@uncefact/untp-ri-services');
  return {
    ServiceError,
    DidMethod: { DID_WEB: 'DID_WEB', DID_WEB_VH: 'DID_WEB_VH' },
    DidType: { MANAGED: 'MANAGED', SELF_MANAGED: 'SELF_MANAGED' },
    CREATABLE_DID_TYPES: ['MANAGED', 'SELF_MANAGED'],
    ServiceType: { IDR: 'IDR', STORAGE: 'STORAGE', VC: 'VC' },
  };
});

import { POST } from './route';

// -- Helpers ------------------------------------------------------------------

function createFakeRequest(body: unknown) {
  return { json: async () => body } as unknown as Request;
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    params: Promise.resolve({}),
    ...overrides,
  } as unknown as Parameters<typeof POST>[1];
}

const MOCK_DID_RECORD = {
  id: 'did-1',
  tenantId: 'tenant-1',
  did: 'did:web:example.com',
  type: 'SELF_MANAGED',
  method: 'DID_WEB',
  name: 'My Imported DID',
  description: 'An externally managed DID',
  keyId: 'key-1',
  status: 'UNVERIFIED',
  isDefault: false,
  serviceInstanceId: 'inst-1',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// -- Tests --------------------------------------------------------------------

describe('POST /api/v1/dids/import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateDid.mockResolvedValue(MOCK_DID_RECORD);
    mockGetInstanceByResolution.mockResolvedValue({ id: 'inst-1', serviceType: 'VC' });
  });

  it('imports a DID and returns 201', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      name: 'My Imported DID',
      description: 'An externally managed DID',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual(MOCK_DID_RECORD);

    // Verify createDid was called with correct params -- NOT calling adapter
    expect(mockCreateDid).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      did: 'did:web:example.com',
      type: 'SELF_MANAGED',
      method: 'DID_WEB',
      keyId: 'key-1',
      name: 'My Imported DID',
      description: 'An externally managed DID',
      status: 'UNVERIFIED',
      serviceInstanceId: 'inst-1',
    });
  });

  it('uses the DID string as the name when name is not provided', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'inst-1',
    });

    await POST(req, createContext());

    expect(mockCreateDid).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'did:web:example.com',
      }),
    );
  });

  it('returns 400 when serviceInstanceId is missing', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('serviceInstanceId');
  });

  it('returns 400 when serviceInstanceId is an empty string', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: '',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('serviceInstanceId');
  });

  it('returns 404 when the service instance does not exist or belongs to another tenant', async () => {
    mockGetInstanceByResolution.mockResolvedValue(null);

    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'someone-elses-instance',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('Service instance not found');
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('scopes the service instance lookup to the tenant', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'inst-1',
    });

    await POST(req, createContext());

    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('tenant-1', 'VC', 'inst-1');
  });

  it('returns 400 for a JSON null body', async () => {
    const res = await POST(createFakeRequest(null), createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('body');
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('sets status to UNVERIFIED', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'inst-1',
    });

    await POST(req, createContext());

    expect(mockCreateDid).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'UNVERIFIED',
      }),
    );
  });

  it('sets type to SELF_MANAGED', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'inst-1',
    });

    await POST(req, createContext());

    expect(mockCreateDid).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SELF_MANAGED',
      }),
    );
  });

  it('returns 400 when did is missing', async () => {
    const req = createFakeRequest({ method: 'DID_WEB', keyId: 'key-1' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('did');
  });

  it('returns 400 when keyId is missing', async () => {
    const req = createFakeRequest({ did: 'did:web:example.com', method: 'DID_WEB' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('keyId');
  });

  it('returns 400 when method is missing', async () => {
    const req = createFakeRequest({ did: 'did:web:example.com', keyId: 'key-1', serviceInstanceId: 'inst-1' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('method');
  });

  it('returns 400 for invalid method', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      keyId: 'key-1',
      method: 'INVALID',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('method');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Request;

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid JSON body');
  });

  it('does NOT call any DID service adapter', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'inst-1',
    });

    await POST(req, createContext());

    // Only createDid should be called -- no service resolution or adapter calls
    expect(mockCreateDid).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when createDid rejects with the duplicate-DID conflict', async () => {
    const { ConflictError } = jest.requireActual('@/lib/api/errors');
    mockCreateDid.mockRejectedValueOnce(new ConflictError('A DID record with this DID already exists'));

    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('A DID record with this DID already exists');
  });

  it('returns 500 when createDid rejects with a generic error', async () => {
    mockCreateDid.mockRejectedValueOnce(new Error('Database connection lost'));

    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeDefined();
  });

  it('returns 400 when did is an empty string', async () => {
    const req = createFakeRequest({ did: '', method: 'DID_WEB', keyId: 'key-1' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('did');
  });

  it('returns 400 when keyId is an empty string', async () => {
    const req = createFakeRequest({ did: 'did:web:example.com', method: 'DID_WEB', keyId: '' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('keyId');
  });

  it('returns 400 when method is an empty string', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      keyId: 'key-1',
      method: '',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('method');
  });

  it('succeeds when description is omitted', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      name: 'No Description DID',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());

    expect(res.status).toBe(201);

    expect(mockCreateDid).toHaveBeenCalledWith(
      expect.objectContaining({
        description: undefined,
      }),
    );
  });
});
