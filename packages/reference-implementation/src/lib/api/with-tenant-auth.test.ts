// Polyfill crypto.randomUUID for the test environment
if (!globalThis.crypto?.randomUUID) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { ...globalThis.crypto, randomUUID },
  });
}

const mockRunWithRequestContext = jest.fn((_correlationId: string, callback: () => unknown) => callback());
const mockUpdateRequestContext = jest.fn();

const mockLogger = (): Record<string, jest.Mock> => {
  const logger: Record<string, jest.Mock> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockImplementation(() => mockLogger());
  return logger;
};

jest.mock('@uncefact/untp-ri-services/logging', () => ({
  // Real validator: the wrappers' reject-and-replace behaviour is the code under test.
  isValidCorrelationId: jest.requireActual('@uncefact/untp-ri-services/logging').isValidCorrelationId,
  runWithRequestContext: (correlationId: string, callback: () => unknown) =>
    mockRunWithRequestContext(correlationId, callback),
  updateRequestContext: (partial: Record<string, unknown>) => mockUpdateRequestContext(partial),
  createLogger: () => mockLogger(),
}));

const mockApiLoggerInfo = jest.fn();
const mockApiLoggerWarn = jest.fn();
const mockApiLoggerError = jest.fn();
jest.mock('@/lib/api/logger', () => ({
  apiLogger: {
    info: (...args: unknown[]) => mockApiLoggerInfo(...args),
    warn: (...args: unknown[]) => mockApiLoggerWarn(...args),
    error: (...args: unknown[]) => mockApiLoggerError(...args),
    debug: jest.fn(),
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  },
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Open mode mocks
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

// Tenant config mock — controlled by mockTenantMode
let mockTenantMode: 'open' | 'closed' | 'invalid' = 'open';
jest.mock('@/lib/auth/tenant-config', () => ({
  getTenantConfig: () => {
    if (mockTenantMode === 'invalid') {
      // Mirrors the real thrown shape, which names the rejected value.
      throw new Error('Invalid TENANT_MODE: "sideways". Must be one of: open, closed');
    }
    if (mockTenantMode === 'closed') {
      return { mode: 'closed', claimName: 'groups', claimFormat: 'array_first' };
    }
    return { mode: 'open' };
  },
}));

// Closed mode mocks
const mockAuth = jest.fn();
jest.mock('@/auth', () => ({
  auth: () => mockAuth(),
}));

const mockPrismaTenant = { findUnique: jest.fn() };
const mockPrismaUser = { findUnique: jest.fn(), update: jest.fn() };
jest.mock('@/lib/prisma/prisma', () => ({
  prisma: {
    tenant: mockPrismaTenant,
    user: mockPrismaUser,
  },
}));

const mockResolveClosedModeTenant = jest.fn();
jest.mock('@/lib/api/resolve-closed-mode-tenant', () => ({
  resolveClosedModeTenant: (...args: unknown[]) => mockResolveClosedModeTenant(...args),
}));

const mockValidateServiceAccountToken = jest.fn();
const mockExtractBearerToken = jest.fn();
jest.mock('@/lib/auth/token-validator', () => ({
  validateServiceAccountToken: (...args: unknown[]) => mockValidateServiceAccountToken(...args),
  extractBearerToken: (...args: unknown[]) => mockExtractBearerToken(...args),
}));

const mockExtractGroupClaim = jest.fn();
jest.mock('@/lib/auth/group-claim', () => ({
  extractGroupClaim: (...args: unknown[]) => mockExtractGroupClaim(...args),
}));

import { NotFoundError, ServiceRegistryError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { ServiceError } from '@uncefact/untp-ri-services';
import { withTenantAuth, handleRouteError } from './with-tenant-auth';

interface MockResponse {
  json: () => Promise<{ error: string; code?: string }>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTenantMode = 'open';
  // Restore the default implementation after clearing — resetAllMocks would
  // remove the implementation, causing runWithRequestContext to return undefined
  // instead of invoking the callback.
  mockRunWithRequestContext.mockImplementation((_correlationId: string, callback: () => unknown) => callback());
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

// ========================================================
// Open mode tests (existing — regression)
// ========================================================

describe('withTenantAuth — open mode, session path', () => {
  it('returns 401 when no session and no x-auth-sub header', async () => {
    mockGetSessionUserId.mockResolvedValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest(), emptyRouteContext);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 403 when getTenantId returns null', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest(), emptyRouteContext);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'No tenant found for user' });
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
    expect(await res.json()).toEqual({ error: 'not found' });
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

describe('withTenantAuth — open mode, service account path', () => {
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
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
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
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

// ========================================================
// Closed mode tests
// ========================================================

describe('withTenantAuth — closed mode, session path', () => {
  beforeEach(() => {
    mockTenantMode = 'closed';
  });

  it('resolves tenant by group claim from session', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1' },
      group_claim: '/acme-corp',
    });
    mockPrismaTenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    mockPrismaUser.findUnique.mockResolvedValue({ tenantId: 'tenant-1' });

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest(), emptyRouteContext);

    expect(mockPrismaTenant.findUnique).toHaveBeenCalledWith({
      where: { externalIdpGroupId: '/acme-corp' },
      select: { id: true },
    });
    expect(mockPrismaUser.update).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        authMethod: 'session',
      }),
    );
  });

  it('re-links user when group changes to a different tenant', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1' },
      group_claim: '/new-group',
    });
    mockPrismaTenant.findUnique.mockResolvedValue({ id: 'tenant-2' });
    mockPrismaUser.findUnique.mockResolvedValue({ tenantId: 'tenant-1' });
    mockPrismaUser.update.mockResolvedValue({});

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest(), emptyRouteContext);

    expect(mockPrismaUser.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tenantId: 'tenant-2' },
    });
  });

  it('skips user update when already linked to correct tenant', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1' },
      group_claim: '/same-group',
    });
    mockPrismaTenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    mockPrismaUser.findUnique.mockResolvedValue({ tenantId: 'tenant-1' });

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest(), emptyRouteContext);

    expect(mockPrismaUser.update).not.toHaveBeenCalled();
  });

  it('returns 401 when session has RefreshAccessTokenError', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1' },
      group_claim: '/acme',
      error: 'RefreshAccessTokenError',
    });

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest(), emptyRouteContext);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        error: 'Session expired — please sign in again',
      }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 403 when session has no group claim', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1' },
    });

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest(), emptyRouteContext);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        error: 'No group assignment found',
      }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 403 when no tenant matches the group claim', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1' },
      group_claim: '/unknown-group',
    });
    mockPrismaTenant.findUnique.mockResolvedValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest(), emptyRouteContext);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        error: 'No tenant found for group',
      }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 401 when no session and no bearer token', async () => {
    mockAuth.mockResolvedValue(null);
    mockExtractBearerToken.mockReturnValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest(), emptyRouteContext);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });
});

