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

const mockGetCriterionById = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getCriterionById: (...args: unknown[]) => mockGetCriterionById(...args),
}));

import { GET } from './route';

function createFakeRequest(options: { method?: string; url?: string }): Request {
  const { method = 'GET', url = 'http://localhost/api/v1/cvc/criteria/crit-1' } = options;
  return {
    method,
    url,
    headers: new Headers(),
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({ id: 'crit-1' }) };

describe('GET /api/v1/cvc/criteria/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns criterion when found', async () => {
    const criterion = {
      id: 'crit-1',
      name: 'Deforestation free',
      profiles: [{ profileId: 'profile-1', profile: { id: 'profile-1', name: 'EUDR' } }],
    };
    mockGetCriterionById.mockResolvedValue(criterion);

    const req = createFakeRequest({});
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(criterion);
    expect(json.profiles).toHaveLength(1);
    expect(mockGetCriterionById).toHaveBeenCalledWith('crit-1', 'org-1');
  });

  it('returns 404 when criterion not found', async () => {
    mockGetCriterionById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const ctx = { tenantId: 'org-1', params: Promise.resolve({ id: 'nonexistent' }) };
    const res = await GET(req, ctx as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Criterion not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockGetCriterionById.mockRejectedValue(new Error('Database error'));

    const req = createFakeRequest({});
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Database error');
  });
});
