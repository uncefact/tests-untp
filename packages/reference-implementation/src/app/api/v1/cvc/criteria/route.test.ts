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

const mockListCriteria = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  listCriteria: (...args: unknown[]) => mockListCriteria(...args),
}));

import { GET } from './route';

function createFakeRequest(options: { method?: string; url?: string }): Request {
  const { method = 'GET', url = 'http://localhost/api/v1/cvc/criteria' } = options;
  return {
    method,
    url,
    headers: new Headers(),
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({}) };

describe('GET /api/v1/cvc/criteria', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists criteria with default pagination', async () => {
    const criteria = [{ id: 'crit-1', name: 'Deforestation free' }];
    mockListCriteria.mockResolvedValue({ data: criteria, total: 1 });

    const req = createFakeRequest({ url: 'http://localhost/api/v1/cvc/criteria' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(criteria);
    expect(json.pagination).toEqual({ total: 1, limit: 20, offset: 0, hasMore: false });
    expect(mockListCriteria).toHaveBeenCalledWith('org-1', {
      profileId: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes profileId filter from query params', async () => {
    mockListCriteria.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      url: 'http://localhost/api/v1/cvc/criteria?profileId=profile-1',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListCriteria).toHaveBeenCalledWith('org-1', {
      profileId: 'profile-1',
      limit: undefined,
      offset: undefined,
    });
  });

  it('passes limit and offset from query params', async () => {
    mockListCriteria.mockResolvedValue({ data: [], total: 0 });

    const req = createFakeRequest({
      url: 'http://localhost/api/v1/cvc/criteria?limit=10&offset=5',
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListCriteria).toHaveBeenCalledWith('org-1', {
      profileId: undefined,
      limit: 10,
      offset: 5,
    });
  });

  it('returns 400 for non-numeric limit', async () => {
    const req = createFakeRequest({
      url: 'http://localhost/api/v1/cvc/criteria?limit=abc',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limit must be a positive integer');
  });

  it('returns 400 for negative offset', async () => {
    const req = createFakeRequest({
      url: 'http://localhost/api/v1/cvc/criteria?offset=-1',
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('offset must be a non-negative integer');
  });

  it('returns 500 when repository throws', async () => {
    mockListCriteria.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({ url: 'http://localhost/api/v1/cvc/criteria' });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
