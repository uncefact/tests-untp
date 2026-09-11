import type { LoggerService } from '@uncefact/untp-ri-services/logging';

const mockValidateConfiguredEncryptionKey = jest.fn(async () => undefined);
const mockStartJobQueue = jest.fn(async () => ({}));
const mockStartSeededSchemeRefreshInterval = jest.fn();
jest.mock('@/lib/api/logger');
const mockApiLoggerWarn = (jest.requireMock('@/lib/api/logger').apiLogger as Record<string, jest.Mock>).warn;

jest.mock('@/lib/encryption/encryption-key-boot', () => ({
  validateConfiguredEncryptionKey: mockValidateConfiguredEncryptionKey,
}));
jest.mock('@/lib/jobs/app-job-queue', () => ({
  startJobQueue: () => mockStartJobQueue(),
  stopJobQueue: jest.fn(async () => undefined),
}));
jest.mock('@/lib/cvc/seeded-refresh-interval', () => ({
  resolveRefreshIntervalHours: jest.fn(() => 24),
  startSeededSchemeRefreshInterval: (...args: unknown[]) => mockStartSeededSchemeRefreshInterval(...args),
}));
jest.mock('@/lib/api/pagination', () => ({ warnOnRejectedMaxPageLimitOverride: jest.fn() }));
jest.mock('@/lib/api/batch-limits', () => ({ warnOnRejectedMaxBatchLimitOverride: jest.fn() }));
jest.mock('@/lib/observability/instrumentations', () => ({ buildInstrumentations: () => [] }));
jest.mock('@/lib/observability/resource', () => ({
  buildResource: () => ({}),
  resolveServiceName: () => 'resolved-service-name',
}));
jest.mock('@opentelemetry/exporter-trace-otlp-grpc', () => ({ OTLPTraceExporter: jest.fn() }));
jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: function MockNodeSDK() {
    return { start: jest.fn(), shutdown: jest.fn() };
  },
}));

import { registerNode } from './instrumentation.node';
import { runBootPreflight } from './boot/boot-preflight';

const KEY = 'a'.repeat(64);
const ENV_NAMES = ['RI_APP_URL', 'DATA_ENCRYPTION_KEY', 'VERIFY_ALLOW_PRIVATE_URLS'] as const;
const savedEnvironment = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));

function createLogger(): LoggerService {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  } as unknown as LoggerService;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const name of ENV_NAMES) delete process.env[name];
  process.env.RI_APP_URL = 'https://ri.example.com';
  process.env.DATA_ENCRYPTION_KEY = KEY;
  process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
  mockStartJobQueue.mockResolvedValue({});
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = savedEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

it('logs the deprecated fetch warning in the server-start path after preflight succeeds', async () => {
  const warning =
    'VERIFY_ALLOW_PRIVATE_URLS was renamed to FETCH_ALLOW_PRIVATE_URLS in v0.5 and will stop being read in v0.6. Rename VERIFY_ALLOW_PRIVATE_URLS to FETCH_ALLOW_PRIVATE_URLS, keeping its value, and restart.';

  await expect(runBootPreflight('web', createLogger())).resolves.toMatchObject({ key: KEY });
  mockApiLoggerWarn.mockClear();

  await registerNode();

  expect(mockApiLoggerWarn).toHaveBeenCalledWith(warning);
});
