jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('@uncefact/untp-ri-services/logging', () => ({
  ...jest.requireActual('@uncefact/untp-ri-services/logging'),
  getRequestContext: () => undefined,
}));

jest.mock('@/lib/api/with-tenant-auth', () => {
  const { handleRouteError } = jest.requireActual('@/lib/api/handle-route-error');
  return {
    withTenantAuth:
      (handler: (req: unknown, ctx: unknown) => Promise<unknown>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
        } catch (error: unknown) {
          return handleRouteError(error);
        }
      },
  };
});

const loggerCalls: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
loggerCalls.child = () => loggerCalls;
jest.mock('@/lib/api/logger', () => ({ apiLogger: loggerCalls }));

jest.mock('@/lib/services/resolve-vc-service', () => ({ resolveVcService: jest.fn() }));
jest.mock('@uncefact/untp-utils/resolvers', () => ({
  ...jest.requireActual('@uncefact/untp-utils/resolvers/errors'),
  resolveDocument: jest.fn(),
}));
jest.mock('@uncefact/untp-utils/node', () => ({
  ...jest.requireActual('@uncefact/untp-utils/node'),
  validatePublicUrl: jest.fn(),
}));

const mockGetLibraryRecordById = jest.fn();
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  getLibraryRecordById: (...args: unknown[]) => mockGetLibraryRecordById(...args),
}));

const mockStartJobQueue = jest.fn();
jest.mock('@/lib/jobs/app-job-queue', () => ({
  startJobQueue: (...args: unknown[]) => mockStartJobQueue(...args),
}));

const mockReverifyLibraryRecord = jest.fn();
jest.mock('@/lib/library/reverify-library-record', () => {
  const actual = jest.requireActual('@/lib/library/reverify-library-record');
  return {
    ...actual,
    reverifyLibraryRecord: (...args: unknown[]) => mockReverifyLibraryRecord(...args),
  };
});

const mockToCredentialRecord = jest.fn();
const mockToNativeCredentialRecord = jest.fn();
jest.mock('@/lib/library/credential-record-projection', () => {
  const actual = jest.requireActual('@/lib/library/credential-record-projection');
  return {
    ...actual,
    toCredentialRecord: (...args: unknown[]) => mockToCredentialRecord(...args),
    toNativeCredentialRecord: (...args: unknown[]) => mockToNativeCredentialRecord(...args),
  };
});

import {
  CheckResult,
  CheckRunState,
  CredentialDetailsStatus,
  CoreCredentialType,
  ExternalContentKind,
  LibraryRecordOrigin,
  type CheckRun,
  type Credential,
  type ExternalCredential,
  type LibraryRecord,
} from '@/lib/prisma/generated';
import { NotFoundError } from '@/lib/api/errors';
import { CredentialRecordProjectionError } from '@/lib/library/credential-record-projection';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { DecryptionRequiredError } from '@/lib/library/reverify-library-record';
import { EncryptionUnavailableError } from '@/lib/library/register-external-credential';
import { BODY_MUST_BE_EMPTY_MESSAGE } from '@/lib/library/reverify-messages';
import { LIBRARY_VERIFY_JOB, VERIFY_JOB_ENQUEUE_OPTIONS } from '@/lib/library/verify-generation-job';
import { POST } from './route';

const RECORD_ID = 'crec0000000000000000000001';
const TENANT_ID = 'tenant-1';
const JOB = { tenantId: TENANT_ID, recordId: RECORD_ID, generation: 2, checkRunId: 'run-2' };
const RESPONSE = {
  id: RECORD_ID,
  origin: 'external',
  verification: { generation: 2, state: 'pending' },
};

function parent(overrides: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.EXTERNAL,
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
    detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
    detailsError: null,
    createdAt: new Date('2026-09-03T11:00:00.000Z'),
    updatedAt: new Date('2026-09-03T11:00:00.000Z'),
    ...overrides,
  };
}

function external(overrides: Partial<ExternalCredential> = {}): ExternalCredential {
  return {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.EXTERNAL,
    sourceUrl: 'https://supplier.example/credential-a',
    sourceDigest: 'zQmSourceDigest',
    encrypted: false,
    contentKind: ExternalContentKind.CREDENTIAL,
    storageUri: 'https://storage.example/objects/abc',
    storageDigestMultibase: 'zQmStoredDigest',
    storageServiceInstanceId: 'svc-1',
    storageExternalId: 'obj-1',
    storageBucket: 'library',
    decryptionKey: 'protected-key-envelope',
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
    ...overrides,
  };
}

