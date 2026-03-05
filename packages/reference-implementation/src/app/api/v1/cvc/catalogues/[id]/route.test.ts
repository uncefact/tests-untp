// Mock next/server before importing route handlers
jest.mock('next/server', () => {
  class MockNextResponse {
    status: number;
    _body: unknown;

    constructor(body: unknown, init?: { status?: number }) {
      this._body = body;
      this.status = init?.status ?? 200;
    }

    async json() {
      return this._body;
    }

    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }

  return { NextResponse: MockNextResponse };
});

// Mock withTenantAuth to mirror handleRouteError behaviour
jest.mock('@/lib/api/with-tenant-auth', () => {
  const { NotFoundError, errorMessage } = jest.requireActual('@/lib/api/errors');
  const { ValidationError } = jest.requireActual('@/lib/api/validation');

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
          return jsonResponse({ error: errorMessage(e) }, { status: 500 });
        }
      },
  };
});

const mockGetCatalogueById = jest.fn();
const mockDeleteCatalogue = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getCatalogueById: (id: string, tenantId: string) => mockGetCatalogueById(id, tenantId),
  deleteCatalogue: (id: string, tenantId: string) => mockDeleteCatalogue(id, tenantId),
}));

import { NotFoundError } from '@/lib/api/errors';
import { GET, DELETE } from './route';

function createFakeRequest(options: { method?: string; url?: string }): Request {
  const { method = 'GET', url = 'http://localhost/api/v1/cvc/catalogues/cat-1' } = options;
  return {
    method,
    url,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  } as unknown as Request;
}

function createContext(id: string) {
  return { tenantId: 'org-1', params: Promise.resolve({ id }) };
}

describe('GET /api/v1/cvc/catalogues/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns catalogue when found', async () => {
    const catalogue = { id: 'cat-1', name: 'Test Catalogue' };
    mockGetCatalogueById.mockResolvedValue(catalogue);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('cat-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(catalogue);
    expect(mockGetCatalogueById).toHaveBeenCalledWith('cat-1', 'org-1');
  });

  it('returns 404 when catalogue not found', async () => {
    mockGetCatalogueById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Catalogue not found');
  });
});

describe('DELETE /api/v1/cvc/catalogues/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes catalogue successfully', async () => {
    mockDeleteCatalogue.mockResolvedValue(undefined);

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('cat-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect((res as unknown as { _body: unknown })._body).toBeNull();
    expect(mockDeleteCatalogue).toHaveBeenCalledWith('cat-1', 'org-1');
  });

  it('returns 404 when catalogue not found', async () => {
    mockDeleteCatalogue.mockRejectedValue(new NotFoundError('Catalogue not found or access denied'));

    const req = createFakeRequest({ method: 'DELETE' });
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Catalogue not found or access denied');
  });
});
