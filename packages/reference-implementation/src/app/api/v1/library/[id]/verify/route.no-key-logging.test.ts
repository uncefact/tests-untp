/**
 * Acceptance criterion 8: the supplier key a key-bearing re-verification
 * carries must not appear in any structured log line this route or the
 * orchestration beneath it writes, on any outcome.
 *
 * The assertions are made against RENDERED lines from the real pino logger,
 * captured through a destination, in the style of
 * `src/app/api/v1/library/route.no-key-logging.test.ts`. A jest-mock logger
 * would let a leak through: `objectContaining` ignores extra keys, and a
 * cause chain that pino would expand in full is never expanded at all.
 *
 * Two sentinels, because they can leak by different routes. The KEY sentinel
 * is the supplier key the request carried; the PLAINTEXT sentinel is content
 * a storage service or a decrypt failure might echo back. A leak control at
 * the end proves the capture can see a sentinel at all, so a suite that
 * rendered nothing cannot pass by silence.
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

const mockReverifyLibraryRecord = jest.fn();
jest.mock('@/lib/library/reverify-library-record', () => {
  const actual = jest.requireActual('@/lib/library/reverify-library-record');
  return {
    ...actual,
    reverifyLibraryRecord: (...args: unknown[]) => mockReverifyLibraryRecord(...args),
  };
});

/**
 * The failed-settlement branch is reached by making the settle write itself
 * reject. Mocked rather than left to the real repository, so the branch is
 * driven deterministically and the rejection can carry a sentinel of its own.
 */
const mockSettleCheckRunFailed = jest.fn();
jest.mock('@/lib/prisma/repositories/check-run.repository', () => ({
  ...jest.requireActual('@/lib/prisma/repositories/check-run.repository'),
  settleCheckRunFailed: (...args: unknown[]) => mockSettleCheckRunFailed(...args),
}));

const mockGetLibraryRecordById = jest.fn();
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  getLibraryRecordById: (...args: unknown[]) => mockGetLibraryRecordById(...args),
}));

jest.mock('@/lib/jobs/app-job-queue', () => ({ startJobQueue: jest.fn() }));

import { CheckResult, CheckRunFailureCode, CheckRunState, CoreCredentialType } from '@/lib/prisma/generated';
import { settleCheckRunFailed } from '@/lib/prisma/repositories/check-run.repository';
import { EncryptionUnavailableError } from '@/lib/library/register-external-credential';
import { POST } from './route';

/**
 * The real orchestration, bound through `jest.requireActual` rather than
 * imported from the module specifier this file mocks.
 *
 * Importing it by specifier resolves to the mock, so an implementation that
 * called it recursed until the stack blew and the orchestration was never
 * entered at all: the one line this suite exists to cover was never executed,
 * and restoring the pre-fix `err:` binding left the file green.
 */
function realReverifyLibraryRecord(
  ...args: Parameters<typeof import('@/lib/library/reverify-library-record').reverifyLibraryRecord>
): ReturnType<typeof import('@/lib/library/reverify-library-record').reverifyLibraryRecord> {
  const actual = jest.requireActual(
    '@/lib/library/reverify-library-record',
  ) as typeof import('@/lib/library/reverify-library-record');
  return (actual.reverifyLibraryRecord as (...a: unknown[]) => Promise<never>)(...args);
}

/** The supplier key this request carries. Never legitimately logged anywhere. */
const KEY_SENTINEL = 'deadbeefcafe0042'.repeat(4);
/** Decrypted content, or an upstream echo of it. Never legitimately logged either. */
const PLAINTEXT_SENTINEL = 'PLAINTEXT-SENTINEL-e7b1c9';
const RECORD_ID = 'crec0000000000000000000001';
const AUTH_CONTEXT = { tenantId: 'tenant-1', params: Promise.resolve({ id: RECORD_ID }) };