describe('withTenantAuth — closed mode, bearer path', () => {
  beforeEach(() => {
    mockTenantMode = 'closed';
    mockAuth.mockResolvedValue(null); // No session
  });

  it('resolves tenant by group claim from bearer token', async () => {
    mockExtractBearerToken.mockReturnValue('valid-token');
    mockValidateServiceAccountToken.mockResolvedValue({
      valid: true,
      payload: { sub: 'ext-sub-1', groups: ['/acme'], azp: 'my-client' },
    });
    mockExtractGroupClaim.mockReturnValue('/acme');
    mockResolveClosedModeTenant.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1' });

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    const req = fakeRequest('GET', { authorization: 'Bearer valid-token' });
    await wrapped(req, emptyRouteContext);

    expect(mockResolveClosedModeTenant).toHaveBeenCalledWith('/acme', 'ext-sub-1', {
      name: undefined,
      email: undefined,
    });
    expect(handler).toHaveBeenCalledWith(
      req,
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        authMethod: 'service-account',
        serviceAccountClientId: 'my-client',
      }),
    );
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockExtractBearerToken.mockReturnValue('bad-token');
    mockValidateServiceAccountToken.mockResolvedValue({
      valid: false,
      error: 'Token expired',
    });

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest('GET', { authorization: 'Bearer bad-token' }), emptyRouteContext);

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 401 when bearer token has no sub claim', async () => {
    mockExtractBearerToken.mockReturnValue('token-no-sub');
    mockValidateServiceAccountToken.mockResolvedValue({
      valid: true,
      payload: { groups: ['/acme'] }, // no sub
    });

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest('GET', { authorization: 'Bearer token-no-sub' }), emptyRouteContext);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        error: 'Token missing required sub claim',
      }),
    );
  });

  it('returns 403 when bearer token has no group claim', async () => {
    mockExtractBearerToken.mockReturnValue('token-no-group');
    mockValidateServiceAccountToken.mockResolvedValue({
      valid: true,
      payload: { sub: 'ext-sub-1' },
    });
    mockExtractGroupClaim.mockReturnValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest('GET', { authorization: 'Bearer token-no-group' }), emptyRouteContext);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        error: 'No group assignment found in token',
      }),
    );
  });

  it('returns 500 when resolveClosedModeTenant fails', async () => {
    mockExtractBearerToken.mockReturnValue('valid-token');
    mockValidateServiceAccountToken.mockResolvedValue({
      valid: true,
      payload: { sub: 'ext-sub-1', groups: ['/acme'] },
    });
    mockExtractGroupClaim.mockReturnValue('/acme');
    mockResolveClosedModeTenant.mockResolvedValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    const res = await wrapped(fakeRequest('GET', { authorization: 'Bearer valid-token' }), emptyRouteContext);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        error: 'Failed to resolve tenant',
      }),
    );
  });

  it('passes name and email claims from bearer token', async () => {
    mockExtractBearerToken.mockReturnValue('valid-token');
    mockValidateServiceAccountToken.mockResolvedValue({
      valid: true,
      payload: { sub: 'ext-sub-1', groups: ['/acme'], name: 'Alice', email: 'alice@example.com' },
    });
    mockExtractGroupClaim.mockReturnValue('/acme');
    mockResolveClosedModeTenant.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1' });

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest('GET', { authorization: 'Bearer valid-token' }), emptyRouteContext);

    expect(mockResolveClosedModeTenant).toHaveBeenCalledWith('/acme', 'ext-sub-1', {
      name: 'Alice',
      email: 'alice@example.com',
    });
  });
});

