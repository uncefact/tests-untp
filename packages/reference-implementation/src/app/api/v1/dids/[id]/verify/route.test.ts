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
            return jsonResponse({ ok: false, error: (e as Error).message }, { status: 400 });
          }
          if (e instanceof NotFoundError) {
            return jsonResponse({ ok: false, error: (e as Error).message }, { status: 404 });
          }
          if (e instanceof ServiceRegistryError) {
            return jsonResponse({ ok: false, error: (e as Error).message }, { status: 500 });
          }
          if (e instanceof ServiceError) {
            const serviceErr = e as Error & { code?: string; statusCode?: number };
            return jsonResponse(
              { ok: false, error: serviceErr.message, code: serviceErr.code },
              { status: serviceErr.statusCode },
            );
          }
          return jsonResponse({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
  };
});

const mockResolveDidService = jest.fn();
const mockGetDidById = jest.fn();
const mockUpdateDidStatus = jest.fn();

jest.mock('@uncefact/untp-ri-services', () => ({
  ...jest.requireActual('@uncefact/untp-ri-services'),
  DidStatus: {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    VERIFIED: 'VERIFIED',
    UNVERIFIED: 'UNVERIFIED',
  },
}));

jest.mock('@/lib/services/resolve-did-service', () => ({
  resolveDidService: (...args: unknown[]) => mockResolveDidService(...args),
}));

jest.mock('@/lib/prisma/repositories', () => ({
  getDidById: (id: string, orgId: string) => mockGetDidById(id, orgId),
  updateDidStatus: (id: string, orgId: string, status: string) => mockUpdateDidStatus(id, orgId, status),
}));

import { ServiceResolutionError } from '@/lib/api/errors';
import { POST } from './route';

function createContext(id: string) {
  return { tenantId: 'org-1', params: Promise.resolve({ id }) };
}

function createFakeRequest(): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/dids/did-1/verify',
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as Request;
}

describe('POST /api/v1/dids/:id/verify', () => {
  const mockDidService = {
    verify: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveDidService.mockResolvedValue({ service: mockDidService, instanceId: 'inst-1' });
  });

  it('verifies a DID and updates status to VERIFIED', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    const verification = {
      verified: true,
      checks: [{ name: 'resolve', passed: true }],
    };
    mockDidService.verify.mockResolvedValue(verification);
    mockUpdateDidStatus.mockResolvedValue({ id: 'did-1', status: 'VERIFIED' });

    const res = await POST(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.verification.verified).toBe(true);
    expect(json.did.status).toBe('VERIFIED');
    expect(mockUpdateDidStatus).toHaveBeenCalledWith('did-1', 'org-1', 'VERIFIED');
  });

  it('updates status to UNVERIFIED when verification fails', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    const verification = {
      verified: false,
      checks: [{ name: 'resolve', passed: false }],
      errors: [{ check: 'resolve', message: 'Resolution failed' }],
    };
    mockDidService.verify.mockResolvedValue(verification);
    mockUpdateDidStatus.mockResolvedValue({ id: 'did-1', status: 'UNVERIFIED' });

    const res = await POST(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(json.verification.verified).toBe(false);
    expect(mockUpdateDidStatus).toHaveBeenCalledWith('did-1', 'org-1', 'UNVERIFIED');
  });

  it('returns 404 when DID not found', async () => {
    mockGetDidById.mockResolvedValue(null);

    const res = await POST(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(404);
  });

  it('returns 500 when verification fails', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    mockDidService.verify.mockRejectedValue(new Error('Verification error'));

    const res = await POST(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(500);
  });

  it('calls didService.verify with the DID string', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    mockDidService.verify.mockResolvedValue({ verified: true, checks: [] });
    mockUpdateDidStatus.mockResolvedValue({ id: 'did-1', status: 'VERIFIED' });

    await POST(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof POST>[1]);

    expect(mockDidService.verify).toHaveBeenCalledWith('did:web:example.com');
  });

  it('resolves the DID service with the stored serviceInstanceId', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com', serviceInstanceId: 'inst-99' });
    mockDidService.verify.mockResolvedValue({ verified: true, checks: [] });
    mockUpdateDidStatus.mockResolvedValue({ id: 'did-1', status: 'VERIFIED' });

    await POST(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof POST>[1]);

    expect(mockResolveDidService).toHaveBeenCalledWith('org-1', 'inst-99');
  });

  it('returns 500 when service resolution fails', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    mockResolveDidService.mockRejectedValue(new ServiceResolutionError('DID', 'org-1'));

    const res = await POST(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('No service instance available');
  });
});
