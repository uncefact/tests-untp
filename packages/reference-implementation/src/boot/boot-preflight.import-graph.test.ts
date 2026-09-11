/**
 * @jest-environment node
 */
jest.mock('@/lib/prisma/generated', () => {
  throw new Error('Prisma must not be imported by the boot preflight');
});

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

async function runUnderPrismaImportGuard(key?: string): Promise<void> {
  process.env.RI_APP_URL = 'https://ri.example.com';
  if (key === undefined) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = key;

  const { runBootPreflight } = await import('./boot-preflight');
  await expect(
    runBootPreflight('web', {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    } as never),
  ).resolves.toMatchObject(key === undefined ? { deprecatedName: 'absent' } : { key, deprecatedName: 'absent' });
}

function clearEnvironment(): void {
  for (const name of ENV_NAMES) delete process.env[name];
}

function restoreEnvironment(): void {
  for (const name of ENV_NAMES) {
    const value = savedEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

it('runs the keyless preflight without importing Prisma or its generated client', async () => {
  clearEnvironment();

  try {
    await runUnderPrismaImportGuard();
  } finally {
    restoreEnvironment();
  }
});

it('runs the keyed preflight without importing Prisma or its generated client', async () => {
  clearEnvironment();

  try {
    process.env.DEPLOYMENT_ENVIRONMENT = 'local';
    await runUnderPrismaImportGuard('a'.repeat(64));
  } finally {
    restoreEnvironment();
  }
});
