jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockGetSessionUserId = jest.fn();
const mockGetTenantId = jest.fn();

jest.mock('@/lib/api/helpers', () => ({
  getSessionUserId: () => mockGetSessionUserId(),
  getTenantId: (id: string) => mockGetTenantId(id),
}));

import { withTenantAuth } from './with-tenant-auth';

beforeEach(() => {
  jest.resetAllMocks();
});

function fakeRequest(method = 'GET'): Request {
  return { method, url: 'http://localhost/api/v1/test' } as unknown as Request;
}

const emptyRouteContext = { params: Promise.resolve({}) };

describe('withTenantAuth', () => {
  it('returns 401 when getSessionUserId returns null', async () => {
    mockGetSessionUserId.mockResolvedValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest(), emptyRouteContext);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 403 when getTenantId returns null', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest(), emptyRouteContext);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'No tenant found for user' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('calls inner handler with correct userId, tenantId, and params', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue('org-1');

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    const req = fakeRequest('POST');
    const routeContext = { params: Promise.resolve({ id: 'test-id' }) };

    await wrapped(req, routeContext);

    expect(handler).toHaveBeenCalledWith(req, {
      userId: 'user-1',
      tenantId: 'org-1',
      params: routeContext.params,
    });
  });

  it('passes through route params correctly', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue('org-1');

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    const routeContext = { params: Promise.resolve({ id: 'test-id' }) };

    await wrapped(fakeRequest(), routeContext);

    const passedContext = handler.mock.calls[0][1];
    await expect(passedContext.params).resolves.toEqual({ id: 'test-id' });
  });
});
