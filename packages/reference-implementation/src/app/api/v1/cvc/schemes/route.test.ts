jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));

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

jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const mockListSchemes = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  listConformitySchemes: (...args: unknown[]) => mockListSchemes(...args),
}));

import { GET } from './route';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/api/pagination';

type Ctx = Parameters<typeof GET>[1];
const CTX = { tenantId: 'tenant-1', params: Promise.resolve({}) } as unknown as Ctx;

function req(url = 'http://localhost/api/v1/cvc/schemes'): Request {
  return { method: 'GET', url, headers: new Headers() } as unknown as Request;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v1/cvc/schemes', () => {
  it('returns the schemes with pagination metadata', async () => {
    mockListSchemes.mockResolvedValue([
      { id: 'https://a.example', name: 'Alpha', specVersion: '0.7.0' },
      { id: 'https://b.example', name: 'Bravo', specVersion: '0.7.0' },
    ]);

    const res = await GET(req(), CTX);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.pagination).toEqual({ total: 2, limit: DEFAULT_PAGE_LIMIT, offset: 0, hasMore: false });
    expect(mockListSchemes).toHaveBeenCalledWith('tenant-1');
  });

  it('applies limit and offset to the page', async () => {
    mockListSchemes.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, specVersion: '0.7.0' })),
    );

    const res = await GET(req('http://localhost/api/v1/cvc/schemes?limit=2&offset=1'), CTX);
    const json = await res.json();

    expect(json.data.map((s: { id: string }) => s.id)).toEqual(['s1', 's2']);
    expect(json.pagination).toEqual({ total: 5, limit: 2, offset: 1, hasMore: true });
  });

  it('returns 400 for a non-numeric limit', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/schemes?limit=abc'), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit: must be a positive integer');
    expect(mockListSchemes).not.toHaveBeenCalled();
  });

  it('accepts a limit of exactly the maximum', async () => {
    mockListSchemes.mockResolvedValue([]);

    const res = await GET(req(`http://localhost/api/v1/cvc/schemes?limit=${MAX_PAGE_LIMIT}`), CTX);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.pagination).toEqual({ total: 0, limit: MAX_PAGE_LIMIT, offset: 0, hasMore: false });
  });

  it('rejects a limit one above the maximum', async () => {
    const res = await GET(req(`http://localhost/api/v1/cvc/schemes?limit=${MAX_PAGE_LIMIT + 1}`), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain(`maximum of ${MAX_PAGE_LIMIT}`);
    expect(mockListSchemes).not.toHaveBeenCalled();
  });

  it.each(['0', '-1'])('returns 400 for a limit of %s', async (limit) => {
    const res = await GET(req(`http://localhost/api/v1/cvc/schemes?limit=${limit}`), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit: must be a positive integer');
    expect(mockListSchemes).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric offset', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/schemes?offset=abc'), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset: must be a non-negative integer');
  });

  it('returns 400 for a negative offset', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/schemes?offset=-1'), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset: must be a non-negative integer');
  });

  it('returns 400 for a repeated query key', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/schemes?limit=10&limit=20'), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('repeated query parameter');
    expect(mockListSchemes).not.toHaveBeenCalled();
  });

  it('returns 500 when listConformitySchemes throws', async () => {
    mockListSchemes.mockRejectedValue(new Error('Database error'));

    const res = await GET(req(), CTX);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