// ========================================================
// Request context propagation tests
// ========================================================

describe('withTenantAuth — request context propagation', () => {
  it('establishes request context with correlationId from x-correlation-id header', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue('org-1');

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest('GET', { 'x-correlation-id': 'test-corr-id' }), emptyRouteContext);

    expect(mockRunWithRequestContext).toHaveBeenCalledWith('test-corr-id', expect.any(Function));
  });

  it('generates fallback correlationId when x-correlation-id header is missing', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue('org-1');

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest(), emptyRouteContext);

    expect(mockRunWithRequestContext).toHaveBeenCalledTimes(1);
    const correlationId = mockRunWithRequestContext.mock.calls[0][0];
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects an x-correlation-id with characters outside the allowed charset', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue('org-1');

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest('GET', { 'x-correlation-id': 'bad id; DROP TABLE' }), emptyRouteContext);

    const correlationId = mockRunWithRequestContext.mock.calls[0][0];
    expect(correlationId).not.toBe('bad id; DROP TABLE');
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects oversized x-correlation-id and generates a fallback UUID', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue('org-1');

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    const oversizedId = 'x'.repeat(200);
    await wrapped(fakeRequest('GET', { 'x-correlation-id': oversizedId }), emptyRouteContext);

    expect(mockRunWithRequestContext).toHaveBeenCalledTimes(1);
    const correlationId = mockRunWithRequestContext.mock.calls[0][0];
    expect(correlationId).not.toBe(oversizedId);
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets userId and tenantId on request context for open mode session path', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue('org-1');

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest(), emptyRouteContext);

    expect(mockUpdateRequestContext).toHaveBeenCalledWith({ userId: 'user-1', tenantId: 'org-1' });
  });

  it('sets the request method and path on the request context under collision-resistant keys so every log entry is attributable to its route', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue('org-1');

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest('POST'), emptyRouteContext);

    expect(mockUpdateRequestContext).toHaveBeenCalledWith({ requestMethod: 'POST', requestPath: '/api/v1/test' });
  });

  it('sets userId and tenantId on request context for open mode service account path', async () => {
    mockGetSessionUserId.mockResolvedValue(null);
    mockResolveServiceAccountUser.mockResolvedValue({ userId: 'sa-user-1', tenantId: 'sa-org-1' });

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest('GET', { 'x-auth-sub': 'ext-sub-1' }), emptyRouteContext);

    expect(mockUpdateRequestContext).toHaveBeenCalledWith({ userId: 'sa-user-1', tenantId: 'sa-org-1' });
  });

  it('sets userId and tenantId on request context for closed mode session path', async () => {
    mockTenantMode = 'closed';
    mockAuth.mockResolvedValue({
      user: { id: 'user-1' },
      group_claim: '/acme',
    });
    mockPrismaTenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    mockPrismaUser.findUnique.mockResolvedValue({ tenantId: 'tenant-1' });

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest(), emptyRouteContext);

    expect(mockUpdateRequestContext).toHaveBeenCalledWith({ userId: 'user-1', tenantId: 'tenant-1' });
  });

  it('sets userId and tenantId on request context for closed mode bearer path', async () => {
    mockTenantMode = 'closed';
    mockAuth.mockResolvedValue(null);
    mockExtractBearerToken.mockReturnValue('valid-token');
    mockValidateServiceAccountToken.mockResolvedValue({
      valid: true,
      payload: { sub: 'ext-sub-1', groups: ['/acme'], azp: 'client-1' },
    });
    mockExtractGroupClaim.mockReturnValue('/acme');
    mockResolveClosedModeTenant.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1' });

    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest('GET', { authorization: 'Bearer valid-token' }), emptyRouteContext);

    expect(mockUpdateRequestContext).toHaveBeenCalledWith({ userId: 'user-1', tenantId: 'tenant-1' });
  });

  it('does not set userId or tenantId on open mode 401 path', async () => {
    mockGetSessionUserId.mockResolvedValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest(), emptyRouteContext);

    expect(mockUpdateRequestContext).not.toHaveBeenCalledWith(expect.objectContaining({ userId: expect.anything() }));
    expect(mockUpdateRequestContext).not.toHaveBeenCalledWith(expect.objectContaining({ tenantId: expect.anything() }));
    // Route attribution is still established before auth so the denial log is attributable.
    expect(mockUpdateRequestContext).toHaveBeenCalledWith({ requestMethod: 'GET', requestPath: '/api/v1/test' });
  });

  it('does not set userId or tenantId on open mode 403 path', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest(), emptyRouteContext);

    expect(mockUpdateRequestContext).not.toHaveBeenCalledWith(expect.objectContaining({ userId: expect.anything() }));
    expect(mockUpdateRequestContext).not.toHaveBeenCalledWith(expect.objectContaining({ tenantId: expect.anything() }));
  });

  it('does not set userId or tenantId on closed mode 401 path', async () => {
    mockTenantMode = 'closed';
    mockAuth.mockResolvedValue(null);
    mockExtractBearerToken.mockReturnValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest(), emptyRouteContext);

    expect(mockUpdateRequestContext).not.toHaveBeenCalledWith(expect.objectContaining({ userId: expect.anything() }));
    expect(mockUpdateRequestContext).not.toHaveBeenCalledWith(expect.objectContaining({ tenantId: expect.anything() }));
  });

  it('does not set userId or tenantId on closed mode 403 path', async () => {
    mockTenantMode = 'closed';
    mockAuth.mockResolvedValue({
      user: { id: 'user-1' },
      group_claim: '/unknown',
    });
    mockPrismaTenant.findUnique.mockResolvedValue(null);

    const handler = jest.fn();
    const wrapped = withTenantAuth(handler);
    await wrapped(fakeRequest(), emptyRouteContext);

    expect(mockUpdateRequestContext).not.toHaveBeenCalledWith(expect.objectContaining({ userId: expect.anything() }));
    expect(mockUpdateRequestContext).not.toHaveBeenCalledWith(expect.objectContaining({ tenantId: expect.anything() }));
  });
});

