/**
 * @jest-environment node
 */
import type { LoggerService } from '@uncefact/untp-ri-services/logging';
import { describeBootError } from './describe-boot-error';
import { resolveBootProcessRole, runBootPreflight } from './boot-preflight';
import { buildNodeSdk } from '../lib/observability/start-sdk';
import { WorkerBootError } from '../worker/errors';
import { formatWorkerBootFailure } from '../worker/format-boot-failure';

const KEY = 'a'.repeat(64);
const ENV_NAMES = [
  'RI_APP_URL',
  'RI_HTTP_USER_AGENT',
  'CACHE_MAX_ENTRIES',
  'BUNDLED_ARTEFACTS_FALLBACK',
  'IDEMPOTENCY_STALE_CLAIM_MINUTES',
  'MAX_REQUEST_BODY_BYTES',
  'FETCH_ALLOW_PRIVATE_URLS',
  'VERIFY_ALLOW_PRIVATE_URLS',
  'FETCH_MAX_RESPONSE_SIZE',
  'VERIFY_MAX_CREDENTIAL_SIZE',
  'FETCH_TIMEOUT_MS',
  'VERIFY_FETCH_TIMEOUT_MS',
  'CVC_REFRESH_INTERVAL_HOURS',
  'DATA_ENCRYPTION_KEY',
  'SERVICE_ENCRYPTION_KEY',
  'WORKER_JOB_TIMEOUT_SECONDS',
  'LIBRARY_RECONCILE_PENDING_RUNS_CRON',
  'LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE',
  'LOG_REDACT_PATHS',
  'DEPLOYMENT_ENVIRONMENT',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'RI_PROCESS_ROLE',
] as const;
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

function setWorkerEnvironment(): void {
  process.env.DATA_ENCRYPTION_KEY = KEY;
}

