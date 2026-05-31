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
    expect(json.pagination).toEqual({ total: 2, limit: 20, offset: 0, hasMore: false });
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

  it('returns 400 for an invalid limit', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/schemes?limit=abc'), CTX);
    expect(res.status).toBe(400);
  });
});