function run(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 'run-1',
    recordId: RECORD_ID,
    tenantId: TENANT_ID,
    generation: 1,
    state: CheckRunState.COMPLETE,
    retrieval: CheckResult.PASS,
    decryption: CheckResult.NOT_RUN,
    digest: CheckResult.PASS,
    proof: CheckResult.PASS,
    status: CheckResult.PASS,
    temporal: CheckResult.PASS,
    schemaConformance: CheckResult.NOT_RUN,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    sourceChanged: null,
    lastSourceCheckAt: null,
    requestedAt: new Date('2026-09-03T11:00:00.000Z'),
    completedAt: new Date('2026-09-03T11:01:00.000Z'),
    lastEnqueuedAt: new Date('2026-09-03T11:00:00.000Z'),
    ...overrides,
  };
}

function view(
  overrides: { parent?: Partial<LibraryRecord>; external?: Partial<ExternalCredential>; run?: Partial<CheckRun> } = {},
) {
  return {
    origin: LibraryRecordOrigin.EXTERNAL,
    record: parent(overrides.parent),
    external: external(overrides.external),
    checkRun: run(overrides.run),
  };
}

type RequestOptions = { contentLength?: string; unreadable?: boolean };

function nativeView() {
  const credential: Credential = {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.NATIVE,
    storageUri: 'https://storage.example/native/credential-a',
    digestMultibase: 'zQmNativeStoredDigest',
    decryptionKey: null,
    isPublished: false,
    organisationId: null,
    facilityId: null,
    productId: null,
    createdAt: new Date('2026-09-03T11:00:00.000Z'),
    updatedAt: new Date('2026-09-03T11:00:00.000Z'),
  };
  return {
    origin: LibraryRecordOrigin.NATIVE,
    record: parent({ origin: LibraryRecordOrigin.NATIVE }),
    credential,
    checkRun: run({ generation: 2, state: CheckRunState.PENDING }),
  };
}

function request(body = '', options: RequestOptions = {}): Request {
  const bytes = Buffer.from(body, 'utf8');
  let read = false;
  const headers = new Headers();
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength);
  return {
    method: 'POST',
    url: `http://localhost/api/v1/library/${RECORD_ID}/verify`,
    headers,
    body: {
      getReader: () => ({
        read: async () => {
          if (options.unreadable) throw new Error('the connection dropped mid-body');
          if (read) return { done: true as const, value: undefined };
          read = true;
          return { done: bytes.length === 0, value: bytes.length === 0 ? undefined : new Uint8Array(bytes) };
        },
        cancel: async () => undefined,
      }),
    },
  } as unknown as Request;
}

const AUTH_CONTEXT = { tenantId: TENANT_ID, params: Promise.resolve({ id: RECORD_ID }) };

async function post(body = '', context = AUTH_CONTEXT, options: RequestOptions = {}) {
  const response = (await POST(request(body, options), context as never)) as unknown as {
    status: number;
    json: () => Promise<unknown>;
  };
  return { status: response.status, body: await response.json() };
}

const queue = { enqueueWithin: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLibraryRecordById.mockResolvedValue(view());
  mockStartJobQueue.mockResolvedValue(queue);
  mockToCredentialRecord.mockReturnValue(RESPONSE);
  mockToNativeCredentialRecord.mockReturnValue(RESPONSE);
  mockReverifyLibraryRecord.mockResolvedValue({ outcome: 'created', ...JOB });
});