beforeEach(() => {
  for (const name of ENV_NAMES) delete process.env[name];
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = savedEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('runBootPreflight', () => {
  it('accepts a valid web environment and returns the resolved key for the later database check', async () => {
    process.env.RI_APP_URL = 'https://ri.example.com';
    process.env.DATA_ENCRYPTION_KEY = KEY;

    await expect(runBootPreflight('web', createLogger())).resolves.toEqual({
      key: KEY,
      deprecatedName: 'absent',
    });
  });

  it('accepts a worker without web-only settings while checking its own required settings', async () => {
    setWorkerEnvironment();
    process.env.RI_APP_URL = 'not a url';
    process.env.MAX_REQUEST_BODY_BYTES = '100';
    process.env.IDEMPOTENCY_STALE_CLAIM_MINUTES = '0';

    await expect(runBootPreflight('worker', createLogger())).resolves.toEqual({
      key: KEY,
      deprecatedName: 'absent',
      workerConfiguration: { reconciliationCron: '*/10 * * * *', jobTimeoutSeconds: 300 },
    });
  });

  it('rejects a fetch-setting name conflict for the web role', async () => {
    process.env.RI_APP_URL = 'https://ri.example.com';
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    process.env.FETCH_ALLOW_PRIVATE_URLS = 'true';

    await expect(runBootPreflight('web', createLogger())).rejects.toThrow(
      'VERIFY_ALLOW_PRIVATE_URLS and FETCH_ALLOW_PRIVATE_URLS are both set. VERIFY_ALLOW_PRIVATE_URLS was renamed to FETCH_ALLOW_PRIVATE_URLS in v0.5. Set FETCH_ALLOW_PRIVATE_URLS to the value you intend, remove VERIFY_ALLOW_PRIVATE_URLS, and restart.',
    );
  });

  it.each([
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
  ])('rejects a fetch-setting %s alias conflict for the web role', async (_label, oldName, newName, message) => {
    process.env.RI_APP_URL = 'https://ri.example.com';
    process.env[oldName] = 'true';
    process.env[newName] = 'true';

    await expect(runBootPreflight('web', createLogger())).rejects.toThrow(message);
  });

  it('rejects an invalid caller fetch timeout for the web role', async () => {
    process.env.RI_APP_URL = 'https://ri.example.com';
    process.env.FETCH_TIMEOUT_MS = '1.5';

    await expect(runBootPreflight('web', createLogger())).rejects.toThrow(
      'FETCH_TIMEOUT_MS must be a positive integer number of milliseconds no greater than 120000 when set; fix or unset it (unset uses 10000).',
    );
  });

  it('accepts the host-and-port endpoint form accepted by the OTLP gRPC exporter', async () => {
    process.env.RI_APP_URL = 'https://ri.example.com';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '127.0.0.1:4317';

    await expect(runBootPreflight('web', createLogger())).resolves.toMatchObject({ deprecatedName: 'absent' });
  });

  it('constructs the shared SDK without opening an active resource', () => {
    const before = process.getActiveResourcesInfo();

    buildNodeSdk({ serviceName: 'boot-preflight-test' });

    expect(process.getActiveResourcesInfo()).toEqual(before);
  });

  it('does not apply caller-supplied fetch settings to the worker role', async () => {
    setWorkerEnvironment();
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    process.env.FETCH_ALLOW_PRIVATE_URLS = 'true';
    process.env.FETCH_TIMEOUT_MS = '0';

    await expect(runBootPreflight('worker', createLogger())).resolves.toMatchObject({ key: KEY });
  });

  it('accepts the deprecated fetch name and emits its existing warning', async () => {
    process.env.RI_APP_URL = 'https://ri.example.com';
    process.env.DATA_ENCRYPTION_KEY = KEY;
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    const logger = createLogger();

    await expect(runBootPreflight('web', logger)).resolves.toMatchObject({ key: KEY });
    expect(logger.warn).toHaveBeenCalledWith(
      'VERIFY_ALLOW_PRIVATE_URLS was renamed to FETCH_ALLOW_PRIVATE_URLS in v0.5 and will stop being read in v0.6. Rename VERIFY_ALLOW_PRIVATE_URLS to FETCH_ALLOW_PRIVATE_URLS, keeping its value, and restart.',
    );
  });

  it('logs the deprecated fetch name again when the server starts after a successful preflight', async () => {
    process.env.RI_APP_URL = 'https://ri.example.com';
    process.env.DATA_ENCRYPTION_KEY = KEY;
    process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    const preflightLogger = createLogger();
    const serverLogger = createLogger();

    await expect(runBootPreflight('web', preflightLogger)).resolves.toMatchObject({ key: KEY });
    await expect(runBootPreflight('web', serverLogger)).resolves.toMatchObject({ key: KEY });

    const warning =
      'VERIFY_ALLOW_PRIVATE_URLS was renamed to FETCH_ALLOW_PRIVATE_URLS in v0.5 and will stop being read in v0.6. Rename VERIFY_ALLOW_PRIVATE_URLS to FETCH_ALLOW_PRIVATE_URLS, keeping its value, and restart.';
    expect(preflightLogger.warn).toHaveBeenCalledWith(warning);
    expect(serverLogger.warn).toHaveBeenCalledWith(warning);
  });

  it.each(['web', 'worker'] as const)('rejects an out-of-range worker timeout for the %s role', async (role) => {
    if (role === 'web') process.env.RI_APP_URL = 'https://ri.example.com';
    else setWorkerEnvironment();
    process.env.WORKER_JOB_TIMEOUT_SECONDS = '5';

    await expect(runBootPreflight(role, createLogger())).rejects.toThrow(
      'WORKER_JOB_TIMEOUT_SECONDS must be an integer number of seconds between 30 and 86400 when set; fix or unset it (unset uses 300).',
    );
  });

  it('keeps the existing encryption rename message when the removed name is the only key', async () => {
    process.env.RI_APP_URL = 'https://ri.example.com';
    process.env.SERVICE_ENCRYPTION_KEY = KEY;

    await expect(runBootPreflight('web', createLogger())).rejects.toThrow(
      'SERVICE_ENCRYPTION_KEY is set but is no longer read (it was deprecated in v0.4 and removed in v0.5). Rename it to DATA_ENCRYPTION_KEY and restart. The value does not change, only the name.',
    );
  });

  it('refuses a worker with no key before any database-backed check', async () => {
    await expect(runBootPreflight('worker', createLogger())).rejects.toMatchObject({
      code: 'worker.encryption-key-missing',
      message: expect.stringContaining('DATA_ENCRYPTION_KEY'),
    });
  });

  it('checks the web refresh interval before application startup', async () => {
    process.env.RI_APP_URL = 'https://ri.example.com';
    process.env.CVC_REFRESH_INTERVAL_HOURS = '0';

    await expect(runBootPreflight('web', createLogger())).rejects.toThrow('CVC_REFRESH_INTERVAL_HOURS');
  });

  it('checks the worker reconciliation settings before queue startup', async () => {
    setWorkerEnvironment();
    process.env.LIBRARY_RECONCILE_PENDING_RUNS_CRON = 'every ten minutes';

    await expect(runBootPreflight('worker', createLogger())).rejects.toThrow('LIBRARY_RECONCILE_PENDING_RUNS_CRON');
  });

  it('fails through logger construction when deployment redaction paths are invalid', async () => {
    process.env.RI_APP_URL = 'https://ri.example.com';
    process.env.LOG_REDACT_PATHS = 'bad[path';

    await expect(runBootPreflight('web')).rejects.toThrow(/LOG_REDACT_PATHS/);
  });

  const validatorRejectionCases = [
    {
      name: 'resolveAppUrl',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'not a url';
      },
      message: 'RI_APP_URL is not a valid http(s) URL.',
    },
    {
      name: 'validateHttpUserAgentOnBoot',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.RI_HTTP_USER_AGENT = 'invalid\nuser-agent';
      },
      message: 'RI_HTTP_USER_AGENT is not a valid HTTP User-Agent value',
    },
    {
      name: 'validateCacheMaxEntriesOnBoot',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.CACHE_MAX_ENTRIES = '0';
      },
      message: 'CACHE_MAX_ENTRIES must be a positive integer when set',
    },
    {
      name: 'validateBundledArtefactsFallbackOnBoot',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.BUNDLED_ARTEFACTS_FALLBACK = 'sometimes';
      },
      message: 'BUNDLED_ARTEFACTS_FALLBACK must be "true" or "false" when set',
    },
    {
      name: 'validateStaleClaimOnBoot',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.IDEMPOTENCY_STALE_CLAIM_MINUTES = '0';
      },
      message: 'IDEMPOTENCY_STALE_CLAIM_MINUTES must be an integer of at least 1 when set',
    },
    {
      name: 'validateMaxRequestBodyBytesOnBoot',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.MAX_REQUEST_BODY_BYTES = '100';
      },
      message: 'MAX_REQUEST_BODY_BYTES must be an integer of at least 1024 when set',
    },
    {
      name: 'validateHttpUserAgentOnBoot for worker',
      role: 'worker' as const,
      setup: () => {
        setWorkerEnvironment();
        process.env.RI_HTTP_USER_AGENT = 'invalid\nuser-agent';
      },
      message: 'RI_HTTP_USER_AGENT is not a valid HTTP User-Agent value',
    },
    {
      name: 'validateCacheMaxEntriesOnBoot for worker',
      role: 'worker' as const,
      setup: () => {
        setWorkerEnvironment();
        process.env.CACHE_MAX_ENTRIES = '0';
      },
      message: 'CACHE_MAX_ENTRIES must be a positive integer when set',
    },
    {
      name: 'validateBundledArtefactsFallbackOnBoot for worker',
      role: 'worker' as const,
      setup: () => {
        setWorkerEnvironment();
        process.env.BUNDLED_ARTEFACTS_FALLBACK = 'sometimes';
      },
      message: 'BUNDLED_ARTEFACTS_FALLBACK must be "true" or "false" when set',
    },
    {
      name: 'key format validation',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.DATA_ENCRYPTION_KEY = 'not-a-key';
      },
      message: 'DATA_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).',
    },
    {
      name: 'placeholder policy',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.DATA_ENCRYPTION_KEY = '0'.repeat(64);
        process.env.DEPLOYMENT_ENVIRONMENT = 'production';
      },
      message: 'DATA_ENCRYPTION_KEY is still set to the placeholder value published in .env.example.',
    },
    {
      name: 'OTLP endpoint URL validation',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.DATA_ENCRYPTION_KEY = KEY;
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http:collector';
      },
      message:
        'OTEL_EXPORTER_OTLP_ENDPOINT contains a value the exporter cannot use: TypeError: Invalid URL; fix or unset it.',
    },
    {
      name: 'OTLP general headers',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-bin=abc';
      },
      message:
        "OTEL_EXPORTER_OTLP_HEADERS contains a value the exporter cannot use: keys that end with '-bin' must have Buffer values; fix or unset it.",
    },
    {
      name: 'OTLP trace headers',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = 'x-bin=abc';
      },
      message:
        "OTEL_EXPORTER_OTLP_TRACES_HEADERS contains a value the exporter cannot use: keys that end with '-bin' must have Buffer values; fix or unset it.",
    },
    {
      name: 'OTLP logs endpoint',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = 'grpc';
        process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http:collector';
      },
      message: 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
    },
    {
      name: 'OTLP metrics headers',
      role: 'web' as const,
      setup: () => {
        process.env.RI_APP_URL = 'https://ri.example.com';
        process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL = 'grpc';
        process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS = 'x-bin=abc';
      },
      message: 'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
    },
  ] as const;

  it.each(validatorRejectionCases)('enforces the $name validator effect', async ({ role, setup, message }) => {
    setup();

    await expect(runBootPreflight(role, createLogger())).rejects.toThrow(message);
  });

  it('rejects an unrecognised process role instead of treating it as web', () => {
    expect(() => resolveBootProcessRole('Worker')).toThrow(
      'RI_PROCESS_ROLE must be "web" or "worker" when set; fix or unset it.',
    );
  });

  it('keeps the worker error code in the shared formatter used by the preflight script', () => {
    const error = new WorkerBootError('worker.configuration-invalid', 'worker setting is invalid');

    expect(describeBootError(error)).toBe('worker setting is invalid [worker.configuration-invalid]');
  });

  it('keeps the complete worker framing and error code for a worker preflight refusal', () => {
    const error = new WorkerBootError('worker.configuration-invalid', 'worker setting is invalid');

    expect(formatWorkerBootFailure(error)).toBe(
      'Worker boot failed: worker setting is invalid [worker.configuration-invalid]',
    );
  });
});
