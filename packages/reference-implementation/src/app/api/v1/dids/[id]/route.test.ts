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

const mockGetDidById = jest.fn();
const mockUpdateDid = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getDidById: (id: string, orgId: string) => mockGetDidById(id, orgId),
  updateDid: (id: string, orgId: string, input: unknown) => mockUpdateDid(id, orgId, input),
}));

import { NotFoundError } from '@/lib/api/errors';
import { GET, PUT } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/dids/did-1' } = options;
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

function createContext(id: string) {
  return { tenantId: 'org-1', params: Promise.resolve({ id }) };
}

describe('GET /api/v1/dids/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the DID record', async () => {
    const did = { id: 'did-1', did: 'did:web:example.com', type: 'MANAGED' };
    mockGetDidById.mockResolvedValue(did);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('did-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.did).toEqual(did);
  });

  it('returns 404 when DID not found', async () => {
    mockGetDidById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/dids/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates name and description', async () => {
    const updated = { id: 'did-1', name: 'New Name', description: 'New desc' };
    mockUpdateDid.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PUT', body: { name: 'New Name', description: 'New desc' } });
    const res = await PUT(req, createContext('did-1') as unknown as Parameters<typeof PUT>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.did.name).toBe('New Name');
  });

  it('returns 400 when no fields provided', async () => {
    const req = createFakeRequest({ method: 'PUT', body: {} });
    const res = await PUT(req, createContext('did-1') as unknown as Parameters<typeof PUT>[1]);

    expect(res.status).toBe(400);
  });

  it('returns 404 when DID not found or access denied', async () => {
    mockUpdateDid.mockRejectedValue(new NotFoundError('DID not found or access denied'));

    const req = createFakeRequest({ method: 'PUT', body: { name: 'New Name' } });
    const res = await PUT(req, createContext('did-1') as unknown as Parameters<typeof PUT>[1]);

    expect(res.status).toBe(404);
  });
});
