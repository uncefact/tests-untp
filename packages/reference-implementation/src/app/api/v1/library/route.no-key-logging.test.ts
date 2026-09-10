/**
 * The register route's own rendered lines, in the style of
 * `[id]/route.no-key-logging.test.ts`. The suite beside the pipeline covers
 * what that module logs; the encryption refusal is answered and logged here,
 * at the route, so it is pinned here.
 */
const mockCapturedLogLines: string[] = [];

jest.mock('@uncefact/untp-ri-services/logging', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services/logging');
  return {
    ...actual,
    createLogger: (config: Record<string, unknown> = {}) =>
      actual.createLogger({
        ...config,
        level: 'debug',
        destination: { write: (line: string) => mockCapturedLogLines.push(line) },
      }),
  };
});

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: { get: (name: string) => init?.headers?.[name] ?? null },
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/api/with-tenant-auth', () => {
  const { handleRouteError } = jest.requireActual('@/lib/api/handle-route-error');
  return {
    withTenantAuth:
      (handler: (req: unknown, ctx: unknown) => Promise<unknown>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
        } catch (e: unknown) {
          return handleRouteError(e);
        }
      },
  };
});

// The verify job module reaches the services server barrel through the VC
// resolver, whose DID stack cannot resolve under jest.
jest.mock('@/lib/services/resolve-vc-service', () => ({ resolveVcService: jest.fn() }));

// register-external-credential reaches the resolvers barrel, whose
// multiformats subpath exports do not resolve under jest.
jest.mock('@uncefact/untp-utils/resolvers', () => ({
  ...jest.requireActual('@uncefact/untp-utils/resolvers/errors'),
  resolveDocument: jest.fn(),
}));

const mockFindIdempotencyKey = jest.fn();
const mockClaimIdempotencyKey = jest.fn();
const mockReleaseIdempotencyKey = jest.fn();
jest.mock('@/lib/prisma/repositories/idempotency-key.repository', () => {
  const actual = jest.requireActual('@/lib/prisma/repositories/idempotency-key.repository');
  return {
    IdempotencyClaimLostError: actual.IdempotencyClaimLostError,
    IdempotencyClaimOperationMismatchError: actual.IdempotencyClaimOperationMismatchError,
    findIdempotencyKey: (...args: unknown[]) => mockFindIdempotencyKey(...args),
    claimIdempotencyKey: (...args: unknown[]) => mockClaimIdempotencyKey(...args),
    completeIdempotencyKey: jest.fn(),
    releaseIdempotencyKey: (...args: unknown[]) => mockReleaseIdempotencyKey(...args),
  };
});

const mockRegisterExternalCredential = jest.fn();
jest.mock('@/lib/library/register-external-credential', () => {
  const actual = jest.requireActual('@/lib/library/register-external-credential');
  return {
    SourceRejectedError: actual.SourceRejectedError,
    EncryptionUnavailableError: actual.EncryptionUnavailableError,
    StorageKeyMissingError: actual.StorageKeyMissingError,
    registerExternalCredential: (...args: unknown[]) => mockRegisterExternalCredential(...args),
    defaultRegisterDependencies: jest.fn(),
  };
});

jest.mock('@/lib/jobs/app-job-queue', () => ({ startJobQueue: jest.fn() }));

import { CoreCredentialType } from '@/lib/prisma/generated';
import { EncryptionUnavailableError } from '@/lib/library/register-external-credential';
import { POST } from './route';

const SENTINEL_KEY = 'deadbeefcafe0042'.repeat(4);
const SENTINEL_ANNOTATION = 'SENTINEL-ANNOTATION-VALUE-0042';
const SOURCE_URL = 'https://supplier.example/credentials/abc';
const AUTH_CONTEXT = { tenantId: 'tenant-1', params: Promise.resolve({}) };

