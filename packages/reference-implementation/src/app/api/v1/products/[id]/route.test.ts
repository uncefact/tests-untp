// Mock next/server before importing route handlers
jest.mock('next/server', () => {
  class MockNextResponse {
    status: number;
    body: unknown;
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    async json() {
      return this.body;
    }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

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

const mockGetProductById = jest.fn();
const mockUpdateProduct = jest.fn();
const mockDeleteProduct = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getProductById: (id: string, tenantId: string) => mockGetProductById(id, tenantId),
  updateProduct: (id: string, tenantId: string, input: unknown) => mockUpdateProduct(id, tenantId, input),
  deleteProduct: (id: string, tenantId: string) => mockDeleteProduct(id, tenantId),
}));

import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { GET, PATCH, DELETE } from './route';

function createFakeRequest(options: { method?: string; body?: unknown; url?: string }): Request {
  const { method = 'GET', body, url = 'http://localhost/api/v1/products/p-1' } = options;
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

describe('GET /api/v1/products/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the product record', async () => {
    const product = { id: 'p-1', name: 'Widget A', level: 'MODEL' };
    mockGetProductById.mockResolvedValue(product);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('p-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(product);
  });

  it('returns 404 when product not found', async () => {
    mockGetProductById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext('nonexistent') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Product not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetProductById.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await GET(req, createContext('p-1') as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('PATCH /api/v1/products/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates product fields', async () => {
    const updated = { id: 'p-1', name: 'Updated Widget', level: 'MODEL' };
    mockUpdateProduct.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Widget' } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(updated);
  });

  it('returns 400 when no updatable fields provided', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: {} });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one updatable field must be provided');
  });

  it('returns 404 when product not found', async () => {
    mockUpdateProduct.mockRejectedValue(new NotFoundError('Product not found'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Widget' } });
    const res = await PATCH(req, createContext('nonexistent') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Product not found');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      method: 'PATCH',
      url: 'http://localhost/api/v1/products/p-1',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Request;
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
  });

  it('strips level from body before updating', async () => {
    const updated = { id: 'p-1', name: 'Updated Widget', level: 'MODEL' };
    mockUpdateProduct.mockResolvedValue(updated);

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Widget', level: 'BATCH' } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(updated);
    // Verify level was stripped from the update call
    expect(mockUpdateProduct).toHaveBeenCalledWith('p-1', 'org-1', { name: 'Updated Widget' });
  });

  it('returns 400 when name is provided but empty', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '' } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name must be a non-empty string');
  });

  it('returns 500 on unexpected error', async () => {
    mockUpdateProduct.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Widget' } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});

describe('DELETE /api/v1/products/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the product and returns 204 with no body', async () => {
    mockDeleteProduct.mockResolvedValue({ id: 'p-1' });

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('p-1') as unknown as Parameters<typeof DELETE>[1]);

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('returns 404 when product not found', async () => {
    mockDeleteProduct.mockRejectedValue(new NotFoundError('Product not found'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('nonexistent') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Product not found');
  });

  it('returns 400 when deletion is blocked by ValidationError', async () => {
    mockDeleteProduct.mockRejectedValue(new ValidationError('Cannot delete product with BATCH children'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('p-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Cannot delete product with BATCH children');
  });

  it('returns 500 on unexpected error', async () => {
    mockDeleteProduct.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await DELETE(req, createContext('p-1') as unknown as Parameters<typeof DELETE>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
