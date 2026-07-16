// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withTenantAuth — skips auth but delegates error mapping to the real
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
import { ValidationError } from '@/lib/api/validation';
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
    expect(mockUpdateDid).toHaveBeenCalledWith('did-1', 'org-1', { name: 'New Name', description: 'New desc' });
  });

  it('returns 400 when no fields provided, and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one of name, description, or isDefault is required');
    expect(mockUpdateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when the body only has an unrecognised (typo) field name', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { neme: 'New Name' } });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one of name, description, or isDefault is required');
    expect(mockUpdateDid).not.toHaveBeenCalled();
  });

  it('returns 400 for a literal null body, and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: null });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^body:/);
    expect(mockUpdateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when name is an empty string, and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^name:/);
    expect(mockUpdateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when description is an empty string, and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { description: '' } });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^description:/);
    expect(mockUpdateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when isDefault is not a boolean (mistyped optional field), and does not call the repository', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { isDefault: 'yes' } });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^isDefault:/);
    expect(mockUpdateDid).not.toHaveBeenCalled();
  });

  it('returns 400 when isDefault is an explicit null (omission, not null, leaves it unchanged)', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { isDefault: null } });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^isDefault:/);
    expect(mockUpdateDid).not.toHaveBeenCalled();
  });

  it('returns 404 when DID not found or access denied', async () => {
    mockUpdateDid.mockRejectedValue(new NotFoundError('DID not found or access denied'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'New Name' } });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(404);
  });

  it('sets isDefault on a managed DID', async () => {
    const updated = { id: 'did-1', type: 'MANAGED', isDefault: true };
    mockUpdateDid.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { isDefault: true } });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(updated);
    expect(mockUpdateDid).toHaveBeenCalledWith('did-1', 'org-1', { isDefault: true });
  });

  it('returns 400 when setting isDefault on a DEFAULT type DID', async () => {
    mockUpdateDid.mockRejectedValue(new ValidationError('isDefault: Cannot modify default status of system DIDs'));

    const req = createFakeRequest({ method: 'PATCH', body: { isDefault: true } });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('isDefault: Cannot modify default status of system DIDs');
  });

  it('accepts isDefault with name together', async () => {
    const updated = { id: 'did-1', type: 'MANAGED', name: 'My DID', isDefault: true };
    mockUpdateDid.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'My DID', isDefault: true } });
    const res = await PATCH(req, createContext('did-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(updated);
    expect(mockUpdateDid).toHaveBeenCalledWith('did-1', 'org-1', { name: 'My DID', isDefault: true });
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

  it('returns 400 when trying to delete a DID flagged isDefault', async () => {
    mockGetDidById.mockResolvedValue({
      id: 'did-1',
      did: 'did:web:example.com',
      serviceInstanceId: 'inst-1',
      isDefault: true,
    });

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('did-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(
      'Cannot delete a DID currently flagged isDefault - clear the flag via the update endpoint first',
    );
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
