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

import { NotFoundError, ServiceRegistryError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { ServiceError } from '@uncefact/untp-ri-services';
import { withTenantAuth, handleRouteError } from './with-tenant-auth';

interface MockResponse {
  json: () => Promise<{ ok: boolean; error: string; code?: string }>;
}

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

  it('catches handler errors via handleRouteError', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue('org-1');

    const handler = jest.fn().mockRejectedValue(new NotFoundError('not found'));
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest(), emptyRouteContext);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'not found' });
  });
});

describe('handleRouteError', () => {
  it('maps ValidationError to 400', async () => {
    const res = handleRouteError(new ValidationError('bad input'));
    expect(res.status).toBe(400);
    const body = await (res as unknown as MockResponse).json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('bad input');
  });

  it('maps NotFoundError to 404', async () => {
    const res = handleRouteError(new NotFoundError('missing'));
    expect(res.status).toBe(404);
    const body = await (res as unknown as MockResponse).json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('missing');
  });

  it('maps ServiceRegistryError to 500', async () => {
    const res = handleRouteError(new ServiceRegistryError('config bad'));
    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('config bad');
  });

  it('maps ServiceError to its statusCode with code', async () => {
    const res = handleRouteError(new ServiceError('upstream fail', 'TEST_ERR', 502));
    expect(res.status).toBe(502);
    const body = await (res as unknown as MockResponse).json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('upstream fail');
    expect(body.code).toBe('TEST_ERR');
  });

  it('maps unknown errors to 500', async () => {
    const res = handleRouteError(new Error('kaboom'));
    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('kaboom');
  });
});
