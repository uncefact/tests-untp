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

import { ConflictError, NotFoundError } from '@/lib/api/errors';
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
    expect(json.error).toContain('At least one updatable field is required');
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
    expect(json.error).toMatch(/^name:/);
  });

  it('returns 500 on unexpected error', async () => {
    mockUpdateProduct.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Updated Widget' } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });

  it('returns 409 when the identifier already belongs to another product', async () => {
    mockUpdateProduct.mockRejectedValue(
      new ConflictError('The identifier is already the primary identifier of another product'),
    );

    const req = createFakeRequest({ method: 'PATCH', body: { primaryIdentifierId: 'ident-1' } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('The identifier is already the primary identifier of another product');
    // The identifier the conflict is about must actually reach the repository.
    expect(mockUpdateProduct).toHaveBeenCalledWith(
      'p-1',
      expect.anything(),
      expect.objectContaining({ primaryIdentifierId: 'ident-1' }),
    );
  });

  // The previous handler probed the body with `field in body` before checking
  // it was an object. Any JSON primitive parses fine, so `in` threw a
  // TypeError that reached the client as a 500 carrying the raw message.
  it.each([[null], [42], ['x'], [true]])(
    'returns 400 for a non-object PATCH body of %p and does not reach the repository',
    async (body) => {
      const req = createFakeRequest({ method: 'PATCH', body });
      const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);

      expect(res.status).toBe(400);
      expect(mockUpdateProduct).not.toHaveBeenCalled();
    },
  );

  it('returns 400 when the body carries only unrecognised keys', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { nmae: 'typo', level: 'ITEM' } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one updatable field is required');
    expect(mockUpdateProduct).not.toHaveBeenCalled();
  });

  // level is immutable, so it is stripped rather than rejected when it
  // accompanies a field that can be updated (ADR-037 decision point 4).
  it('strips an immutable level and updates the rest', async () => {
    mockUpdateProduct.mockResolvedValue({ id: 'p-1', name: 'Renamed' });

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Renamed', level: 'ITEM' } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateProduct).toHaveBeenCalledWith('p-1', 'org-1', { name: 'Renamed' });
  });

  // Each of these columns is nullable and an explicit null clears it, so the
  // schema must forward the null rather than reject it or drop it.
  it.each([
    ['description'],
    ['parentId'],
    ['producedByOrganisationId'],
    ['manufacturingFacilityId'],
    ['primaryIdentifierId'],
  ])('forwards an explicit null %s as a clear', async (field) => {
    mockUpdateProduct.mockResolvedValue({ id: 'p-1' });

    const req = createFakeRequest({ method: 'PATCH', body: { [field]: null } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateProduct).toHaveBeenCalledWith('p-1', 'org-1', { [field]: null });
  });

  // An empty array is the clear; omitting the field leaves the links alone.
  it('forwards an empty secondaryIdentifierIds array as a clear', async () => {
    mockUpdateProduct.mockResolvedValue({ id: 'p-1' });

    const req = createFakeRequest({ method: 'PATCH', body: { secondaryIdentifierIds: [] } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(200);
    expect(mockUpdateProduct).toHaveBeenCalledWith('p-1', 'org-1', { secondaryIdentifierIds: [] });
  });

  it('returns 400 for a whitespace-only name', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { name: '   ' } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('name: must not be only whitespace');
    expect(mockUpdateProduct).not.toHaveBeenCalled();
  });

  it('returns 400 for duplicate secondary identifiers', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { secondaryIdentifierIds: ['id-1', 'id-1'] } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('secondaryIdentifierIds: must not contain duplicate identifiers');
    expect(mockUpdateProduct).not.toHaveBeenCalled();
  });

  it.each([[''], ['   ']])('returns 400 for a description of %p on update', async (description) => {
    const req = createFakeRequest({ method: 'PATCH', body: { description } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    expect(mockUpdateProduct).not.toHaveBeenCalled();
  });

  // An empty string iterated zero times, so it reached the repository as a
  // clear. Only an array expresses that now.
  it('returns 400 for an empty-string secondaryIdentifierIds', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { secondaryIdentifierIds: '' } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    expect(mockUpdateProduct).not.toHaveBeenCalled();
  });

  // A null entered the repository's `!== undefined` branch and then iterated
  // over null, which threw a TypeError the client received as a 500.
  it('returns 400 for a null secondaryIdentifierIds', async () => {
    const req = createFakeRequest({ method: 'PATCH', body: { secondaryIdentifierIds: null } });
    const res = await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(res.status).toBe(400);
    expect(mockUpdateProduct).not.toHaveBeenCalled();
  });

  // Omitting the field leaves the existing links untouched, so it must not
  // reach the repository as an empty array.
  it('leaves secondaryIdentifierIds out of the update when it is omitted', async () => {
    mockUpdateProduct.mockResolvedValue({ id: 'p-1', name: 'Renamed' });

    const req = createFakeRequest({ method: 'PATCH', body: { name: 'Renamed' } });
    await PATCH(req, createContext('p-1') as unknown as Parameters<typeof PATCH>[1]);

    expect(mockUpdateProduct).toHaveBeenCalledWith('p-1', 'org-1', { name: 'Renamed' });
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
