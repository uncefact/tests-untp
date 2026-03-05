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

const mockGetSchemeById = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getSchemeById: (id: string, tenantId: string) => mockGetSchemeById(id, tenantId),
}));

import { GET } from './route';

function createFakeRequest(options: { method?: string; url?: string }): Request {
  const { method = 'GET', url = 'http://localhost/api/v1/cvc/schemes/scheme-1' } = options;
  return {
    method,
    url,
    headers: new Headers(),
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: 'org-1', params: Promise.resolve({ id: 'scheme-1' }) };

describe('GET /api/v1/cvc/schemes/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns scheme when found', async () => {
    const scheme = { id: 'scheme-1', name: 'ACRS', profiles: [] };
    mockGetSchemeById.mockResolvedValue(scheme);

    const req = createFakeRequest({});
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(scheme);
    expect(mockGetSchemeById).toHaveBeenCalledWith('scheme-1', 'org-1');
  });

  it('returns 404 when scheme not found', async () => {
    mockGetSchemeById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('Scheme not found');
  });
});
