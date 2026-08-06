jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withTenantAuth to skip auth while delegating error mapping to the real
// handleRouteError, so this suite is checked against production's actual
// status/code mapping rather than a hand-rolled duplicate that can drift.
jest.mock('@/lib/api/with-tenant-auth', () => {
  const { handleRouteError } = jest.requireActual('@/lib/api/handle-route-error');
  return {
    withTenantAuth:
      (handler: (req: unknown, ctx: unknown) => Promise<unknown>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
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

// The request schema (request-schemas/did.ts) imports the full set of DID
// enums from '@uncefact/untp-ri-services' (CREATABLE_DID_TYPES, DidMethod,
// DidStatus, DidType), so this module must not be mocked with a partial
// factory (ADR-037): a factory providing only DidMethod would leave the
// schema's z.nativeEnum/z.enum calls undefined at import time.
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
    mockGetInstanceByResolution.mockResolvedValue({ id: 'inst-1', tenantId: 'tenant-1' });
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

    // Verifies the tenant-scoped existence check runs before the write
    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('tenant-1', 'VC', 'inst-1');

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

  it('returns 400 when serviceInstanceId is missing, and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^serviceInstanceId:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when serviceInstanceId is an empty string, and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: '',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^serviceInstanceId:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when serviceInstanceId is an explicit null (omission, not null, is required), and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: null,
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^serviceInstanceId:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when did is a number, and does not call the repository', async () => {
    const req = createFakeRequest({ did: 1, method: 'DID_WEB', keyId: 'key-1', serviceInstanceId: 'inst-1' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^did:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 with code DID_PARSE_FAILED when did is not a well-formed DID, and does not call the repository', async () => {
    const req = createFakeRequest({ did: 'not-a-did', method: 'DID_WEB', keyId: 'key-1', serviceInstanceId: 'inst-1' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('DID_PARSE_FAILED');
    expect(mockGetInstanceByResolution).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 with code DID_METHOD_NOT_SUPPORTED when the did names an unrecognised method, and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:key:z6Mk',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('DID_METHOD_NOT_SUPPORTED');
    expect(mockGetInstanceByResolution).not.toHaveBeenCalled();
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when keyId is a boolean, and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: true,
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^keyId:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when serviceInstanceId is a number, and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 5,
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^serviceInstanceId:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 404 when serviceInstanceId does not resolve for this tenant, and does not call the repository', async () => {
    mockGetInstanceByResolution.mockResolvedValue(null);

    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'nonexistent',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('nonexistent');
    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('tenant-1', 'VC', 'nonexistent');
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 404 when serviceInstanceId belongs to a different tenant, checked against the authenticated tenant not a caller-supplied one', async () => {
    // getInstanceByResolution itself scopes the lookup to the tenantId it is called with (see
    // service-instance.repository.test.ts's "returns null for explicit ID not accessible"), so
    // resolving null here for tenant-2 stands in for "the instance exists but belongs to
    // tenant-1". This asserts the route passes the AUTHENTICATED tenantId from context, since a
    // route that read a tenantId from the request body instead would defeat the check entirely.
    mockGetInstanceByResolution.mockResolvedValue(null);

    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'inst-owned-by-tenant-1',
    });

    const res = await POST(req, createContext({ tenantId: 'tenant-2' }));

    expect(res.status).toBe(404);
    expect(mockGetInstanceByResolution).toHaveBeenCalledWith('tenant-2', 'VC', 'inst-owned-by-tenant-1');
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when serviceInstanceId is deleted in the race window between resolution and the write (P2003 backstop)', async () => {
    // getInstanceByResolution finds the instance (it existed at check time), but createDid
    // still rejects via the repository's P2003 mapping, simulating deletion in the narrow
    // window between the check and the write. The 404 path above covers the common case;
    // this is the rare backstop the repository mapping exists for.
    const { ValidationError } = jest.requireActual('@/lib/api/validation');
    mockCreateDid.mockRejectedValueOnce(new ValidationError('serviceInstanceId: Service instance not found'));

    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('serviceInstanceId: Service instance not found');
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

  it('returns 400 when did is missing, and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'DID_WEB', keyId: 'key-1', serviceInstanceId: 'inst-1' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^did:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when keyId is missing, and does not call the repository', async () => {
    const req = createFakeRequest({ did: 'did:web:example.com', method: 'DID_WEB', serviceInstanceId: 'inst-1' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^keyId:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when method is missing, and does not call the repository', async () => {
    const req = createFakeRequest({ did: 'did:web:example.com', keyId: 'key-1', serviceInstanceId: 'inst-1' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^method:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid method, and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      keyId: 'key-1',
      method: 'INVALID',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^method:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for method DID_WEB_VH (planned but not yet implemented), and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:webvh:example.com',
      keyId: 'key-1',
      method: 'DID_WEB_VH',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^method:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body, and does not call the repository', async () => {
    const req = {
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Request;

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid JSON body');
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for a literal null body, and does not call the repository', async () => {
    const req = createFakeRequest(null);

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^body:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
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
    // Pins handleRouteError's final fallthrough, which echoes a non-database
    // error's own message. A toBeDefined() check here would pass just as
    // happily if the response carried the wrong error entirely.
    expect(body.error).toBe('Database connection lost');
  });

  it('returns 400 when did is an empty string, and does not call the repository', async () => {
    const req = createFakeRequest({ did: '', method: 'DID_WEB', keyId: 'key-1', serviceInstanceId: 'inst-1' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^did:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when keyId is an empty string, and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: '',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^keyId:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when method is an empty string, and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      keyId: 'key-1',
      method: '',
      serviceInstanceId: 'inst-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^method:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when name is an empty string (mistyped optional field), and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      keyId: 'key-1',
      method: 'DID_WEB',
      serviceInstanceId: 'inst-1',
      name: '',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^name:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when description is an empty string (mistyped optional field), and does not call the repository', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      keyId: 'key-1',
      method: 'DID_WEB',
      serviceInstanceId: 'inst-1',
      description: '',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/^description:/);
    expect(mockCreateDid).not.toHaveBeenCalled();
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
