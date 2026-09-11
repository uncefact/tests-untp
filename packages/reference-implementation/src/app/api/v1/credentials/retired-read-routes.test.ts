jest.mock('next/server', () => {
  const { MockNextResponse } = jest.requireActual('../../../../../__tests__/route-doubles/next-response');
  return { NextResponse: MockNextResponse };
});

const mockRunWithRequestContext = jest.fn((_correlationId: string, callback: () => unknown) => callback());
const mockUpdateRequestContext = jest.fn();
// Route imports call createLogger() at import time. This mock replaces
// createLogger, isValidCorrelationId and the request-context entry points while
// retaining the rest of the real logging module.
const mockModuleLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(),
};
mockModuleLogger.child.mockReturnValue(mockModuleLogger);
jest.mock('@uncefact/untp-ri-services/logging', () => ({
  ...jest.requireActual('@uncefact/untp-ri-services/logging'),
  createLogger: () => mockModuleLogger,
  isValidCorrelationId: jest.fn(() => true),
  runWithRequestContext: (correlationId: string, callback: () => unknown) =>
    mockRunWithRequestContext(correlationId, callback),
  updateRequestContext: (...args: unknown[]) => mockUpdateRequestContext(...args),
}));

jest.mock('@/lib/api/logger');

const mockAuth = jest.fn();
jest.mock('@/auth', () => ({ auth: () => mockAuth() }));

jest.mock('@/lib/auth/tenant-config', () => ({
  getTenantConfig: () => ({ mode: 'closed', claimName: 'groups', claimFormat: 'array_first' }),
}));

const mockExtractBearerToken = jest.fn();
const mockValidateServiceAccountToken = jest.fn();
jest.mock('@/lib/auth/token-validator', () => ({
  extractBearerToken: (...args: unknown[]) => mockExtractBearerToken(...args),
  validateServiceAccountToken: (...args: unknown[]) => mockValidateServiceAccountToken(...args),
}));

const mockExtractGroupClaim = jest.fn();
jest.mock('@/lib/auth/group-claim', () => ({
  extractGroupClaim: (...args: unknown[]) => mockExtractGroupClaim(...args),
}));

const mockResolveClosedModeTenant = jest.fn();
jest.mock('@/lib/api/resolve-closed-mode-tenant', () => ({
  resolveClosedModeTenant: (...args: unknown[]) => mockResolveClosedModeTenant(...args),
}));

jest.mock('@/lib/prisma/prisma', () => ({
  prisma: { tenant: { findUnique: jest.fn() }, user: { findUnique: jest.fn(), update: jest.fn() } },
}));

const mockGetSessionUserId = jest.fn();
const mockGetTenantId = jest.fn();
jest.mock('@/lib/api/helpers', () => ({
  getSessionUserId: () => mockGetSessionUserId(),
  getTenantId: (...args: unknown[]) => mockGetTenantId(...args),
}));

jest.mock('@/lib/api/service-account-user', () => ({ resolveServiceAccountUser: jest.fn() }));

const mockRepositoryFunctions = {
  updateCredentialPublished: jest.fn(),
  getDidByDid: jest.fn(),
  getCredentialById: jest.fn(),
  listCredentials: jest.fn(),
  findConformitySchemeByCanonicalId: jest.fn(),
  claimIdempotencyKey: jest.fn(),
  completeIdempotencyKey: jest.fn(),
  findIdempotencyKey: jest.fn(),
  releaseIdempotencyKey: jest.fn(),
};
jest.mock('@/lib/prisma/repositories', () => mockRepositoryFunctions);

import { GET as listGET } from './route';
import { GET as detailGET } from './[id]/route';

function createRequest(path: string, authorization?: string): Request {
  return {
    method: 'GET',
    url: `http://localhost${path}`,
    headers: new Headers(authorization ? { authorization } : undefined),
  } as unknown as Request;
}

function routeContext(id?: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve<Record<string, string>>(id === undefined ? {} : { id }) };
}

