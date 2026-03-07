// Mock next/server before importing route handlers
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

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

const mockListSchemes = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  listSchemes: (tenantId: string, opts: unknown) => mockListSchemes(tenantId, opts),
}));

import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import { GET } from './route';

function createFakeRequest(options: { method?: string; url?: string }): Request {
  const { method = 'GET', url = 'http://localhost/api/v1/cvc/schemes' } = options;
  return {
    method,
    url,
    headers: new Headers(),
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('GET /api/v1/cvc/schemes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists schemes with default pagination', async () => {
    const schemes = [{ id: 'sch-1', name: 'ACRS' }];
    mockListSchemes.mockResolvedValue({ data: schemes, total: 1 });

    const req = createFakeRequest({ url: 'http://localhost/api/v1/cvc/schemes' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(schemes);
    expect(json.pagination).toEqual({ total: 1, limit: DEFAULT_PAGE_LIMIT, offset: 0, hasMore: false });
    expect(mockListSchemes).toHaveBeenCalledWith('org-1', {
      catalogueId: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes catalogueId filter from query params', async () => {
    mockListSchemes.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      url: 'http://localhost/api/v1/cvc/schemes?catalogueId=cat-1',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListSchemes).toHaveBeenCalledWith('org-1', {
      catalogueId: 'cat-1',
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes limit and offset from query params', async () => {
    mockListSchemes.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      url: 'http://localhost/api/v1/cvc/schemes?limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListSchemes).toHaveBeenCalledWith('org-1', {
      catalogueId: undefined,
      limit: 10,
      offset: 5,
    });
  });
});