describe('POST /api/v1/library/:id/verify', () => {
  it.each(['not empty', '   '])('rejects %j before reading the record', async (body) => {
    // Fails if whitespace is parsed as an absent body or a present body is
    // allowed to reach the key-bearing branch before that form is supported.
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: BODY_MUST_BE_EMPTY_MESSAGE,
      code: 'VALIDATION_FAILED',
    });
    expect(mockGetLibraryRecordById).not.toHaveBeenCalled();
  });

  it('answers a NUL-containing id as not found without touching the database', async () => {
    // Fails if the opaque id is interpolated into a query before the shared
    // route guard rejects it.
    const id = `${RECORD_ID}\0`;
    const response = await post('', { tenantId: TENANT_ID, params: Promise.resolve({ id }) });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });
    expect(mockGetLibraryRecordById).not.toHaveBeenCalled();
  });

  it('returns the pending generation a join answered and starts no second job', async () => {
    // The module owns the join decision; the route projects it. Fails if the
    // route re-decides precedence, or if a joined request enqueues work.
    mockReverifyLibraryRecord.mockResolvedValue({ outcome: 'joined' });
    mockGetLibraryRecordById.mockResolvedValue(view({ run: { state: CheckRunState.PENDING, generation: 2 } }));
    mockToCredentialRecord.mockReturnValue({ ...RESPONSE, verification: { generation: 2, state: 'pending' } });

    const response = await post();

    expect(response.status).toBe(202);
    expect(queue.enqueueWithin).not.toHaveBeenCalled();
    expect(response.body).toEqual({ ...RESPONSE, verification: { generation: 2, state: 'pending' } });
    expect(loggerCalls.info).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'joined' }),
      'Re-verification request accepted',
    );
  });

  it('logs the outcome rather than a joined boolean when a request is superseded', async () => {
    // Fails if a superseded request is logged as an ordinary accepted one, so
    // that an operator cannot tell it did no work.
    mockReverifyLibraryRecord.mockResolvedValue({ outcome: 'superseded', generation: 4 });

    const response = await post();

    expect(response.status).toBe(202);
    expect(loggerCalls.info).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'superseded' }),
      'Re-verification request accepted',
    );
  });

  it('maps DECRYPTION_REQUIRED through the shared error mapper as a coded 400', async () => {
    // Fails if a keyless R1 copy creates a pending worker job that can never
    // decrypt, or if this 400 is hand-built into a shape that can drift from
    // the route's other 400.
    mockReverifyLibraryRecord.mockRejectedValue(new DecryptionRequiredError());

    const response = await post();

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: new DecryptionRequiredError().message, code: 'DECRYPTION_REQUIRED' });
    expect(queue.enqueueWithin).not.toHaveBeenCalled();
  });

  it('answers a record the module could not find as a 404', async () => {
    // The plain miss, as opposed to the NUL short circuit above. Fails if the
    // module's coded not-found is swallowed into a sanitised 500.
    mockReverifyLibraryRecord.mockRejectedValue(new NotFoundError('No such credential record.', 'NOT_FOUND'));

    const response = await post();

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });
  });

  it('answers a body that cannot be read as a 400 rather than a server error', async () => {
    // A dropped connection is the caller's fault and the Swagger documents it
    // as an inherited 400. Fails if the reader's error falls through to the
    // catch-all and becomes a 500 an operator is paged for.
    const response = await post('', AUTH_CONTEXT, { unreadable: true });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Could not read the request body' });
    expect(mockReverifyLibraryRecord).not.toHaveBeenCalled();
  });

  it('answers an over-sized body as the inherited 413', async () => {
    // Fails if the size rejection is caught by the route and re-reported as a
    // server error, which the Swagger 413 says it is not.
    const response = await post('', AUTH_CONTEXT, { contentLength: String(6 * 1024 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual(expect.objectContaining({ code: 'REQUEST_BODY_TOO_LARGE' }));
    expect(mockReverifyLibraryRecord).not.toHaveBeenCalled();
  });

  it('projects a native record through the native projection', async () => {
    // Fails if every 202 is projected as an external record, which would
    // publish a native run's acquisition and custody results.
    mockGetLibraryRecordById.mockResolvedValue(nativeView());
    mockToNativeCredentialRecord.mockReturnValue({ ...RESPONSE, origin: 'native' });

    const response = await post();

    expect(response.status).toBe(202);
    expect(mockToNativeCredentialRecord).toHaveBeenCalled();
    expect(mockToCredentialRecord).not.toHaveBeenCalled();
    expect(response.body).toEqual({ ...RESPONSE, origin: 'native' });
  });

  it('answers a sanitised 500 when the job queue will not start for a request that would create a generation', async () => {
    // Fails if a queue outage reaches the caller as a driver message, or if
    // the request proceeds to write a generation nothing will ever run.
    mockStartJobQueue.mockRejectedValue(new Error('pg-boss could not connect'));
    mockReverifyLibraryRecord.mockImplementation(async (...args: unknown[]) => {
      const prepare = args[2] as () => Promise<unknown>;
      await prepare();
      return { outcome: 'created', ...JOB };
    });

    const response = await post();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'An unexpected error has occurred.' });
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({ cause: { name: 'Error', message: 'pg-boss could not connect' } }),
      'The job queue could not be started for re-verification',
    );
  });

  it.each([
    [
      '404',
      404,
      { error: 'No such credential record.', code: 'NOT_FOUND' },
      () => mockReverifyLibraryRecord.mockRejectedValue(new NotFoundError('No such credential record.', 'NOT_FOUND')),
    ],
    ['202', 202, RESPONSE, () => mockReverifyLibraryRecord.mockResolvedValue({ outcome: 'joined' })],
    [
      '400',
      400,
      { error: new DecryptionRequiredError().message, code: 'DECRYPTION_REQUIRED' },
      () => mockReverifyLibraryRecord.mockRejectedValue(new DecryptionRequiredError()),
    ],
  ])('still answers %s while the job queue will not start', async (_label, status, body, arrange) => {
    // The module readies the enqueue only once it has decided to create a
    // generation, so these three never reach the queue. Fails if the route
    // starts it up front again, which turns every one of them into a 500 for
    // as long as the queue is down.
    mockStartJobQueue.mockRejectedValue(new Error('pg-boss could not connect'));
    arrange();

    const response = await post();

    expect(response.status).toBe(status);
    expect(response.body).toEqual(body);
  });

  it.each([
    [
      'a record shape the write paths never produce',
      new LibraryRecordShapeError(RECORD_ID, 'has a broken shape'),
      'The library record has a shape the write paths never produce',
    ],
    [
      'a projection failure',
      new CredentialRecordProjectionError(RECORD_ID, 'could not be projected'),
      'The library record could not be projected',
    ],
  ])('answers %s as a sanitised 500 with its own log line', async (_label, error, message) => {
    // Fails if either lands on the catch-all, where an operator cannot tell a
    // data-integrity finding from an unanticipated bug.
    mockReverifyLibraryRecord.mockRejectedValue(error);

    const response = await post();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'An unexpected error has occurred.' });
    expect(loggerCalls.error).toHaveBeenCalledWith(
      { error: { name: (error as Error).name, message: (error as Error).message } },
      message,
    );
  });

  it('answers a coded 500 when the D10 encryption preflight fails during recovery', async () => {
    // The no-copy branch can now reach registration's own encryption
    // preflight when it opens a credential. Fails if this maps to the
    // catch-all 500 register's own route does not use for the same error.
    const cause = new Error('DATA_ENCRYPTION_KEY is not set');
    mockReverifyLibraryRecord.mockRejectedValue(new EncryptionUnavailableError(cause));

    const response = await post();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Credential storage encryption is not available.',
      code: 'CREDENTIALS_ENCRYPTION_UNAVAILABLE',
    });
  });

  it('creates generation two and enqueues only a reference payload', async () => {
    // Fails if the route sends a key or credential content to the durable
    // queue, or if it does not use the transactional send options.
    mockReverifyLibraryRecord.mockImplementation(async (...args: unknown[]) => {
      const prepare = args[2] as () => Promise<(sql: unknown, job: typeof JOB) => Promise<void>>;
      const enqueue = await prepare();
      await enqueue('transaction-sql', JOB);
      return { outcome: 'created', generation: 2, checkRunId: JOB.checkRunId };
    });

    const response = await post();

    expect(response.status).toBe(202);
    expect(mockReverifyLibraryRecord).toHaveBeenCalledWith(RECORD_ID, TENANT_ID, expect.any(Function));
    expect(queue.enqueueWithin).toHaveBeenCalledWith(
      'transaction-sql',
      LIBRARY_VERIFY_JOB,
      JOB,
      VERIFY_JOB_ENQUEUE_OPTIONS,
    );
    expect(response.body).toEqual(RESPONSE);
  });
});