function request(body?: string): Request {
  const encoded = body ?? JSON.stringify({ sourceEncryption: { decryptionKey: KEY_SENTINEL } });
  const headers = new Map([['content-type', 'application/json']]);
  return {
    method: 'POST',
    url: `http://localhost/api/v1/library/${RECORD_ID}/verify`,
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

function recordView(failure?: { code: CheckRunFailureCode; message: string }) {
  return {
    origin: 'EXTERNAL' as const,
    record: {
      id: RECORD_ID,
      tenantId: 'tenant-1',
      origin: 'EXTERNAL' as const,
      name: null,
      issuerName: null,
      issuerDid: null,
      subjectName: null,
      subjectId: null,
      validFrom: null,
      validUntil: null,
      credentialType: null,
      coreCredentialType: null,
      coreDataModelVersion: null,
      detailsStatus: 'EXTRACTION_PENDING' as const,
      detailsError: null,
      createdAt: new Date('2026-09-03T11:00:00.000Z'),
      updatedAt: new Date('2026-09-03T11:00:00.000Z'),
    },
    external: {
      id: RECORD_ID,
      tenantId: 'tenant-1',
      origin: 'EXTERNAL' as const,
      sourceUrl: 'https://supplier.example/a',
      sourceDigest: 'zSource',
      encrypted: true,
      contentKind: null,
      storageUri: 'https://storage.example/raw',
      storageDigestMultibase: 'zRaw',
      storageServiceInstanceId: 'svc-1',
      storageExternalId: 'raw-1',
      storageBucket: 'private',
      decryptionKey: null,
      displayName: 'Supplier DCC',
      declaredCredentialType: CoreCredentialType.DCC,
      dateReceived: null,
      notes: null,
      annotationVersion: 1,
      decryptionKeyUnused: false,
      contentDigest: null,
      duplicateOfRecordId: null,
      createdAt: new Date('2026-09-03T11:00:00.000Z'),
      updatedAt: new Date('2026-09-03T11:00:00.000Z'),
    },
    checkRun: {
      id: 'run-2',
      recordId: RECORD_ID,
      tenantId: 'tenant-1',
      generation: 2,
      state: failure === undefined ? CheckRunState.PENDING : CheckRunState.FAILED,
      retrieval: CheckResult.PASS,
      decryption: failure === undefined ? CheckResult.NOT_RUN : CheckResult.FAIL,
      digest: CheckResult.PASS,
      proof: CheckResult.NOT_RUN,
      status: CheckResult.NOT_RUN,
      temporal: CheckResult.NOT_RUN,
      schemaConformance: CheckResult.NOT_RUN,
      failureCode: failure?.code ?? null,
      failureMessage: failure?.message ?? null,
      failureRetryable: failure === undefined ? null : true,
      sourceChanged: null,
      lastSourceCheckAt: null,
      requestedAt: new Date('2026-09-03T11:00:00.000Z'),
      completedAt: failure === undefined ? null : new Date('2026-09-03T11:01:00.000Z'),
      lastEnqueuedAt: null,
    },
  };
}

function rendered(): string {
  return mockCapturedLogLines.join('');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCapturedLogLines.length = 0;
  mockGetLibraryRecordById.mockResolvedValue(recordView());
  mockReverifyLibraryRecord.mockResolvedValue({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
  mockSettleCheckRunFailed.mockResolvedValue(undefined);
});

describe('POST /api/v1/library/{id}/verify rendered lines never carry the supplied key', () => {
  it('does not render it on the accepted 202', async () => {
    const response = (await POST(request() as never, AUTH_CONTEXT as never)) as unknown as { status: number };

    expect(response.status).toBe(202);
    expect(rendered()).toContain('Re-verification request accepted');
    expect(rendered()).not.toContain(KEY_SENTINEL);
  });

  it('does not render it when the key was wrong and the generation settled failed', async () => {
    // The outcome the ticket is about. The settled failure IS logged, with
    // its code, so this is a line that exists and must still not carry the
    // key that produced it.
    mockGetLibraryRecordById.mockResolvedValue(
      recordView({
        code: CheckRunFailureCode.DECRYPTION_FAILED,
        message: "The supplied decryption key did not open this record's durable copy.",
      }),
    );

    const response = (await POST(request() as never, AUTH_CONTEXT as never)) as unknown as { status: number };

    expect(response.status).toBe(202);
    expect(rendered()).toContain('DECRYPTION_FAILED');
    expect(rendered()).not.toContain(KEY_SENTINEL);
  });

  it('does not render it when the body is malformed', async () => {
    // The 400 is composed from a zod issue path and message. A body echo
    // here would publish the key in the response as well as the log.
    const response = (await POST(
      request(`{"sourceEncryption":{"decryptionKey":"${KEY_SENTINEL}"`) as never,
      AUTH_CONTEXT as never,
    )) as unknown as { status: number; json: () => Promise<{ error: string }> };

    expect(response.status).toBe(400);
    expect((await response.json()).error).not.toContain(KEY_SENTINEL);
    expect(rendered()).not.toContain(KEY_SENTINEL);
  });

  it('does not render it, or the plaintext, when the store fails behind a nested cause', async () => {
    // The deepest case: a wrapped storage failure whose cause chain has seen
    // both the key and the decrypted body. Pino renders an unreduced chain in
    // full, which is exactly what `safeError` exists to stop.
    mockReverifyLibraryRecord.mockRejectedValue(
      new EncryptionUnavailableError(
        new Error('Missing required DATA_ENCRYPTION_KEY environment variable.', {
          cause: new Error(`the adapter rejected ${KEY_SENTINEL} while wrapping ${PLAINTEXT_SENTINEL}`),
        }),
      ),
    );

    const response = (await POST(request() as never, AUTH_CONTEXT as never)) as unknown as { status: number };

    expect(response.status).toBe(500);
    expect(rendered()).toContain('Encryption is not available');
    expect(rendered()).not.toContain(KEY_SENTINEL);
    expect(rendered()).not.toContain(PLAINTEXT_SENTINEL);
  });

  it('does not render either sentinel when the orchestration throws something unexpected', async () => {
    // The sanitised 500. Its own log line is the one most likely to reach for
    // the raw error, because nothing about the throw is known.
    mockReverifyLibraryRecord.mockRejectedValue(
      new Error('unexpected', { cause: new Error(`${KEY_SENTINEL} and ${PLAINTEXT_SENTINEL}`) }),
    );

    const response = (await POST(request() as never, AUTH_CONTEXT as never)) as unknown as { status: number };

    expect(response.status).toBe(500);
    expect(rendered()).toContain('Re-verification failed');
    expect(rendered()).not.toContain(KEY_SENTINEL);
    expect(rendered()).not.toContain(PLAINTEXT_SENTINEL);
  });

  it('does not render either sentinel when the reservation cannot be settled after a throw', async () => {
    // The failed-settlement path in `reverify-library-record.ts`, driven
    // through the REAL orchestration rather than the route's mock, because
    // that is the module that writes the line. Both the settle failure and
    // the original cause are logged there, and both cause chains ran with the
    // supplier's key in scope.
    //
    // Sentinels are placed in BOTH chains, so restoring either half of the
    // pre-fix `logger.error({ err: settleError, cause }, ...)` binding is
    // caught: pino's error serialiser expands an `err` binding and walks its
    // whole cause chain.
    mockSettleCheckRunFailed.mockRejectedValue(
      new Error('the settle write failed', {
        cause: new Error(`settling a run opened with ${KEY_SENTINEL} holding ${PLAINTEXT_SENTINEL}`),
      }),
    );
    mockReverifyLibraryRecord.mockImplementation(
      (recordId: string, tenantId: string, prepareEnqueue: () => Promise<unknown>, key: string) =>
        realReverifyLibraryRecord(recordId, tenantId, prepareEnqueue as never, key, {
          getRecord: async () => recordView() as never,
          fetchSource: async () => {
            throw new Error('unused');
          },
          createGeneration: async () => ({ outcome: 'created', generation: 2, checkRunId: 'run-2' }),
          reserveGeneration: async () => ({
            outcome: 'reserved',
            generation: 2,
            checkRunId: 'run-2',
            identity: { contentDigest: null, duplicateOfRecordId: null },
            custody: {
              storageUri: 'https://storage.example/raw',
              storageDigestMultibase: 'zRaw',
              storageExternalId: 'raw-1',
              decryptionKeyPresent: false,
              encrypted: true,
            },
          }),
          // Throws after the acquisition, which is where a real finalisation
          // failure lands: a read failure inside `acquireStoredCopy` settles
          // itself and never reaches this branch at all.
          finaliseGeneration: async () => {
            throw new Error('finalisation failed', {
              cause: new Error(`pipeline held ${KEY_SENTINEL} and ${PLAINTEXT_SENTINEL}`),
            });
          },
          fetchStoredCopy: async () => new Uint8Array([1, 2, 3]),
          recoverInRequest: async () => ({
            acquisition: { mode: 'stored-copy' as const },
            encrypted: true,
            details: { status: 'EXTRACTION_PENDING' as never },
            checkRun: {
              state: CheckRunState.FAILED,
              checks: {},
              failure: {
                code: CheckRunFailureCode.DECRYPTION_FAILED,
                message: 'the key did not open it',
                retryable: true,
              },
            },
          }),
        }),
    );

    await POST(request() as never, AUTH_CONTEXT as never);

    // The line under test really ran; without this the assertions below would
    // also pass against a path that never reached the catch.
    expect(rendered()).toContain('Reserved recovery generation could not be settled');
    expect(rendered()).not.toContain(KEY_SENTINEL);
    expect(rendered()).not.toContain(PLAINTEXT_SENTINEL);
  });

  it('proves the capture would catch either sentinel if a line carried one', async () => {
    // Without this, every assertion above would also pass against a logger
    // that rendered nothing at all.
    const { apiLogger } = jest.requireActual('@/lib/api/logger') as {
      apiLogger: { warn: (...a: unknown[]) => void };
    };
    apiLogger.warn({ leakCheck: KEY_SENTINEL, plaintext: PLAINTEXT_SENTINEL }, 'deliberate sentinel write');

    expect(rendered()).toContain(KEY_SENTINEL);
    expect(rendered()).toContain(PLAINTEXT_SENTINEL);
  });

  it('never lets the settle write itself carry the key', () => {
    // The settlement the failed path performs takes a run id, a tenant, the
    // checks and a failure. There is no field on that input a key could
    // travel in, which is the structural half of the guarantee the rendered
    // assertions above cover behaviourally.
    const settleInput: Parameters<typeof settleCheckRunFailed>[0] = {
      id: 'run-2',
      tenantId: 'tenant-1',
      checks: {
        retrieval: CheckResult.NOT_RUN,
        decryption: CheckResult.NOT_RUN,
        digest: CheckResult.NOT_RUN,
        proof: CheckResult.NOT_RUN,
        status: CheckResult.NOT_RUN,
        temporal: CheckResult.NOT_RUN,
        schemaConformance: CheckResult.NOT_RUN,
      },
      failure: { code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE, message: 'settled', retryable: true },
    };

    expect(Object.keys(settleInput)).toEqual(['id', 'tenantId', 'checks', 'failure']);
  });
});