function arrangeNoIdentity(): void {
  mockAuth.mockResolvedValue(null);
  mockExtractBearerToken.mockReturnValue(null);
}

function arrangeInvalidBearer(): void {
  mockAuth.mockResolvedValue(null);
  mockExtractBearerToken.mockReturnValue('invalid-token');
  mockValidateServiceAccountToken.mockResolvedValue({ valid: false, error: 'Token expired' });
}

function arrangeNoGroupBearer(): void {
  mockAuth.mockResolvedValue(null);
  mockExtractBearerToken.mockReturnValue('valid-token');
  mockValidateServiceAccountToken.mockResolvedValue({ valid: true, payload: { sub: 'subject-1' } });
  mockExtractGroupClaim.mockReturnValue(null);
}

function arrangeTenantResolvedBearer(): void {
  mockAuth.mockResolvedValue(null);
  mockExtractBearerToken.mockReturnValue('valid-token');
  mockValidateServiceAccountToken.mockResolvedValue({ valid: true, payload: { sub: 'subject-1' } });
  mockExtractGroupClaim.mockReturnValue('/acme');
  mockResolveClosedModeTenant.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1' });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRunWithRequestContext.mockImplementation((_correlationId: string, callback: () => unknown) => callback());
});

describe('retired list route through withTenantAuth', () => {
  it('keeps a request with no identity at 401', async () => {
    arrangeNoIdentity();
    const response = await listGET(createRequest('/api/v1/credentials'), routeContext());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorised' });
  });

  it('keeps a request with an invalid bearer at 401', async () => {
    arrangeInvalidBearer();
    const response = await listGET(createRequest('/api/v1/credentials', 'Bearer invalid-token'), routeContext());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorised' });
  });

  it('keeps an authenticated bearer without a group at 403', async () => {
    arrangeNoGroupBearer();
    const response = await listGET(createRequest('/api/v1/credentials', 'Bearer valid-token'), routeContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'No group assignment found in token' });
  });

  it('returns the exact retirement response after tenant resolution', async () => {
    arrangeTenantResolvedBearer();
    const response = await listGET(createRequest('/api/v1/credentials?limit=0', 'Bearer valid-token'), routeContext());

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'This route has been retired. Use GET /api/v1/library instead.',
      code: 'ROUTE_RETIRED',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    // These guards prevent a handler change from reintroducing the repository read.
    expect(mockRepositoryFunctions.getCredentialById).not.toHaveBeenCalled();
    expect(mockRepositoryFunctions.listCredentials).not.toHaveBeenCalled();
  });
});

describe('retired detail route through withTenantAuth', () => {
  it('keeps a request with no identity at 401', async () => {
    arrangeNoIdentity();
    const response = await detailGET(createRequest('/api/v1/credentials/first-id'), routeContext('first-id'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorised' });
  });

  it('keeps a request with an invalid bearer at 401', async () => {
    arrangeInvalidBearer();
    const response = await detailGET(
      createRequest('/api/v1/credentials/second-id', 'Bearer invalid-token'),
      routeContext('second-id'),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorised' });
  });

  it('keeps an authenticated bearer without a group at 403', async () => {
    arrangeNoGroupBearer();
    const response = await detailGET(
      createRequest('/api/v1/credentials/does-not-exist', 'Bearer valid-token'),
      routeContext('does-not-exist'),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'No group assignment found in token' });
  });

  it('returns the exact retirement response after tenant resolution without looking up the id', async () => {
    arrangeTenantResolvedBearer();
    const response = await detailGET(
      createRequest('/api/v1/credentials/does-not-exist', 'Bearer valid-token'),
      routeContext('does-not-exist'),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'This route has been retired. Use GET /api/v1/library/{id} instead.',
      code: 'ROUTE_RETIRED',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mockRepositoryFunctions.getCredentialById).not.toHaveBeenCalled();
    expect(mockRepositoryFunctions.listCredentials).not.toHaveBeenCalled();
  });
});