function request(annotationOverrides: Record<string, unknown> = {}): Request {
  const encoded = JSON.stringify({
    sourceUrl: SOURCE_URL,
    sourceEncryption: { decryptionKey: SENTINEL_KEY },
    annotations: {
      displayName: 'Supplier DCC',
      declaredCredentialType: CoreCredentialType.DCC,
      ...annotationOverrides,
    },
  });
  const headers = new Map([
    ['content-type', 'application/json'],
    ['idempotency-key', 'register-key-1'],
  ]);
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/library',
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null } as unknown as Headers,
    body: {
      getReader() {
        let delivered = false;
        return {
          async read() {
            if (delivered) return { done: true as const, value: undefined };
            delivered = true;
            return { done: false as const, value: new Uint8Array(Buffer.from(encoded, 'utf8')) };
          },
          async cancel() {
            delivered = true;
          },
        };
      },
    },
    arrayBuffer: async () => Buffer.from(encoded, 'utf8'),
    text: async () => encoded,
    json: async () => JSON.parse(encoded),
  } as unknown as Request;
}

function parsedLines(): Record<string, unknown>[] {
  return mockCapturedLogLines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCapturedLogLines.length = 0;
  mockFindIdempotencyKey.mockResolvedValue({ outcome: 'absent' });
  mockClaimIdempotencyKey.mockResolvedValue({ outcome: 'claimed', claimId: 'claim-1' });
  mockReleaseIdempotencyKey.mockResolvedValue({ applied: true });
});

describe('POST /api/v1/library rendered lines when the encryption preflight refuses', () => {
  it('keeps the configuration reason, and nothing under it', async () => {
    // The wrapper's own message says only that encryption is unavailable, so
    // the reason an operator acts on lives one level down and is kept. What
    // sits under that level, which is where a wrapped crypto failure would
    // carry key material, is not rendered at all.
    const reason = new Error('Missing required DATA_ENCRYPTION_KEY environment variable.', {
      cause: new Error(`the adapter rejected ${SENTINEL_KEY}`),
    });
    mockRegisterExternalCredential.mockRejectedValue(new EncryptionUnavailableError(reason));

    const response = (await POST(request() as never, AUTH_CONTEXT as never)) as unknown as { status: number };

    expect(response.status).toBe(500);
    const line = parsedLines().find((entry) => entry.msg === 'Encryption preflight failed; no record was created');
    expect(line).toBeDefined();
    expect(line?.error).toEqual({
      name: 'EncryptionUnavailableError',
      message: 'Credential storage encryption is not available.',
    });
    expect(line?.cause).toEqual({
      name: 'Error',
      message: 'Missing required DATA_ENCRYPTION_KEY environment variable.',
    });
    expect(line).not.toHaveProperty('err');
    expect(mockCapturedLogLines.join('')).not.toContain(SENTINEL_KEY);
  });

  it('proves the capture includes an error cause if any of those lines carried it', async () => {
    // Without this the assertion above would also pass on a logger that
    // rendered nothing at all.
    const { apiLogger } = jest.requireActual('@/lib/api/logger') as { apiLogger: { warn: (...a: unknown[]) => void } };
    apiLogger.warn({ err: new Error('outer', { cause: new Error(SENTINEL_ANNOTATION) }) }, 'deliberate sentinel write');

    expect(mockCapturedLogLines.join('')).toContain(SENTINEL_ANNOTATION);
  });

  it.each([
    [
      'displayName',
      { displayName: `a\0${SENTINEL_ANNOTATION}` },
      'annotations.displayName: must not contain a NUL character',
    ],
    ['notes', { notes: `a\0${SENTINEL_ANNOTATION}` }, 'annotations.notes: must not contain a NUL character'],
    [
      'declaredCredentialType',
      { declaredCredentialType: SENTINEL_ANNOTATION },
      'annotations.declaredCredentialType: must be one of DFR, DCC, DPP, DTE, DIA',
    ],
  ])('does not render the submitted sentinel when %s fails validation', async (_field, annotations, error) => {
    const response = (await POST(request(annotations) as never, AUTH_CONTEXT as never)) as unknown as {
      status: number;
      json: () => Promise<Record<string, unknown>>;
    };
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error, code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(body)).not.toContain(SENTINEL_ANNOTATION);
    expect(JSON.stringify(body)).not.toContain(SENTINEL_KEY);
    expect(mockCapturedLogLines.length).toBeGreaterThan(0);
    expect(mockCapturedLogLines.join('')).not.toContain(SENTINEL_ANNOTATION);
    expect(mockCapturedLogLines.join('')).not.toContain(SENTINEL_KEY);
  });
});
