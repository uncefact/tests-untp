/**
 * Wiring tests for the Node boot sequence. The shared preflight owns the
 * individual configuration validators; this suite checks that the server
 * keeps the database-backed key check and queue startup after it.
 */
type PreflightResult = { key: string | undefined; deprecatedName: 'absent' | 'stale' };
const mockRunBootPreflight = jest.fn<Promise<PreflightResult>, []>(async () => ({
  key: undefined,
  deprecatedName: 'absent',
}));
const mockValidateConfiguredEncryptionKey = jest.fn(async () => undefined);
const mockStartJobQueue = jest.fn(async () => ({}));
const mockStartSeededSchemeRefreshInterval = jest.fn();
const mockWarnOnRejectedMaxBatchLimitOverride = jest.fn();

jest.mock('./boot/boot-preflight', () => ({
  runBootPreflight: (...args: unknown[]) => mockRunBootPreflight(...(args as [])),
}));
jest.mock('@/lib/encryption/encryption-key-boot', () => ({
  validateConfiguredEncryptionKey: mockValidateConfiguredEncryptionKey,
}));
jest.mock('@/lib/api/pagination', () => ({ warnOnRejectedMaxPageLimitOverride: jest.fn() }));
jest.mock('@/lib/api/batch-limits', () => ({
  warnOnRejectedMaxBatchLimitOverride: (...args: unknown[]) => mockWarnOnRejectedMaxBatchLimitOverride(...args),
}));
jest.mock('@/lib/jobs/app-job-queue', () => ({
  startJobQueue: () => mockStartJobQueue(),
  stopJobQueue: jest.fn(async () => undefined),
}));
jest.mock('@/lib/cvc/seeded-refresh-interval', () => ({
  startSeededSchemeRefreshInterval: (...args: unknown[]) => mockStartSeededSchemeRefreshInterval(...args),
}));
jest.mock('@/lib/api/logger');
const mockApiLoggerWarn = (jest.requireMock('@/lib/api/logger').apiLogger as Record<string, jest.Mock>).warn;
jest.mock('@/lib/observability/instrumentations', () => ({ buildInstrumentations: () => [] }));
jest.mock('@/lib/observability/resource', () => ({
  buildResource: () => ({}),
  resolveServiceName: () => 'resolved-service-name',
}));
jest.mock('@opentelemetry/exporter-trace-otlp-grpc', () => ({ OTLPTraceExporter: jest.fn() }));
const mockNodeSDK = jest.fn().mockImplementation(() => ({ start: jest.fn(), shutdown: jest.fn() }));
jest.mock('@opentelemetry/sdk-node', () => ({
  // A plain function, not an arrow, so `new NodeSDK(...)` is constructible.
  NodeSDK: function MockNodeSDK(...args: unknown[]) {
    return mockNodeSDK(...args);
  },
}));

import { registerNode } from './instrumentation.node';

const KEY = 'a'.repeat(64);

beforeEach(() => {
  jest.clearAllMocks();
  mockRunBootPreflight.mockResolvedValue({ key: undefined, deprecatedName: 'absent' });
  mockStartJobQueue.mockResolvedValue({});
});

describe('registerNode boot wiring', () => {
  it('runs the shared web preflight before the database-backed key check and queue', async () => {
    mockRunBootPreflight.mockResolvedValue({ key: KEY, deprecatedName: 'absent' });

    await registerNode();

    expect(mockRunBootPreflight).toHaveBeenCalledWith('web', expect.any(Object));
    expect(mockValidateConfiguredEncryptionKey).toHaveBeenCalledWith(KEY);
    expect(mockStartJobQueue).toHaveBeenCalledTimes(1);
    expect(mockNodeSDK).toHaveBeenCalledWith(expect.objectContaining({ serviceName: 'resolved-service-name' }));
    expect(mockStartSeededSchemeRefreshInterval).toHaveBeenCalledTimes(1);
    expect(mockStartSeededSchemeRefreshInterval).toHaveBeenCalledWith(expect.any(Object));
  });

  it('does not start the database-backed checks or telemetry when preflight refuses the boot', async () => {
    mockRunBootPreflight.mockRejectedValueOnce(new Error('RI_APP_URL is required'));

    await expect(registerNode()).rejects.toThrow('RI_APP_URL');

    expect(mockValidateConfiguredEncryptionKey).not.toHaveBeenCalled();
    expect(mockStartJobQueue).not.toHaveBeenCalled();
    expect(mockNodeSDK).not.toHaveBeenCalled();
  });

  it('keeps the existing keyless web behaviour after a passing preflight', async () => {
    await registerNode();

    expect(mockValidateConfiguredEncryptionKey).not.toHaveBeenCalled();
    expect(mockStartJobQueue).toHaveBeenCalledTimes(1);
    expect(mockWarnOnRejectedMaxBatchLimitOverride).toHaveBeenCalledTimes(1);
    expect(mockApiLoggerWarn).not.toHaveBeenCalled();
  });

  it('still fails when the job queue cannot start', async () => {
    mockStartJobQueue.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(registerNode()).rejects.toThrow('ECONNREFUSED');
    expect(mockNodeSDK).not.toHaveBeenCalled();
  });
});
