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
const mockValidateBundledArtefactsFallbackOnBoot = jest.fn();
const mockValidateStaleClaimOnBoot = jest.fn();
const mockValidateMaxRequestBodyBytesOnBoot = jest.fn();
const mockApiLoggerWarn = jest.fn();

jest.mock('@/lib/config/app-url.config', () => ({
  resolveAppUrl: (...args: unknown[]) => mockResolveAppUrl(...args),
}));
jest.mock('@/lib/config/http-user-agent.config', () => ({
  validateHttpUserAgentOnBoot: (...args: unknown[]) => mockValidateHttpUserAgentOnBoot(...args),
}));
jest.mock('@/lib/config/cache-max-entries.config', () => ({
  validateCacheMaxEntriesOnBoot: (...args: unknown[]) => mockValidateCacheMaxEntriesOnBoot(...args),
}));

jest.mock('@/lib/config/bundled-artefacts-fallback.config', () => ({
  validateBundledArtefactsFallbackOnBoot: (...args: unknown[]) => mockValidateBundledArtefactsFallbackOnBoot(...args),
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
const mockWarnOnRejectedMaxBatchLimitOverride = jest.fn();
jest.mock('@/lib/api/batch-limits', () => ({
  warnOnRejectedMaxBatchLimitOverride: (...args: unknown[]) => mockWarnOnRejectedMaxBatchLimitOverride(...args),
}));
const mockStartJobQueue = jest.fn(async () => ({}));
jest.mock('@/lib/jobs/app-job-queue', () => ({
  startJobQueue: () => mockStartJobQueue(),
  stopJobQueue: jest.fn(async () => undefined),
}));
jest.mock('@/lib/cvc/seeded-refresh-interval', () => ({ startSeededSchemeRefreshInterval: jest.fn() }));
jest.mock('@/lib/api/logger', () => ({
  apiLogger: {
    warn: (...args: unknown[]) => mockApiLoggerWarn(...args),
    child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  },
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

const FETCH_ENV_NAMES = [
  'FETCH_ALLOW_PRIVATE_URLS',
  'VERIFY_ALLOW_PRIVATE_URLS',
  'FETCH_MAX_RESPONSE_SIZE',
  'VERIFY_MAX_CREDENTIAL_SIZE',
  'FETCH_TIMEOUT_MS',
  'VERIFY_FETCH_TIMEOUT_MS',
] as const;
const originalFetchEnvironment = Object.fromEntries(FETCH_ENV_NAMES.map((name) => [name, process.env[name]]));

beforeEach(() => {
  jest.clearAllMocks();
  for (const name of FETCH_ENV_NAMES) delete process.env[name];
  mockResolveAppUrl.mockReset();
  mockValidateHttpUserAgentOnBoot.mockReset();
  mockValidateCacheMaxEntriesOnBoot.mockReset();
  mockValidateBundledArtefactsFallbackOnBoot.mockReset();
  mockValidateStaleClaimOnBoot.mockReset();
  mockValidateMaxRequestBodyBytesOnBoot.mockReset();
  mockResolveDataEncryptionKey.mockReset();
  mockResolveDataEncryptionKey.mockReturnValue({ key: undefined });
});

afterEach(() => {
  for (const name of FETCH_ENV_NAMES) {
    const value = originalFetchEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
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

    expect(mockValidateBundledArtefactsFallbackOnBoot).toHaveBeenCalledTimes(1);
    expect(mockValidateStaleClaimOnBoot).toHaveBeenCalledTimes(1);
    expect(mockValidateMaxRequestBodyBytesOnBoot).toHaveBeenCalledTimes(1);
    expect(mockApiLoggerWarn).not.toHaveBeenCalled();
    expect(mockWarnOnRejectedMaxBatchLimitOverride).toHaveBeenCalledTimes(1);
  });

  it('validates an old-only setting and emits its exact deprecation warning before queue startup', async () => {
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';

    await registerNode();

    expect(mockApiLoggerWarn).toHaveBeenCalledWith(
      'VERIFY_ALLOW_PRIVATE_URLS was renamed to FETCH_ALLOW_PRIVATE_URLS in v0.5 and will stop being read in v0.6. Rename VERIFY_ALLOW_PRIVATE_URLS to FETCH_ALLOW_PRIVATE_URLS, keeping its value, and restart.',
    );
    expect(mockStartJobQueue).toHaveBeenCalledTimes(1);
  });

  it('starts the job queue before serving', async () => {
    await registerNode();

    expect(mockStartJobQueue).toHaveBeenCalledTimes(1);
  });

  it('fails the boot when the job queue cannot start', async () => {
    mockStartJobQueue.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(registerNode()).rejects.toThrow('ECONNREFUSED');
    expect(mockNodeSDK).not.toHaveBeenCalled();
  });

  it('fails the boot when a request-body cap override is invalid', async () => {
    mockValidateMaxRequestBodyBytesOnBoot.mockImplementation(() => {
      throw new Error('MAX_REQUEST_BODY_BYTES must be an integer of at least 1024 when set');
    });

    await expect(registerNode()).rejects.toThrow('MAX_REQUEST_BODY_BYTES');
  });

  it('fails the boot when the credential fetch timeout override is invalid', async () => {
    process.env.FETCH_TIMEOUT_MS = '1.5';

    await expect(registerNode()).rejects.toThrow(
      'FETCH_TIMEOUT_MS must be a positive integer number of milliseconds no greater than 120000 when set; fix or unset it (unset uses 10000).',
    );
    expect(mockStartJobQueue).not.toHaveBeenCalled();
  });

  it.each([
    [
      'boolean',
      'VERIFY_ALLOW_PRIVATE_URLS',
      'FETCH_ALLOW_PRIVATE_URLS',
      'VERIFY_ALLOW_PRIVATE_URLS and FETCH_ALLOW_PRIVATE_URLS are both set. VERIFY_ALLOW_PRIVATE_URLS was renamed to FETCH_ALLOW_PRIVATE_URLS in v0.5. Set FETCH_ALLOW_PRIVATE_URLS to the value you intend, remove VERIFY_ALLOW_PRIVATE_URLS, and restart.',
    ],
    [
      'size',
      'VERIFY_MAX_CREDENTIAL_SIZE',
      'FETCH_MAX_RESPONSE_SIZE',
      'VERIFY_MAX_CREDENTIAL_SIZE and FETCH_MAX_RESPONSE_SIZE are both set. VERIFY_MAX_CREDENTIAL_SIZE was renamed to FETCH_MAX_RESPONSE_SIZE in v0.5. Set FETCH_MAX_RESPONSE_SIZE to the value you intend, remove VERIFY_MAX_CREDENTIAL_SIZE, and restart.',
    ],
    [
      'timeout',
      'VERIFY_FETCH_TIMEOUT_MS',
      'FETCH_TIMEOUT_MS',
      'VERIFY_FETCH_TIMEOUT_MS and FETCH_TIMEOUT_MS are both set. VERIFY_FETCH_TIMEOUT_MS was renamed to FETCH_TIMEOUT_MS in v0.5. Set FETCH_TIMEOUT_MS to the value you intend, remove VERIFY_FETCH_TIMEOUT_MS, and restart.',
    ],
  ])(
    'fails before encryption, queue and telemetry when both %s names are set',
    async (_label, oldName, newName, message) => {
      process.env[oldName] = 'true';
      process.env[newName] = 'true';

      await expect(registerNode()).rejects.toThrow(message);
      expect(mockResolveDataEncryptionKey).not.toHaveBeenCalled();
      expect(mockStartJobQueue).not.toHaveBeenCalled();
      expect(mockNodeSDK).not.toHaveBeenCalled();
    },
  );

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

  it('fails the boot when the encryption key resolver throws (stale SERVICE_ENCRYPTION_KEY)', async () => {
    // jest.clearAllMocks() in beforeEach keeps implementations, so drop the
    // earlier tests' throwing validators before arming this one.
    mockResolveAppUrl.mockReset();
    mockValidateHttpUserAgentOnBoot.mockReset();
    mockValidateMaxRequestBodyBytesOnBoot.mockReset();
    mockValidateCacheMaxEntriesOnBoot.mockReset();
    mockValidateStaleClaimOnBoot.mockReset();
    mockResolveDataEncryptionKey.mockImplementation(() => {
      throw new Error('SERVICE_ENCRYPTION_KEY is set but is no longer read');
    });

    await expect(registerNode()).rejects.toThrow('SERVICE_ENCRYPTION_KEY');
  });
});
