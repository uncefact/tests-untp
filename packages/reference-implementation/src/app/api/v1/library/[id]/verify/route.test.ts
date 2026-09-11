jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: HeadersInit }) => ({
      status: init?.status ?? 200,
      json: async () => body,
      headers: new Headers(init?.headers),
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

jest.mock('@/lib/api/logger');
const loggerCalls = jest.requireMock('@/lib/api/logger').apiLogger as Record<string, jest.Mock>;

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
import {
  DecryptionRequiredError,
  reverifyLibraryRecord,
  SourceEncryptionNotAllowedError,
  VerificationInProgressError,
} from '@/lib/library/reverify-library-record';
import { VERIFICATION_IN_PROGRESS_MESSAGE, VERIFICATION_RACE_LOST_MESSAGE } from '@/lib/library/reverify-messages';
import { EncryptionUnavailableError } from '@/lib/library/register-external-credential';
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
    schemaConformanceMessage: overrides.schemaConformanceMessage ?? null,
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
    storageServiceInstanceId: null,
    storageExternalId: null,
    storageBucket: null,
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
    headers: Headers;
  };
  return { status: response.status, body: await response.json(), headers: response.headers };
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
  it.each([
    ['an empty object', '{}'],
    ['unknown fields only', '{"ignored":true}'],
    ['the wrapper with no key', '{"sourceEncryption":{}}'],
    // Whitespace is not bodyless. It reaches `JSON.parse`, which throws, and
    // the route recodes that to VALIDATION_FAILED. Move that parse one line
    // out of `parseRequestBody`'s own try and this becomes a sanitised 500
    // with nothing else failing, which is why the case is pinned here.
    ['whitespace', '   '],
    ['malformed JSON', '{"sourceEncryption":{"decryptionKey":'],
    ['a JSON null literal', 'null'],
    ['a JSON array', '[{"sourceEncryption":{"decryptionKey":"' + 'a'.repeat(64) + '"}}]'],
    ['a bad hex key', '{"sourceEncryption":{"decryptionKey":"not-hex"}}'],
    ['a padded hex key', '{"sourceEncryption":{"decryptionKey":" ' + 'a'.repeat(64) + ' "}}'],
    ['an empty-string key', '{"sourceEncryption":{"decryptionKey":""}}'],
  ])('rejects %s before reading the record', async (_name, body) => {
    // Fails if an invalid non-empty body is treated as bodyless and reaches
    // the generation path without a usable key.
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(mockGetLibraryRecordById).not.toHaveBeenCalled();
  });

  it('passes a valid key after the single bounded body read', async () => {
    // Fails if the route accepts a method-only body or drops the key before
    // the orchestration boundary. It also catches a second read of the
    // request, but only because this fake's reader answers `{ done: true }`
    // the second time: a double read then yields zero bytes, the request
    // reads as bodyless, and no key reaches the assertion below. A real
    // `Request` is what the integration layer uses; this is the unit-layer
    // approximation of it.
    await post(JSON.stringify({ sourceEncryption: { decryptionKey: 'a'.repeat(64) } }));

    expect(mockReverifyLibraryRecord).toHaveBeenCalledWith(RECORD_ID, TENANT_ID, expect.any(Function), 'a'.repeat(64));
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

  it('maps an applicable key conflict to 409 with a relative Location, and logs its own warn line', async () => {
    // Fails if a key-bearing request joins a pending generation and silently
    // discards the only key that could open the stored copy.
    //
    // The warn line is the second half of the bypass this branch makes:
    // building the response here rather than through the shared mapper is
    // what lets it set `Location`, and it also skips the mapper's own
    // conflict line, so this rejection has to write one. `POST
    // /api/v1/library`'s duplicate-content 409 sets the same precedent.
    mockReverifyLibraryRecord.mockRejectedValue(new VerificationInProgressError('pending', 3));

    const response = await post(JSON.stringify({ sourceEncryption: { decryptionKey: 'b'.repeat(64) } }));

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: VERIFICATION_IN_PROGRESS_MESSAGE,
      code: 'VERIFICATION_IN_PROGRESS',
    });
    expect(response.headers.get('Location')).toBe(`/api/v1/library/${RECORD_ID}`);
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'pending', generation: 3 }),
      'Key-bearing re-verification refused: the record cannot take this key now',
    );
  });

  it('answers a doubly-lost race with the same 409 and a message saying the key was not used', async () => {
    // Nothing is in progress on this path: the winner has already
    // settled and the record is still eligible. Fails if both reasons share
    // one sentence again, which sends this caller to poll for a settlement
    // that already happened.
    mockReverifyLibraryRecord.mockRejectedValue(new VerificationInProgressError('race-lost', 4));

    const response = await post(JSON.stringify({ sourceEncryption: { decryptionKey: 'b'.repeat(64) } }));

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: VERIFICATION_RACE_LOST_MESSAGE,
      code: 'VERIFICATION_IN_PROGRESS',
    });
    expect(response.headers.get('Location')).toBe(`/api/v1/library/${RECORD_ID}`);
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'race-lost', generation: 4 }),
      'Key-bearing re-verification refused: the record cannot take this key now',
    );
  });

  it('rejects a key-bearing call that passes undefined where the key goes', () => {
    // PD2. The implementation decides which form it was given by testing the
    // fourth argument's type, so `undefined` there takes the BODYLESS arm and
    // silently drops the `deps` in the fifth position, running the real
    // repository, the real fetch and the real storage against a test's
    // doubles. Narrowing the overload to `string` makes it a compile error;
    // this line fails to compile, and the suite fails to run, if the
    // parameter widens back to `string | undefined`.
    // @ts-expect-error a key-bearing call must pass a key, never undefined
    void ((): unknown => reverifyLibraryRecord('r', 't', async () => async () => undefined, undefined, {} as never));
  });

  it('maps a key on native or protected custody to SOURCE_ENCRYPTION_NOT_ALLOWED', async () => {
    // Fails if applicability is checked after the pending join or if a key is
    // accepted for a copy that is already protected by the receiver.
    mockReverifyLibraryRecord.mockRejectedValue(new SourceEncryptionNotAllowedError());

    const response = await post(JSON.stringify({ sourceEncryption: { decryptionKey: 'c'.repeat(64) } }));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: new SourceEncryptionNotAllowedError().message,
      code: 'SOURCE_ENCRYPTION_NOT_ALLOWED',
    });
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
