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

type Ctx = Parameters<typeof GET>[1];
const CTX = { tenantId: 'tenant-1', params: Promise.resolve({}) } as unknown as Ctx;

function req(url: string): Request {
  return { method: 'GET', url, headers: new Headers() } as unknown as Request;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v1/cvc/criteria', () => {
  it('returns 400 when profileId is missing', async () => {
    const res = await GET(req('http://localhost/api/v1/cvc/criteria'), CTX);
    expect(res.status).toBe(400);
    expect(mockListCriteria).not.toHaveBeenCalled();
  });

  it('lists the criteria for the requested profile', async () => {
    mockListCriteria.mockResolvedValue([
      { id: 'https://a.example/c/1', name: 'C1', version: '1', status: 'active', topics: [], tags: [] },
    ]);

    const res = await GET(req('http://localhost/api/v1/cvc/criteria?profileId=https://a.example/p/1'), CTX);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.pagination).toEqual({ total: 1, limit: 20, offset: 0, hasMore: false });
    expect(mockListCriteria).toHaveBeenCalledWith('https://a.example/p/1', 'tenant-1');
  });
});
