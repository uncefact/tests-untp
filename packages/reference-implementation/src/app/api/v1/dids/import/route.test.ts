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
        return jsonResponse({ ok: false, error: errorMessage(e) }, { status: 500 });
      }
    },
  };
});

const mockCreateDid = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  createDid: (...args: unknown[]) => mockCreateDid(...args),
}));

jest.mock('@uncefact/untp-ri-services', () => ({
  DidMethod: { DID_WEB: 'DID_WEB', DID_WEB_VH: 'DID_WEB_VH' },
}));

import { POST } from './route';

// -- Helpers ------------------------------------------------------------------

function createFakeRequest(body: unknown) {
  return { json: async () => body } as any;
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    params: Promise.resolve({}),
    ...overrides,
  } as any;
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
  serviceInstanceId: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// -- Tests --------------------------------------------------------------------

describe('POST /api/v1/dids/import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateDid.mockResolvedValue(MOCK_DID_RECORD);
  });

  it('imports a DID and returns 201', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      name: 'My Imported DID',
      description: 'An externally managed DID',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.did).toEqual(MOCK_DID_RECORD);

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
      serviceInstanceId: undefined,
    });
  });

  it('uses the DID string as the name when name is not provided', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
    });

    await POST(req, createContext());

    expect(mockCreateDid).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'did:web:example.com',
      }),
    );
  });

  it('passes serviceInstanceId when provided', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      serviceInstanceId: 'inst-1',
    });

    await POST(req, createContext());

    expect(mockCreateDid).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceInstanceId: 'inst-1',
      }),
    );
  });

  it('sets status to UNVERIFIED', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
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
    expect(body.ok).toBe(false);
    expect(body.error).toContain('did is required');
  });

  it('returns 400 when keyId is missing', async () => {
    const req = createFakeRequest({ did: 'did:web:example.com', method: 'DID_WEB' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('keyId is required');
  });

  it('returns 400 when method is missing', async () => {
    const req = createFakeRequest({ did: 'did:web:example.com', keyId: 'key-1' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('method is required');
  });

  it('returns 400 for invalid method', async () => {
    const req = createFakeRequest({ did: 'did:web:example.com', keyId: 'key-1', method: 'INVALID' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('method must be one of');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      json: async () => {
        throw new Error('bad json');
      },
    } as any;

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
    });

    await POST(req, createContext());

    // Only createDid should be called -- no service resolution or adapter calls
    expect(mockCreateDid).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when createDid throws a unique constraint error (duplicate DID)', async () => {
    mockCreateDid.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed on the fields: (`did`)'), {
        code: 'P2002',
      }),
    );

    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });

  it('returns 500 when createDid rejects with a generic error', async () => {
    mockCreateDid.mockRejectedValueOnce(new Error('Database connection lost'));

    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });

  it('returns 400 when did is an empty string', async () => {
    const req = createFakeRequest({ did: '', method: 'DID_WEB', keyId: 'key-1' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('did is required');
  });

  it('returns 400 when keyId is an empty string', async () => {
    const req = createFakeRequest({ did: 'did:web:example.com', method: 'DID_WEB', keyId: '' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('keyId is required');
  });

  it('returns 400 when method is an empty string', async () => {
    const req = createFakeRequest({ did: 'did:web:example.com', keyId: 'key-1', method: '' });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('method');
  });

  it('succeeds when description is omitted', async () => {
    const req = createFakeRequest({
      did: 'did:web:example.com',
      method: 'DID_WEB',
      keyId: 'key-1',
      name: 'No Description DID',
    });

    const res = await POST(req, createContext());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);

    expect(mockCreateDid).toHaveBeenCalledWith(
      expect.objectContaining({
        description: undefined,
      }),
    );
  });
});
