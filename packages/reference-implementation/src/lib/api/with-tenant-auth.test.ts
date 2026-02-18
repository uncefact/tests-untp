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

const mockResolveServiceAccountUser = jest.fn();

jest.mock('@/lib/api/service-account-user', () => ({
  resolveServiceAccountUser: (claims: unknown) => mockResolveServiceAccountUser(claims),
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

function fakeRequest(method = 'GET', headers: Record<string, string> = {}): Request {
  const headersMap = new Map(Object.entries(headers));
  return {
    method,
    url: 'http://localhost/api/v1/test',
    headers: {
      get: (key: string) => headersMap.get(key) ?? null,
    },
  } as unknown as Request;
}

const emptyRouteContext = { params: Promise.resolve({}) };

describe('withTenantAuth — session path', () => {
  it('returns 401 when no session and no x-auth-sub header', async () => {
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

  it('calls inner handler with correct context for session auth', async () => {
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
      authMethod: 'session',
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

  it('does not attempt service account resolution when session exists', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue('org-1');

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);

    // Even with x-auth-sub present, session path should take precedence
    await wrapped(fakeRequest('GET', { 'x-auth-sub': 'ext-123' }), emptyRouteContext);

    expect(mockResolveServiceAccountUser).not.toHaveBeenCalled();
    expect(handler.mock.calls[0][1].authMethod).toBe('session');
  });
});

describe('withTenantAuth — service account path', () => {
  beforeEach(() => {
    // No session for service account tests
    mockGetSessionUserId.mockResolvedValue(null);
  });

  it('resolves user via x-auth-sub header when no session', async () => {
    mockResolveServiceAccountUser.mockResolvedValue({ userId: 'sa-user-1', tenantId: 'sa-org-1' });

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);

    const req = fakeRequest('GET', {
      'x-auth-sub': 'ext-sub-123',
      'x-auth-azp': 'my-client',
      'x-auth-name': 'Test User',
      'x-auth-email': 'test@example.com',
    });

    await wrapped(req, emptyRouteContext);

    expect(mockResolveServiceAccountUser).toHaveBeenCalledWith({
      sub: 'ext-sub-123',
      name: 'Test User',
      email: 'test@example.com',
    });

    expect(handler).toHaveBeenCalledWith(req, {
      userId: 'sa-user-1',
      tenantId: 'sa-org-1',
      params: emptyRouteContext.params,
      authMethod: 'service-account',
      serviceAccountClientId: 'my-client',
    });
  });

  it('returns 401 when resolveServiceAccountUser returns null', async () => {
    mockResolveServiceAccountUser.mockResolvedValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);

    const req = fakeRequest('GET', { 'x-auth-sub': 'ext-sub-unknown' });
    const res = await wrapped(req, emptyRouteContext);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes undefined for optional headers when not present', async () => {
    mockResolveServiceAccountUser.mockResolvedValue({ userId: 'sa-user-1', tenantId: 'sa-org-1' });

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);

    const req = fakeRequest('GET', { 'x-auth-sub': 'ext-sub-123' });
    await wrapped(req, emptyRouteContext);

    expect(mockResolveServiceAccountUser).toHaveBeenCalledWith({
      sub: 'ext-sub-123',
      name: undefined,
      email: undefined,
    });

    const context = handler.mock.calls[0][1];
    expect(context.authMethod).toBe('service-account');
    expect(context.serviceAccountClientId).toBeUndefined();
  });

  it('catches handler errors in service account path', async () => {
    mockResolveServiceAccountUser.mockResolvedValue({ userId: 'sa-user-1', tenantId: 'sa-org-1' });

    const handler = jest.fn().mockRejectedValue(new NotFoundError('not found'));
    const wrapped = withTenantAuth(handler);

    const req = fakeRequest('GET', { 'x-auth-sub': 'ext-sub-123' });
    const res = await wrapped(req, emptyRouteContext);

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
