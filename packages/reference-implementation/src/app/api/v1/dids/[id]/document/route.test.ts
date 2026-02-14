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

const mockResolveDidService = jest.fn();
const mockGetDidById = jest.fn();

jest.mock('@/lib/services/resolve-did-service', () => ({
  resolveDidService: (...args: unknown[]) => mockResolveDidService(...args),
}));

jest.mock('@/lib/prisma/repositories', () => ({
  getDidById: (id: string, orgId: string) => mockGetDidById(id, orgId),
}));

import { ServiceResolutionError } from '@/lib/api/errors';
import { GET } from './route';

function createContext(id: string) {
  return { tenantId: 'org-1', params: Promise.resolve({ id }) };
}

function createFakeRequest(): Request {
  return {
    method: 'GET',
    url: 'http://localhost/api/v1/dids/did-1/document',
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as Request;
}

describe('GET /api/v1/dids/:id/document', () => {
  const mockDidService = { getDocument: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveDidService.mockResolvedValue({ service: mockDidService, instanceId: 'inst-1' });
  });

  it('returns the DID document', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    const document = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:web:example.com',
      verificationMethod: [],
    };
    mockDidService.getDocument.mockResolvedValue(document);

    const res = await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.document).toEqual(document);
  });

  it('returns 404 when DID not found', async () => {
    mockGetDidById.mockResolvedValue(null);

    const res = await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(404);
  });

  it('returns 500 when service fails', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    mockDidService.getDocument.mockRejectedValue(new Error('Service error'));

    const res = await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(500);
  });

  it('returns 500 when service resolution fails', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    mockResolveDidService.mockRejectedValue(new ServiceResolutionError('DID', 'org-1'));

    const res = await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('No service instance available');
  });

  it('resolves the DID service with the organisation ID', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com' });
    mockDidService.getDocument.mockResolvedValue({ id: 'did:web:example.com' });

    await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);

    expect(mockResolveDidService).toHaveBeenCalledWith('org-1', undefined);
  });

  it('resolves the DID service with the stored serviceInstanceId', async () => {
    mockGetDidById.mockResolvedValue({ id: 'did-1', did: 'did:web:example.com', serviceInstanceId: 'inst-99' });
    mockDidService.getDocument.mockResolvedValue({ id: 'did:web:example.com' });

    await GET(createFakeRequest(), createContext('did-1') as unknown as Parameters<typeof GET>[1]);

    expect(mockResolveDidService).toHaveBeenCalledWith('org-1', 'inst-99');
  });
});
