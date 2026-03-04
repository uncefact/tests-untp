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

const mockGetProfileById = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getProfileById: (id: string, tenantId: string) => mockGetProfileById(id, tenantId),
}));

import { GET } from './route';

function createFakeRequest(options: { method?: string; url?: string }): Request {
  const { method = 'GET', url = 'http://localhost/api/v1/cvc/profiles/prof-1' } = options;
  return {
    method,
    url,
    headers: new Headers(),
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({ id: 'prof-1' }) };

describe('GET /api/v1/cvc/profiles/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns profile when found (includes criteria)', async () => {
    const profile = {
      id: 'prof-1',
      name: 'Structural Steel',
      criteria: [
        {
          sortOrder: 0,
          criterion: { id: 'crit-1', name: 'Tensile Strength', conformityTopic: 'mechanical' },
        },
      ],
    };
    mockGetProfileById.mockResolvedValue(profile);

    const req = createFakeRequest({});
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(profile);
    expect(json.criteria).toHaveLength(1);
    expect(mockGetProfileById).toHaveBeenCalledWith('prof-1', 'org-1');
  });

  it('returns 404 when profile not found', async () => {
    mockGetProfileById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Profile not found');
  });
});
