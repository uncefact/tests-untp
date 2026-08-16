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

const mockListCriteria = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  listConformityCriteria: (...args: unknown[]) => mockListCriteria(...args),
}));

import { GET } from './route';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/api/pagination';

type Ctx = Parameters<typeof GET>[1];
const CTX = { tenantId: 'tenant-1', params: Promise.resolve({}) } as unknown as Ctx;

function req(url: string): Request {
  return { method: 'GET', url, headers: new Headers() } as unknown as Request;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v1/cvc/criteria', () => {
  it('returns 400 when profileId is missing', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/criteria'), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^profileId:/);
    expect(mockListCriteria).not.toHaveBeenCalled();
  });

  it('returns 400 for a blank profileId', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/criteria?profileId=%20'), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^profileId:/);
    expect(mockListCriteria).not.toHaveBeenCalled();
  });

  it('reports the profileId issue before a pagination issue', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/criteria?limit=abc'), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^profileId:/);
  });

  it('returns 400 for a non-numeric limit', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/criteria?profileId=https://a.example/p/1&limit=abc'), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit: must be a positive integer');
  });

  it('rejects a limit above the maximum with a 400 and does not load the catalogue', async () => {
    const res = await GET(
      req(`http://localhost/api/v1/cvc/criteria?profileId=https://a.example/p/1&limit=${MAX_PAGE_LIMIT + 1}`),
      CTX,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain(`maximum of ${MAX_PAGE_LIMIT}`);
    expect(mockListCriteria).not.toHaveBeenCalled();
  });

  it('returns 400 for a negative offset', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/criteria?profileId=https://a.example/p/1&offset=-1'), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset: must be a non-negative integer');
  });

  it('returns 400 for a repeated query key', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/criteria?profileId=a&profileId=b'), CTX);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('repeated query parameter');
    expect(mockListCriteria).not.toHaveBeenCalled();
  });

  it('returns 500 when listConformityCriteria throws', async () => {
    mockListCriteria.mockRejectedValue(new Error('Database error'));

    const res = await GET(req('http://localhost/api/v1/cvc/criteria?profileId=https://a.example/p/1'), CTX);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });

  it('applies limit and offset to the page', async () => {
    mockListCriteria.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        name: `C${i}`,
        version: '1',
        status: 'active',
        topics: [],
        tags: [],
      })),
    );

    const res = await GET(
      req('http://localhost/api/v1/cvc/criteria?profileId=https://a.example/p/1&limit=2&offset=1'),
      CTX,
    );
    const json = await res.json();

    expect(json.data.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2']);
    expect(json.pagination).toEqual({ total: 5, limit: 2, offset: 1, hasMore: true });
  });

  it('lists the criteria for the requested profile', async () => {
    mockListCriteria.mockResolvedValue([
      { id: 'https://a.example/c/1', name: 'C1', version: '1', status: 'active', topics: [], tags: [] },
    ]);

    const res = await GET(req('http://localhost/api/v1/cvc/criteria?profileId=https://a.example/p/1'), CTX);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.pagination).toEqual({ total: 1, limit: DEFAULT_PAGE_LIMIT, offset: 0, hasMore: false });
    expect(mockListCriteria).toHaveBeenCalledWith('https://a.example/p/1', 'tenant-1');
  });
});