// ========================================================
// handleRouteError tests (unchanged)
// ========================================================

// ========================================================
// Pre-handler pipeline failures (#850)
// ========================================================

describe('withTenantAuth — unexpected failures before the handler runs', () => {
  const SENTINEL = 'tenant lookup exploded with connection string postgres://user:pw@host/db';

  it('returns the documented envelope with a canned message when open-mode tenant resolution throws', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockRejectedValue(new Error(SENTINEL));
    const handler = jest.fn();

    const res = (await withTenantAuth(handler)(fakeRequest(), emptyRouteContext)) as unknown as MockResponse & {
      status: number;
    };
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
    // The thrown text must not reach the client: Next's own uncaught path
    // returns a plain fallback carrying no message, so this boundary must not
    // become a new disclosure channel.
    expect(JSON.stringify(body)).not.toContain('postgres://');
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns the canned envelope when the session read itself throws in closed mode', async () => {
    mockTenantMode = 'closed';
    mockAuth.mockRejectedValue(new Error(SENTINEL));

    const res = (await withTenantAuth(jest.fn())(fakeRequest(), emptyRouteContext)) as unknown as MockResponse & {
      status: number;
    };
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
  });

  it('returns the canned envelope when the closed-mode tenant lookup throws', async () => {
    mockTenantMode = 'closed';
    mockAuth.mockResolvedValue({ user: { id: 'user-1' }, group_claim: 'group-1' });
    mockPrismaTenant.findUnique.mockRejectedValue(new Error(SENTINEL));

    const res = (await withTenantAuth(jest.fn())(fakeRequest(), emptyRouteContext)) as unknown as MockResponse & {
      status: number;
    };
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
  });

  it('routes a service-account resolution failure through the same central boundary', async () => {
    mockGetSessionUserId.mockResolvedValue(null);
    mockResolveServiceAccountUser.mockRejectedValue(new Error(SENTINEL));

    const res = (await withTenantAuth(jest.fn())(
      fakeRequest('GET', { 'x-auth-sub': 'sub-1' }),
      emptyRouteContext,
    )) as unknown as MockResponse & { status: number };
    const body = await res.json();

    expect(res.status).toBe(500);
    // The same canned body as every other pre-handler failure, rather than a
    // second wording produced by a catch local to this path.
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
  });

  it('attributes a service-account failure by putting the subject on the request context', async () => {
    mockGetSessionUserId.mockResolvedValue(null);
    mockResolveServiceAccountUser.mockRejectedValue(new Error(SENTINEL));

    await withTenantAuth(jest.fn())(fakeRequest('GET', { 'x-auth-sub': 'sub-1' }), emptyRouteContext);

    // Without this the central boundary's log could not say which service
    // account the failure belonged to, which the removed local catch did.
    expect(mockUpdateRequestContext).toHaveBeenCalledWith(expect.objectContaining({ serviceAccountSub: 'sub-1' }));
  });

  it('keeps the sanitised database mapping for a Prisma failure thrown before the handler', async () => {
    const prismaError = Object.assign(new Error('Invalid `prisma.tenant.findUnique()` invocation: table missing'), {
      code: 'P2021',
      clientVersion: '5.0.0',
      name: 'PrismaClientKnownRequestError',
    });
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockRejectedValue(prismaError);

    const res = (await withTenantAuth(jest.fn())(fakeRequest(), emptyRouteContext)) as unknown as MockResponse & {
      status: number;
    };
    const body = await res.json();

    expect(res.status).toBe(500);
    // The database branch already sanitises, so this proves the pipeline
    // reaches the mapper's typed branches rather than short-circuiting them.
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
    expect(JSON.stringify(body)).not.toContain('prisma.tenant.findUnique');
  });

  it('logs a typed pre-handler failure at its status level rather than as an error', async () => {
    const { NotFoundError } = await import('@/lib/api/errors');
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockRejectedValue(new NotFoundError('Tenant not found'));

    await withTenantAuth(jest.fn())(fakeRequest(), emptyRouteContext);

    // A 404 is not an error-level event; executeHandler already picks its
    // level from the mapped status and this boundary must match.
    expect(mockApiLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 404 }),
      'Request failed before the handler ran',
    );
  });

  it('keeps the deliberate mapping for a typed error thrown before the handler', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockRejectedValue(new NotFoundError('Tenant not found'));

    const res = (await withTenantAuth(jest.fn())(fakeRequest(), emptyRouteContext)) as unknown as MockResponse & {
      status: number;
    };
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Tenant not found' });
  });

  it('leaves the explicit 401 and 403 returns untouched', async () => {
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue(null);

    const res = (await withTenantAuth(jest.fn())(fakeRequest(), emptyRouteContext)) as unknown as MockResponse & {
      status: number;
    };

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'No tenant found for user' });
  });

  it('returns the canned envelope when bearer token validation throws', async () => {
    mockTenantMode = 'closed';
    mockAuth.mockResolvedValue(null);
    mockExtractBearerToken.mockReturnValue('token-1');
    mockValidateServiceAccountToken.mockRejectedValue(new Error(SENTINEL));

    const res = (await withTenantAuth(jest.fn())(
      fakeRequest('GET', { authorization: 'Bearer token-1' }),
      emptyRouteContext,
    )) as unknown as MockResponse & { status: number };

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'An unexpected error has occurred.' });
  });

  it('returns the canned envelope when closed-mode tenant resolution throws on the bearer path', async () => {
    mockTenantMode = 'closed';
    mockAuth.mockResolvedValue(null);
    mockExtractBearerToken.mockReturnValue('token-1');
    mockValidateServiceAccountToken.mockResolvedValue({ valid: true, payload: { sub: 'sub-1' } });
    mockExtractGroupClaim.mockReturnValue('group-1');
    mockResolveClosedModeTenant.mockRejectedValue(new Error(SENTINEL));

    const res = (await withTenantAuth(jest.fn())(
      fakeRequest('GET', { authorization: 'Bearer token-1' }),
      emptyRouteContext,
    )) as unknown as MockResponse & { status: number };

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'An unexpected error has occurred.' });
  });

  it('returns the canned envelope when re-linking the user to a changed tenant throws', async () => {
    mockTenantMode = 'closed';
    mockAuth.mockResolvedValue({ user: { id: 'user-1' }, group_claim: 'group-1' });
    mockPrismaTenant.findUnique.mockResolvedValue({ id: 'tenant-2' });
    mockPrismaUser.findUnique.mockResolvedValue({ tenantId: 'tenant-1' });
    mockPrismaUser.update.mockRejectedValue(new Error(SENTINEL));

    const res = (await withTenantAuth(jest.fn())(fakeRequest(), emptyRouteContext)) as unknown as MockResponse & {
      status: number;
    };

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'An unexpected error has occurred.' });
    expect(mockPrismaUser.update).toHaveBeenCalled();
  });

  it('answers rather than escaping when the tenant-config read throws, redacting the offending value', async () => {
    // Invalid configuration fails at module import in production (auth.config.ts
    // reads it at module scope), so this pins the boundary's handling of a
    // throw from that position rather than a reachable TENANT_MODE failure.
    mockTenantMode = 'invalid';

    const res = (await withTenantAuth(jest.fn())(fakeRequest(), emptyRouteContext)) as unknown as MockResponse & {
      status: number;
    };
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
    expect(JSON.stringify(body)).not.toContain('TENANT_MODE');
  });

  it('answers rather than escaping when the request URL cannot be parsed', async () => {
    const malformed = {
      method: 'GET',
      url: 'not a url',
      headers: { get: () => null },
    } as unknown as Request;

    const res = (await withTenantAuth(jest.fn())(malformed, emptyRouteContext)) as unknown as MockResponse & {
      status: number;
    };

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'An unexpected error has occurred.' });
  });

  it('answers rather than escaping when establishing the request context itself throws', async () => {
    mockRunWithRequestContext.mockImplementation(() => {
      throw new Error(SENTINEL);
    });

    const res = (await withTenantAuth(jest.fn())(fakeRequest(), emptyRouteContext)) as unknown as MockResponse & {
      status: number;
    };
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
    // No correlation id exists at this point, so the outer boundary logs
    // directly rather than relying on the request context.
    expect(JSON.stringify(body)).not.toContain('postgres://');
  });

  it('lets a Next control-flow throw escape the outer boundary too', async () => {
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' });
    mockRunWithRequestContext.mockImplementation(() => {
      throw redirectError;
    });

    await expect(withTenantAuth(jest.fn())(fakeRequest(), emptyRouteContext)).rejects.toBe(redirectError);
  });

  it('lets Next control-flow throws propagate rather than mapping them to a 500', async () => {
    // NEXT_REDIRECT is how Next signals redirect(); unstable_rethrow must let it pass.
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' });
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockRejectedValue(redirectError);

    await expect(withTenantAuth(jest.fn())(fakeRequest(), emptyRouteContext)).rejects.toBe(redirectError);
  });

  it('lets a Next control-flow throw from inside the handler propagate too', async () => {
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' });
    mockGetSessionUserId.mockResolvedValue('user-1');
    mockGetTenantId.mockResolvedValue('tenant-1');

    await expect(
      withTenantAuth(jest.fn().mockRejectedValue(redirectError))(fakeRequest(), emptyRouteContext),
    ).rejects.toBe(redirectError);
  });
});

describe('handleRouteError', () => {
  it('maps ValidationError to 400', async () => {
    const res = handleRouteError(new ValidationError('bad input'));
    expect(res.status).toBe(400);
    const body = await (res as unknown as MockResponse).json();
    expect(body.error).toBe('bad input');
  });

  it('maps NotFoundError to 404', async () => {
    const res = handleRouteError(new NotFoundError('missing'));
    expect(res.status).toBe(404);
    const body = await (res as unknown as MockResponse).json();
    expect(body.error).toBe('missing');
  });

  it('maps ServiceRegistryError to 500', async () => {
    const res = handleRouteError(new ServiceRegistryError('config bad'));
    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body.error).toBe('config bad');
  });

  it('maps ServiceError to its statusCode with code', async () => {
    const res = handleRouteError(new ServiceError('upstream fail', 'TEST_ERR', 502));
    expect(res.status).toBe(502);
    const body = await (res as unknown as MockResponse).json();
    expect(body.error).toBe('upstream fail');
    expect(body.code).toBe('TEST_ERR');
  });

  it('maps unknown errors to 500', async () => {
    const res = handleRouteError(new Error('kaboom'));
    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body.error).toBe('kaboom');
  });
});
