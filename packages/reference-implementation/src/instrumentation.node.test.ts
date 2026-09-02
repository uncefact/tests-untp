/**
 * Wiring tests for the boot sequence: the per-check validators each have
 * their own unit suites, but nothing else asserts that registerNode actually
 * invokes them, so any of the calls could be deleted with every other suite
 * staying green. These tests pin the wiring and that a validator failure
 * fails the boot instead of being swallowed.
 */
const mockResolveAppUrl = jest.fn();
const mockValidateHttpUserAgentOnBoot = jest.fn();
const mockResolveDataEncryptionKey = jest.fn();
const mockValidateCacheMaxEntriesOnBoot = jest.fn();
const mockValidateStaleClaimOnBoot = jest.fn();
const mockValidateMaxRequestBodyBytesOnBoot = jest.fn();

jest.mock('@/lib/config/app-url.config', () => ({
  resolveAppUrl: (...args: unknown[]) => mockResolveAppUrl(...args),
}));
jest.mock('@/lib/config/http-user-agent.config', () => ({
  validateHttpUserAgentOnBoot: (...args: unknown[]) => mockValidateHttpUserAgentOnBoot(...args),
}));
jest.mock('@/lib/config/cache-max-entries.config', () => ({
  validateCacheMaxEntriesOnBoot: (...args: unknown[]) => mockValidateCacheMaxEntriesOnBoot(...args),
}));
jest.mock('@/lib/config/idempotency-claim.config', () => ({
  validateStaleClaimOnBoot: (...args: unknown[]) => mockValidateStaleClaimOnBoot(...args),
}));
jest.mock('@/lib/config/request-body-limit.config', () => ({
  validateMaxRequestBodyBytesOnBoot: (...args: unknown[]) => mockValidateMaxRequestBodyBytesOnBoot(...args),
}));
jest.mock('@/lib/encryption/resolve-data-encryption-key', () => ({
  resolveDataEncryptionKey: (...args: unknown[]) => mockResolveDataEncryptionKey(...args),
}));
jest.mock('@/lib/encryption/encryption', () => ({ getEncryptionService: jest.fn() }));
jest.mock('@/lib/prisma/prisma', () => ({ prisma: {} }));
jest.mock('@/lib/credentials/validate-encryption-key-startup', () => ({
  assertNotPlaceholderEncryptionKey: jest.fn(),
  validateEncryptionKeyAtStartup: jest.fn(),
}));
jest.mock('@/lib/api/pagination', () => ({ warnOnRejectedMaxPageLimitOverride: jest.fn() }));
jest.mock('@/lib/cvc/seeded-refresh-interval', () => ({ startSeededSchemeRefreshInterval: jest.fn() }));
jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
}));
jest.mock('@/lib/observability/instrumentations', () => ({ buildInstrumentations: () => [] }));
jest.mock('@/lib/observability/resource', () => ({
  buildResource: () => ({}),
  resolveServiceName: () => 'resolved-service-name',
}));
jest.mock('@opentelemetry/exporter-trace-otlp-grpc', () => ({ OTLPTraceExporter: jest.fn() }));
const mockNodeSDK = jest.fn().mockImplementation(() => ({ start: jest.fn(), shutdown: jest.fn() }));
jest.mock('@opentelemetry/sdk-node', () => ({
  // A plain function, not an arrow, so `new NodeSDK(...)` in the module under
  // test is constructible; the returned object replaces `this`.
  NodeSDK: function MockNodeSDK(...args: unknown[]) {
    return mockNodeSDK(...args);
  },
}));

import { registerNode } from './instrumentation.node';

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveDataEncryptionKey.mockReturnValue({ key: undefined });
});

describe('registerNode boot wiring', () => {
  it('passes the resolved service name to the NodeSDK, where it is merged after resource detection', async () => {
    await registerNode();

    expect(mockNodeSDK).toHaveBeenCalledWith(expect.objectContaining({ serviceName: 'resolved-service-name' }));
  });

  it('runs every boot validation: app URL, HTTP User-Agent, encryption key', async () => {
    await registerNode();

    const { startSeededSchemeRefreshInterval } = jest.requireMock('@/lib/cvc/seeded-refresh-interval');
    expect(startSeededSchemeRefreshInterval).toHaveBeenCalledTimes(1);

    expect(mockResolveAppUrl).toHaveBeenCalledTimes(1);
    expect(mockValidateHttpUserAgentOnBoot).toHaveBeenCalledTimes(1);
    expect(mockResolveDataEncryptionKey).toHaveBeenCalledTimes(1);
    expect(mockValidateCacheMaxEntriesOnBoot).toHaveBeenCalledTimes(1);
    expect(mockValidateStaleClaimOnBoot).toHaveBeenCalledTimes(1);
    expect(mockValidateMaxRequestBodyBytesOnBoot).toHaveBeenCalledTimes(1);
  });

  it('fails the boot when a request-body cap override is invalid', async () => {
    mockValidateMaxRequestBodyBytesOnBoot.mockImplementation(() => {
      throw new Error('MAX_REQUEST_BODY_BYTES must be an integer of at least 1024 when set');
    });

    await expect(registerNode()).rejects.toThrow('MAX_REQUEST_BODY_BYTES');
  });

  it('fails the boot when a cache entry-cap override is invalid', async () => {
    mockValidateCacheMaxEntriesOnBoot.mockImplementation(() => {
      throw new Error('CACHE_MAX_ENTRIES must be a positive integer when set');
    });

    await expect(registerNode()).rejects.toThrow('CACHE_MAX_ENTRIES');
  });

  it('fails the boot when the User-Agent validation throws', async () => {
    mockValidateHttpUserAgentOnBoot.mockImplementation(() => {
      throw new Error('RI_HTTP_USER_AGENT is not a valid HTTP User-Agent value');
    });

    await expect(registerNode()).rejects.toThrow('RI_HTTP_USER_AGENT');
  });

  it('fails the boot when the app URL validation throws', async () => {
    mockResolveAppUrl.mockImplementation(() => {
      throw new Error('RI_APP_URL is required.');
    });

    await expect(registerNode()).rejects.toThrow('RI_APP_URL');
    expect(mockValidateHttpUserAgentOnBoot).not.toHaveBeenCalled();
  });
});
