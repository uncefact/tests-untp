// Provide a minimal Response constructor for the DELETE handler
// (jsdom does not expose the Fetch API's Response)
global.Response = class Response {
  status: number;
  body: unknown;
  constructor(body: unknown, init?: { status?: number }) {
    this.body = body;
    this.status = init?.status ?? 200;
  }
} as unknown as typeof globalThis.Response;

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

const mockGetDidById = jest.fn();
const mockUpdateDid = jest.fn();
const mockDeleteDid = jest.fn();
const mockResolveDidService = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getDidById: (id: string, orgId: string) => mockGetDidById(id, orgId),
  updateDid: (id: string, orgId: string, input: unknown) => mockUpdateDid(id, orgId, input),
  deleteDid: (id: string, orgId: string) => mockDeleteDid(id, orgId),
}));

jest.mock('@/lib/services/resolve-did-service', () => ({
  resolveDidService: (...args: unknown[]) => mockResolveDidService(...args),
}));

import { NotFoundError } from '@/lib/api/errors';
import { GET, PATCH, DELETE } from './route';

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
    expect(json).toEqual(did);
  });

  it('returns 404 when DID not found', async () => {
    mockGetDidById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/dids/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates name and description', async () => {
    const updated = { id: 'did-1', name: 'New Name', description: 'New desc' };
    mockUpdateDid.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'New Name', description: 'New desc' } });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.name).toBe('New Name');
  });

  it('returns 400 when no fields provided', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
  });

  it('returns 404 when DID not found or access denied', async () => {
    mockUpdateDid.mockRejectedValue(new NotFoundError('DID not found or access denied'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'New Name' } });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/dids/:id', () => {
  const mockDidService = { delete: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveDidService.mockResolvedValue({ service: mockDidService, instanceId: 'inst-1' });
  });

  it('returns 204 with no body on success', async () => {
    mockGetDidById.mockResolvedValue({
      id: 'did-1',
      did: 'did:web:example.com',
      serviceInstanceId: 'inst-1',
    });
    mockDidService.delete.mockResolvedValue(undefined);
    mockDeleteDid.mockResolvedValue(undefined);

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('did-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
  });

  it('returns 404 when DID not found', async () => {
    mockGetDidById.mockResolvedValue(null);

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(404);
  });

  it('calls service.delete for managed DIDs with a serviceInstanceId', async () => {
    mockGetDidById.mockResolvedValue({
      id: 'did-1',
      did: 'did:web:example.com',
      serviceInstanceId: 'inst-1',
    });
    mockDidService.delete.mockResolvedValue(undefined);
    mockDeleteDid.mockResolvedValue(undefined);

    const req = createFakeRequest({ method: 'DELETE' });
    await DELETE(req, createContext('did-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(mockResolveDidService).toHaveBeenCalledWith('org-1', 'inst-1');
    expect(mockDidService.delete).toHaveBeenCalledWith('did:web:example.com');
    expect(mockDeleteDid).toHaveBeenCalledWith('did-1', 'org-1');
  });

  it('does not call service.delete for self-managed DIDs without a serviceInstanceId', async () => {
    mockGetDidById.mockResolvedValue({
      id: 'did-1',
      did: 'did:web:example.com',
      serviceInstanceId: null,
    });
    mockDeleteDid.mockResolvedValue(undefined);

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('did-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect(mockResolveDidService).not.toHaveBeenCalled();
    expect(mockDidService.delete).not.toHaveBeenCalled();
    expect(mockDeleteDid).toHaveBeenCalledWith('did-1', 'org-1');
  });

  it('returns 400 when trying to delete a default DID', async () => {
    mockGetDidById.mockResolvedValue({
      id: 'did-1',
      did: 'did:web:example.com',
      serviceInstanceId: 'inst-1',
      isDefault: true,
    });

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('did-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await (res as { status: number; json: () => Promise<{ error: string }> }).json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Cannot delete system default DID');
    expect(mockDeleteDid).not.toHaveBeenCalled();
    expect(mockDidService.delete).not.toHaveBeenCalled();
  });

  it('returns 204 even when upstream service.delete() throws', async () => {
    mockGetDidById.mockResolvedValue({
      id: 'did-1',
      did: 'did:web:example.com',
      serviceInstanceId: 'inst-1',
    });
    mockDeleteDid.mockResolvedValue(undefined);
    mockDidService.delete.mockRejectedValue(new Error('Upstream provider unreachable'));

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('did-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect(mockDeleteDid).toHaveBeenCalledWith('did-1', 'org-1');
    expect(mockDidService.delete).toHaveBeenCalledWith('did:web:example.com');
  });

  it('returns 204 even when resolveDidService throws', async () => {
    mockGetDidById.mockResolvedValue({
      id: 'did-1',
      did: 'did:web:example.com',
      serviceInstanceId: 'inst-1',
    });
    mockDeleteDid.mockResolvedValue(undefined);
    mockResolveDidService.mockRejectedValue(new Error('Service registry unavailable'));

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('did-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect(mockDeleteDid).toHaveBeenCalledWith('did-1', 'org-1');
    expect(mockResolveDidService).toHaveBeenCalledWith('org-1', 'inst-1');
    expect(mockDidService.delete).not.toHaveBeenCalled();
  });
});
