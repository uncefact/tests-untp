// Mock next/server before importing the route handler (jsdom lacks Request/Response)
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: {
        get: (name: string) => init?.headers?.[name] ?? null,
      },
      json: async () => body,
    }),
  },
}));

// The wrapper is stubbed to skip authentication, but error mapping delegates
// to the real handleRouteError rather than restating it, so a new error class
// maps here exactly as it does in production.
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

const loggerCalls = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('@/lib/api/logger', () => {
  const logger: Record<string, unknown> = {
    info: (...args: unknown[]) => loggerCalls.info(...args),
    warn: (...args: unknown[]) => loggerCalls.warn(...args),
    error: (...args: unknown[]) => loggerCalls.error(...args),
  };
  logger.child = () => logger;
  return { apiLogger: logger };
});

// The verify job module, which the route imports for the job name and its
// enqueue options, reaches the services server barrel through the VC
// resolver; that barrel's DID stack cannot resolve under jest.
jest.mock('@/lib/services/resolve-vc-service', () => ({ resolveVcService: jest.fn() }));

const mockFindIdempotencyKey = jest.fn();
const mockClaimIdempotencyKey = jest.fn();
const mockCompleteIdempotencyKey = jest.fn();
const mockReleaseIdempotencyKey = jest.fn();
jest.mock('@/lib/prisma/repositories/idempotency-key.repository', () => {
  // The real error classes: the route classifies both by instanceof, and a
  // hand-shaped stand-in would let that check pass on a shape the repository
  // never throws.
  const actual = jest.requireActual('@/lib/prisma/repositories/idempotency-key.repository');
  return {
    IdempotencyClaimLostError: actual.IdempotencyClaimLostError,
    IdempotencyClaimOperationMismatchError: actual.IdempotencyClaimOperationMismatchError,
    findIdempotencyKey: (...args: unknown[]) => mockFindIdempotencyKey(...args),
    claimIdempotencyKey: (...args: unknown[]) => mockClaimIdempotencyKey(...args),
    completeIdempotencyKey: (...args: unknown[]) => mockCompleteIdempotencyKey(...args),
    releaseIdempotencyKey: (...args: unknown[]) => mockReleaseIdempotencyKey(...args),
  };
});

const mockGetExternalCredentialById = jest.fn();
jest.mock('@/lib/prisma/repositories/external-credential.repository', () => {
  const actual = jest.requireActual('@/lib/prisma/repositories/external-credential.repository');
  return {
    DuplicateCredentialError: actual.DuplicateCredentialError,
    getExternalCredentialById: (...args: unknown[]) => mockGetExternalCredentialById(...args),
  };
});

const mockListLibraryRecords = jest.fn();
jest.mock('@/lib/prisma/repositories/library-record.repository', () => {
  const actual = jest.requireActual('@/lib/prisma/repositories/library-record.repository');
  return {
    LibraryRecordListError: actual.LibraryRecordListError,
    LIBRARY_LIST_SORTS: actual.LIBRARY_LIST_SORTS,
    listLibraryRecords: (...args: unknown[]) => mockListLibraryRecords(...args),
  };
});

// register-external-credential reaches the resolvers barrel, whose
// multiformats subpath exports do not resolve under jest; the resolver itself
// is never called here, only the module's error classes are needed.
jest.mock('@uncefact/untp-utils/resolvers', () => ({
  ...jest.requireActual('@uncefact/untp-utils/resolvers/errors'),
  resolveDocument: jest.fn(),
}));

const mockRegisterExternalCredential = jest.fn();
const mockDefaultRegisterDependencies = jest.fn();
jest.mock('@/lib/library/register-external-credential', () => {
  const actual = jest.requireActual('@/lib/library/register-external-credential');
  return {
    SourceRejectedError: actual.SourceRejectedError,
    EncryptionUnavailableError: actual.EncryptionUnavailableError,
    StorageKeyMissingError: actual.StorageKeyMissingError,
    registerExternalCredential: (...args: unknown[]) => mockRegisterExternalCredential(...args),
    defaultRegisterDependencies: (...args: unknown[]) => mockDefaultRegisterDependencies(...args),
  };
});

const mockEnqueueWithin = jest.fn();
const mockStartJobQueue = jest.fn();
jest.mock('@/lib/jobs/app-job-queue', () => ({
  startJobQueue: (...args: unknown[]) => mockStartJobQueue(...args),
}));

import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsStatus,
  ExternalContentKind,
  IdempotencyOperation,
  LibraryRecordOrigin,
  type Credential,
  type CheckRun,
  type ExternalCredential,
  type LibraryRecord,
} from '@/lib/prisma/generated';
import { DuplicateCredentialError } from '@/lib/prisma/repositories/external-credential.repository';
import type { ExternalCredentialRecord } from '@/lib/prisma/repositories/external-credential.repository';
import { LibraryRecordListError } from '@/lib/prisma/repositories/library-record.repository';
import { libraryListResult as listResult } from '../../../../../__tests__/route-doubles/library-hydration-result';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { LibraryRecordSelectionError } from '@/lib/library/library-read-errors';
import { ValidationError } from '@/lib/api/validation';
import { credentialRecordSchema } from '@/lib/library/credential-record-projection';
import type { NativeLibraryRecordView } from '@/lib/library/library-record-view';
import {
  EncryptionUnavailableError,
  SourceRejectedError,
  StorageKeyMissingError,
} from '@/lib/library/register-external-credential';
import { ServiceResolutionError, UNEXPECTED_ERROR_MESSAGE } from '@/lib/api/errors';
import {
  IdempotencyClaimLostError,
  IdempotencyClaimOperationMismatchError,
} from '@/lib/prisma/repositories/idempotency-key.repository';
import { LIBRARY_VERIFY_JOB, VERIFY_JOB_ENQUEUE_OPTIONS } from '@/lib/library/verify-generation-job';
import { digestRequestBody } from '@/lib/api/idempotency';
import { GET, POST } from './route';

// ---------------------------------------------------------------------------
// Request helpers, as the credentials route suite builds them
// ---------------------------------------------------------------------------

function bodyBytes(bodyString: string): ArrayBuffer {
  const buf = Buffer.from(bodyString, 'utf8');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function streamingBody(encoded: string) {
  const bytes = new Uint8Array(Buffer.from(encoded, 'utf8'));
  return {
    getReader() {
      let delivered = false;
      return {
        async read() {
          if (delivered) return { done: true as const, value: undefined };
          delivered = true;
          return { done: false as const, value: bytes };
        },
        async cancel() {
          delivered = true;
        },
      };
    },
  };
}

function stubHeaders(init: Record<string, string>): Headers {
  const store = new Map<string, string>();
  for (const [key, value] of Object.entries(init)) {
    store.set(key.toLowerCase(), value);
  }
  return {
    get(name: string) {
      const value = store.get(name.toLowerCase());
      return value === undefined ? null : value;
    },
  } as unknown as Headers;
}

const IDEMPOTENCY_KEY = 'register-key-1';

function createFakeRequest(body?: unknown, extraHeaders?: Record<string, string>): Request {
  const encoded = body === undefined ? 'not-json' : JSON.stringify(body);
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/library',
    headers: stubHeaders({ 'Content-Type': 'application/json', ...extraHeaders }),
    body: streamingBody(encoded),
    arrayBuffer: async () => bodyBytes(encoded),
    text: async () => encoded,
    json: async () => JSON.parse(encoded),
  } as unknown as Request;
}

/** A request carrying the header the route requires, unless a test removes it. */
function registerRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return createFakeRequest(body, { 'Idempotency-Key': IDEMPOTENCY_KEY, ...headers });
}

const AUTH_CONTEXT = { tenantId: 'tenant-1', params: Promise.resolve({}) };

async function post(req: Request) {
  const response = (await POST(req as never, AUTH_CONTEXT as never)) as unknown as {
    status: number;
    headers: { get: (name: string) => string | null };
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: response.status, headers: response.headers, body: await response.json() };
}

function listRequest(url: string): Request {
  return {
    method: 'GET',
    url,
    headers: stubHeaders({}),
  } as unknown as Request;
}

async function get(url: string) {
  const response = (await GET(listRequest(url) as never, AUTH_CONTEXT as never)) as unknown as {
    status: number;
    headers: { get: (name: string) => string | null };
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: response.status, headers: response.headers, body: await response.json() };
}

// ---------------------------------------------------------------------------
// Body and record fixtures
// ---------------------------------------------------------------------------

const SOURCE_URL = 'https://supplier.example/credentials/abc';
const DECRYPTION_KEY = '0123456789abcdef'.repeat(4);

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    sourceUrl: SOURCE_URL,
    sourceEncryption: { decryptionKey: DECRYPTION_KEY },
    annotations: {
      displayName: 'Supplier DCC',
      declaredCredentialType: CoreCredentialType.DCC,
      dateReceived: '2026-08-30',
      notes: 'Arrived by email from the supplier.',
    },
    ...overrides,
  };
}

const RECORD_ID = 'crec0000000000000000000001';

function parent(overrides: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id: RECORD_ID,
    tenantId: 'tenant-1',
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
    tenantId: 'tenant-1',
    origin: LibraryRecordOrigin.EXTERNAL,
    sourceUrl: SOURCE_URL,
    sourceDigest: 'zQmSourceDigest',
    contentDigest: null,
    duplicateOfRecordId: null,
    encrypted: false,
    contentKind: ExternalContentKind.CREDENTIAL,
    storageUri: 'https://storage.example/objects/abc',
    storageDigestMultibase: 'zQmStoredDigest',
    storageServiceInstanceId: 'svc-1',
    storageExternalId: 'obj-1',
    storageBucket: 'library',
    decryptionKey: null,
    displayName: 'Supplier DCC',
    declaredCredentialType: CoreCredentialType.DCC,
    dateReceived: new Date('2026-08-30T00:00:00.000Z'),
    notes: 'Arrived by email from the supplier.',
    annotationVersion: 1,
    decryptionKeyUnused: false,
    createdAt: new Date('2026-09-03T11:00:00.000Z'),
    updatedAt: new Date('2026-09-03T11:00:00.000Z'),
    ...overrides,
  };
}

function run(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 'crun0000000000000000000001',
    recordId: RECORD_ID,
    tenantId: 'tenant-1',
    generation: 1,
    state: CheckRunState.PENDING,
    retrieval: CheckResult.PASS,
    decryption: CheckResult.NOT_RUN,
    digest: CheckResult.PASS,
    proof: CheckResult.NOT_RUN,
    status: CheckResult.NOT_RUN,
    temporal: CheckResult.NOT_RUN,
    schemaConformance: CheckResult.NOT_RUN,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    requestedAt: new Date('2026-09-03T11:00:00.000Z'),
    completedAt: null,
    lastEnqueuedAt: new Date('2026-09-03T11:00:00.000Z'),
    sourceChanged: null,
    lastSourceCheckAt: null,
    ...overrides,
  };
}

function record(
  overrides: { parent?: Partial<LibraryRecord>; external?: Partial<ExternalCredential>; run?: Partial<CheckRun> } = {},
): ExternalCredentialRecord {
  return {
    origin: LibraryRecordOrigin.EXTERNAL,
    record: parent(overrides.parent),
    external: external(overrides.external),
    checkRun: run(overrides.run),
  };
}

function nativeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: RECORD_ID,
    tenantId: 'tenant-1',
    origin: LibraryRecordOrigin.NATIVE,
    storageUri: 'https://storage.example/objects/native',
    digestMultibase: 'zQmNativeDigest',
    decryptionKey: null,
    isPublished: false,
    organisationId: null,
    facilityId: null,
    productId: null,
    createdAt: new Date('2026-09-03T11:00:00.000Z'),
    updatedAt: new Date('2026-09-03T11:00:00.000Z'),
    ...overrides,
  };
}

function nativeRecord(
  overrides: { parent?: Partial<LibraryRecord>; credential?: Partial<Credential>; checkRun?: CheckRun | null } = {},
): NativeLibraryRecordView {
  return {
    origin: LibraryRecordOrigin.NATIVE,
    record: parent({
      origin: LibraryRecordOrigin.NATIVE,
      coreCredentialType: CoreCredentialType.DPP,
      ...overrides.parent,
    }),
    credential: nativeCredential(overrides.credential),
    checkRun: overrides.checkRun ?? null,
  };
}

/** A generation the register call already settled as failed, for the replay read. */
const FAILED_RUN: Partial<CheckRun> = {
  state: CheckRunState.FAILED,
  retrieval: CheckResult.FAIL,
  digest: CheckResult.NOT_RUN,
  failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
  failureMessage: 'The source could not be fetched; try again once it is reachable.',
  failureRetryable: true,
  completedAt: new Date('2026-09-03T11:00:01.000Z'),
  lastEnqueuedAt: null,
  sourceChanged: null,
  lastSourceCheckAt: null,
};

const DEPS_MARKER = { deps: 'register-dependencies' };

function rejected(reason: 'source-not-permitted' | 'invalid-url', message: string): SourceRejectedError {
  return new SourceRejectedError({ kind: 'rejected', reason, error: new Error(message) });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindIdempotencyKey.mockResolvedValue({ outcome: 'absent' });
  mockClaimIdempotencyKey.mockResolvedValue({ outcome: 'claimed', claimId: 'claim-1' });
  mockCompleteIdempotencyKey.mockResolvedValue({ applied: true });
  mockReleaseIdempotencyKey.mockResolvedValue({ applied: true });
  mockRegisterExternalCredential.mockResolvedValue(record());
  mockDefaultRegisterDependencies.mockReturnValue(DEPS_MARKER);
  mockGetExternalCredentialById.mockResolvedValue(record());
  mockStartJobQueue.mockResolvedValue({ enqueueWithin: (...args: unknown[]) => mockEnqueueWithin(...args) });
  mockListLibraryRecords.mockResolvedValue(listResult([], 0));
});

// ---------------------------------------------------------------------------
// The Idempotency-Key header
// ---------------------------------------------------------------------------

describe('POST /api/v1/library idempotency header', () => {
  it('rejects a request with no Idempotency-Key before touching the store', async () => {
    const { status, body } = await post(createFakeRequest(validBody()));

    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.error).toContain('Idempotency-Key');
    expect(mockFindIdempotencyKey).not.toHaveBeenCalled();
    expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
    expect(mockRegisterExternalCredential).not.toHaveBeenCalled();
  });

  it('rejects a blank Idempotency-Key', async () => {
    const { status, body } = await post(registerRequest(validBody(), { 'Idempotency-Key': '   ' }));

    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
  });

  it('answers 422 for a key already used with a different body, before the pipeline runs', async () => {
    // The body is valid, so nothing but the key settles this request. Fails
    // if the mismatch is answered after the source has been fetched, which
    // would let a changed body reach the supplier before being refused.
    mockFindIdempotencyKey.mockResolvedValue({ outcome: 'mismatch' });
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(422);
    expect(body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
    expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
    expect(mockRegisterExternalCredential).not.toHaveBeenCalled();
  });

  it('answers 422 for a key already used with a different body, before parsing this one', async () => {
    mockFindIdempotencyKey.mockResolvedValue({ outcome: 'mismatch' });
    const { status, body } = await post(registerRequest({ sourceUrl: 'not-a-url' }));

    expect(status).toBe(422);
    expect(body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
    expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
  });

  it('answers 409 while an identical request is still in flight', async () => {
    mockFindIdempotencyKey.mockResolvedValue({ outcome: 'in-flight' });
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(409);
    expect(body.code).toBe('IDEMPOTENCY_KEY_IN_FLIGHT');
    expect(mockRegisterExternalCredential).not.toHaveBeenCalled();
  });

  it('replays the record as it is now, rather than registering again', async () => {
    mockFindIdempotencyKey.mockResolvedValue({ outcome: 'replay', recordId: RECORD_ID });
    mockGetExternalCredentialById.mockResolvedValue(record({ run: FAILED_RUN }));
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(201);
    expect(mockGetExternalCredentialById).toHaveBeenCalledWith(RECORD_ID, 'tenant-1');
    expect(body.verification).toMatchObject({ state: 'failed', summary: 'failed' });
    expect(mockRegisterExternalCredential).not.toHaveBeenCalled();
    expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
  });

  it('answers 409 when the replayed record has since been deleted', async () => {
    mockFindIdempotencyKey.mockResolvedValue({ outcome: 'replay', recordId: RECORD_ID });
    mockGetExternalCredentialById.mockResolvedValue(null);
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(409);
    expect(body.code).toBe('IDEMPOTENCY_KEY_RECORD_DELETED');
  });

  it('answers a sanitised 500 when the replayed record cannot be projected', async () => {
    // The replay path projects the same record the fresh path does, so a row
    // the contract forbids must not reach the caller there either. Fails if
    // the replay's 201 stops being guarded.
    mockFindIdempotencyKey.mockResolvedValue({ outcome: 'replay', recordId: RECORD_ID });
    mockGetExternalCredentialById.mockResolvedValue(
      record({ run: { state: CheckRunState.COMPLETE, completedAt: null } }),
    );
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(500);
    expect(String(body.error)).toContain(UNEXPECTED_ERROR_MESSAGE);
    expect(String(body.error)).not.toContain(RECORD_ID);
    expect(String(body.error)).not.toContain('completedAt');
  });

  it('replays when the key was claimed by another request between the read and the claim', async () => {
    mockClaimIdempotencyKey.mockResolvedValue({ outcome: 'replay', recordId: RECORD_ID });
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(201);
    expect(body.id).toBe(RECORD_ID);
    expect(mockRegisterExternalCredential).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The request body
// ---------------------------------------------------------------------------

describe('POST /api/v1/library request validation', () => {
  it.each([
    ['a missing displayName', { annotations: { declaredCredentialType: CoreCredentialType.DCC } }, 'displayName'],
    ['a source URL that is not a URL', { sourceUrl: 'supplier.example/abc' }, 'sourceUrl'],
    [
      'a date that is not a calendar date',
      {
        annotations: { displayName: 'A', declaredCredentialType: CoreCredentialType.DCC, dateReceived: '2026-02-30' },
      },
      'dateReceived',
    ],
  ])('answers 400 naming the field for %s', async (_name, overrides, field) => {
    const { status, body } = await post(registerRequest(validBody(overrides)));

    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(String(body.error)).toContain(field);
    expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
  });

  it.each([
    ['userinfo in the source URL', 'https://user:secret@supplier.example/abc'],
    ['a non-http scheme', 'ftp://supplier.example/abc'],
  ])('answers 400 for %s and claims nothing', async (_name, sourceUrl) => {
    const { status, body } = await post(registerRequest(validBody({ sourceUrl })));

    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(String(body.error)).toContain('sourceUrl');
    expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
    expect(mockRegisterExternalCredential).not.toHaveBeenCalled();
  });

  it.each([
    ['displayName', 'a\0b'],
    ['notes', 'a\0b'],
  ])(
    'rejects a NUL in annotations.%s before claiming or starting work, logging it as a validation error',
    async (field, value) => {
      const requestBody = validBody({
        annotations: { ...validBody().annotations, [field]: value },
      });
      const { status, body } = await post(registerRequest(requestBody));

      expect(status).toBe(400);
      expect(body).toEqual({
        error: `annotations.${field}: must not contain a NUL character`,
        code: 'VALIDATION_FAILED',
      });
      expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
      expect(mockRegisterExternalCredential).not.toHaveBeenCalled();
      expect(mockStartJobQueue).not.toHaveBeenCalled();
      expect(mockDefaultRegisterDependencies).not.toHaveBeenCalled();

      const validationLog = loggerCalls.warn.mock.calls.find(([, message]) => message === 'Validation error');
      expect(validationLog).toBeDefined();
      const loggedError = (validationLog?.[0] as { err: Error }).err;
      expect(loggedError).toBeInstanceOf(Error);
      expect(loggedError.cause).toBeInstanceOf(ValidationError);
    },
  );
});

// ---------------------------------------------------------------------------
// The registration itself
// ---------------------------------------------------------------------------

describe('POST /api/v1/library registration', () => {
  it('claims the key, registers the credential and returns the projected record', async () => {
    const { status, body } = await post(registerRequest(validBody()));

    expect(mockClaimIdempotencyKey).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      operation: IdempotencyOperation.LIBRARY_REGISTER,
      key: IDEMPOTENCY_KEY,
      // The plain digest of the bytes as they arrived. Fails if the route
      // digests the parsed body, or keys the digest with a server secret,
      // either of which would classify a byte-identical retry differently.
      bodyDigest: await digestRequestBody(new Uint8Array(bodyBytes(JSON.stringify(validBody())))),
    });
    expect(mockRegisterExternalCredential).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        // The canonical href, not the caller's string.
        sourceUrl: `${SOURCE_URL}`,
        decryptionKey: DECRYPTION_KEY,
        annotations: {
          displayName: 'Supplier DCC',
          declaredCredentialType: CoreCredentialType.DCC,
          dateReceived: new Date('2026-08-30T00:00:00.000Z'),
          notes: 'Arrived by email from the supplier.',
        },
        idempotencyClaimId: 'claim-1',
      },
      DEPS_MARKER,
    );
    expect(mockCompleteIdempotencyKey).toHaveBeenCalledWith({
      claimId: 'claim-1',
      recordId: RECORD_ID,
      responseBody: null,
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      id: RECORD_ID,
      origin: 'external',
      hasKey: false,
      sourceUrl: SOURCE_URL,
      annotations: {
        annotationVersion: 1,
        displayName: 'Supplier DCC',
        declaredCredentialType: CoreCredentialType.DCC,
        dateReceived: '2026-08-30',
        notes: 'Arrived by email from the supplier.',
      },
      verification: { state: 'pending', summary: 'pending', generation: 1 },
      warnings: [],
    });
  });

  it('reports a supplied key that was never needed as a warning on the record', async () => {
    mockRegisterExternalCredential.mockResolvedValue(record({ external: { decryptionKeyUnused: true } }));
    const { body } = await post(registerRequest(validBody()));

    expect(body.warnings).toEqual([
      expect.objectContaining({ code: 'DECRYPTION_KEY_UNUSED', message: expect.any(String) }),
    ]);
  });

  it('registers without a key when the caller supplied none', async () => {
    const body = validBody();
    delete (body as Record<string, unknown>).sourceEncryption;
    await post(registerRequest(body));

    expect(mockRegisterExternalCredential).toHaveBeenCalledWith(
      expect.not.objectContaining({ decryptionKey: expect.anything() }),
      DEPS_MARKER,
    );
  });

  it('enqueues the verify job on the record transaction through the queue', async () => {
    await post(registerRequest(validBody()));

    const enqueue = mockDefaultRegisterDependencies.mock.calls[0][0] as (sql: unknown, job: unknown) => Promise<void>;
    const sql = { executor: true };
    const job = { tenantId: 'tenant-1', recordId: RECORD_ID, generation: 1, checkRunId: 'crun-1' };
    await enqueue(sql, job);

    expect(mockEnqueueWithin).toHaveBeenCalledWith(sql, LIBRARY_VERIFY_JOB, job, VERIFY_JOB_ENQUEUE_OPTIONS);
    expect(VERIFY_JOB_ENQUEUE_OPTIONS.retry).toEqual({ limit: 4, backoffSeconds: 30, backoffMaxSeconds: 600 });
  });

  it('still answers 201 when the claim could not be finalised', async () => {
    mockCompleteIdempotencyKey.mockRejectedValue(new Error('database unavailable'));
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(201);
    expect(body.id).toBe(RECORD_ID);
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: RECORD_ID }),
      'Failed to finalise the register Idempotency-Key',
    );
  });
});

// ---------------------------------------------------------------------------
// What a failed registration answers
// ---------------------------------------------------------------------------

describe('POST /api/v1/library registration failures', () => {
  it('answers 400 SOURCE_NOT_PERMITTED and releases the claim when the guard refused the source', async () => {
    mockRegisterExternalCredential.mockRejectedValue(
      rejected('source-not-permitted', 'The source address is not permitted'),
    );
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'The source address is not permitted', code: 'SOURCE_NOT_PERMITTED' });
    expect(mockReleaseIdempotencyKey).toHaveBeenCalledWith({ claimId: 'claim-1' });
  });

  it('answers 400 VALIDATION_FAILED when the source URL itself was rejected', async () => {
    mockRegisterExternalCredential.mockRejectedValue(rejected('invalid-url', 'The source URL could not be parsed'));
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(mockReleaseIdempotencyKey).toHaveBeenCalledWith({ claimId: 'claim-1' });
  });

  it('answers 500 CREDENTIALS_ENCRYPTION_UNAVAILABLE and releases the claim when encryption is not available', async () => {
    // The wrapper's message says only that encryption is unavailable, so the
    // operator's line has to carry the reason from its cause. Fails if that
    // one level stops being logged, or if anything deeper than it is.
    const reason = new Error('Missing required DATA_ENCRYPTION_KEY environment variable.', {
      cause: new Error('a deeper failure nobody should see'),
    });
    mockRegisterExternalCredential.mockRejectedValue(new EncryptionUnavailableError(reason));
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(500);
    expect(body).toEqual({
      error: 'Credential storage encryption is not available.',
      code: 'CREDENTIALS_ENCRYPTION_UNAVAILABLE',
    });
    expect(mockReleaseIdempotencyKey).toHaveBeenCalledWith({ claimId: 'claim-1' });
    expect(loggerCalls.error).toHaveBeenCalledWith(
      {
        error: { name: 'EncryptionUnavailableError', message: 'Credential storage encryption is not available.' },
        cause: { name: 'Error', message: 'Missing required DATA_ENCRYPTION_KEY environment variable.' },
        tenantId: 'tenant-1',
        source: 'https://supplier.example',
      },
      'Encryption preflight failed; no record was created',
    );
  });

  it('answers the named duplicate conflict, points at the existing record, and releases the unused claim', async () => {
    // Fails if duplicate registration consumes the retry key, loses the
    // existing id, or lets the shared mapper discard the Location header.
    mockRegisterExternalCredential.mockRejectedValueOnce(new DuplicateCredentialError(RECORD_ID));

    const response = await post(registerRequest(validBody()));

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: `This credential is already registered as record ${RECORD_ID}.`,
      code: 'DUPLICATE_CREDENTIAL',
    });
    expect(response.headers.get('Location')).toBe(`/api/v1/library/${RECORD_ID}`);
    expect(mockReleaseIdempotencyKey).toHaveBeenCalledWith({ claimId: 'claim-1' });
    // Building the response here bypasses the shared mapper, and with it the
    // conflict line every other 409 on this route leaves. Fails if this
    // rejection goes back to being the one conflict with no log entry.
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', source: 'https://supplier.example', existingRecordId: RECORD_ID },
      'Duplicate credential content',
    );
  });

  it('answers 409 without releasing when another request took the claim', async () => {
    mockRegisterExternalCredential.mockRejectedValue(new IdempotencyClaimLostError());
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(409);
    expect(body.code).toBe('IDEMPOTENCY_KEY_IN_FLIGHT');
    expect(mockReleaseIdempotencyKey).not.toHaveBeenCalled();
  });

  it('sanitises the 500 when the claim could not be linked to its record', async () => {
    mockRegisterExternalCredential.mockRejectedValue(
      new IdempotencyClaimOperationMismatchError(
        'claim-1',
        IdempotencyOperation.CREDENTIAL_ISSUE,
        IdempotencyOperation.LIBRARY_REGISTER,
      ),
    );
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(500);
    expect(String(body.error)).not.toContain('claim');
    expect(String(body.error)).not.toContain('claim-1');
    expect(mockReleaseIdempotencyKey).toHaveBeenCalledWith({ claimId: 'claim-1' });
  });

  it('releases the claim and answers a sanitised 500 for an error it does not classify', async () => {
    // An unmapped failure here is the deployment's own business (a storage
    // adapter's exception, a service instance's configuration), so its
    // message must not reach the caller. Fails if the wrapper stops
    // sanitising and the shared mapper echoes the message again.
    mockRegisterExternalCredential.mockRejectedValue(new Error('the storage adapter exploded'));
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(500);
    expect(String(body.error)).toContain(UNEXPECTED_ERROR_MESSAGE);
    expect(String(body.error)).not.toContain('the storage adapter exploded');
    expect(body.code).toBeUndefined();
    expect(mockReleaseIdempotencyKey).toHaveBeenCalledWith({ claimId: 'claim-1' });
  });

  it('sanitises a service-resolution failure and still releases the claim', async () => {
    // A ServiceRegistryError names the deployment's own registry wiring.
    // Fails if the wrapper only catches plain Errors, letting a typed
    // registry error through to the mapper, which would echo its message.
    mockRegisterExternalCredential.mockRejectedValue(new ServiceResolutionError('STORAGE', 'tenant-1'));
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(500);
    expect(String(body.error)).toContain(UNEXPECTED_ERROR_MESSAGE);
    expect(String(body.error)).not.toContain('No service instance available');
    expect(body.code).toBeUndefined();
    expect(mockReleaseIdempotencyKey).toHaveBeenCalledWith({ claimId: 'claim-1' });
  });

  it('answers a sanitised 500 and claims nothing when the job queue cannot start', async () => {
    // Fails if the queue start moves back after the claim, or if its message
    // (which names the deployment's own wiring) reaches the caller.
    mockStartJobQueue.mockRejectedValue(new Error('RI_DATABASE_URL is not set for the job queue'));
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(500);
    expect(String(body.error)).toContain(UNEXPECTED_ERROR_MESSAGE);
    expect(String(body.error)).not.toContain('RI_DATABASE_URL');
    expect(body.code).toBeUndefined();
    expect(mockClaimIdempotencyKey).not.toHaveBeenCalled();
    expect(mockReleaseIdempotencyKey).not.toHaveBeenCalled();
    expect(mockRegisterExternalCredential).not.toHaveBeenCalled();
  });

  it('answers a sanitised 500 when the store returned no key', async () => {
    // Fails if StorageKeyMissingError falls through to the unmapped branch,
    // which echoes its message back to the caller.
    mockRegisterExternalCredential.mockRejectedValue(new StorageKeyMissingError());
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(500);
    expect(String(body.error)).toContain(UNEXPECTED_ERROR_MESSAGE);
    expect(mockReleaseIdempotencyKey).toHaveBeenCalledWith({ claimId: 'claim-1' });
  });

  it('carries no storage coordinates in the message a recovery would publish', () => {
    // This message is not confined to a sanitised 500: the key-bearing
    // recovery path copies it onto the settled generation's `failureMessage`,
    // which the record publishes. The object's URI, external id and bucket
    // are this deployment's own storage addresses and belong on the operator
    // log line the raising site writes, not on a tenant's record. Fails if
    // the class takes a URI again and interpolates it.
    const message = new StorageKeyMissingError().message;

    expect(message).not.toMatch(/https?:\/\//);
    expect(message).toContain('needs an operator');
  });

  it('still answers the mapped 400 when releasing the claim itself fails', async () => {
    // Fails if releaseClaim stops swallowing its own failure: the caller would
    // then receive a 500 for a source the guard deterministically rejected.
    mockReleaseIdempotencyKey.mockRejectedValue(new Error('database unavailable'));
    mockRegisterExternalCredential.mockRejectedValue(rejected('invalid-url', 'The source URL could not be parsed'));
    const { status, body } = await post(registerRequest(validBody()));

    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({ claimId: 'claim-1' }),
      'Failed to release the register Idempotency-Key',
    );
  });

  it('warns rather than failing the request when the claim was no longer owned at release time', async () => {
    mockReleaseIdempotencyKey.mockResolvedValue({ applied: false });
    mockRegisterExternalCredential.mockRejectedValue(rejected('invalid-url', 'The source URL could not be parsed'));
    const { status } = await post(registerRequest(validBody()));

    expect(status).toBe(400);
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      { claimId: 'claim-1' },
      'Registration failed but the Idempotency-Key claim was no longer owned',
    );
  });
});

// ---------------------------------------------------------------------------
// The caller's key never reaches the log
// ---------------------------------------------------------------------------

describe('POST /api/v1/library logging', () => {
  it('never writes the caller-supplied decryption key into any log line', async () => {
    mockRegisterExternalCredential.mockRejectedValue(new Error('the storage adapter exploded'));
    await post(registerRequest(validBody()));

    // The key was carried by this request, so an empty haystack would not be
    // a pass: the register call received it and the failure path logged.
    expect(mockRegisterExternalCredential).toHaveBeenCalledWith(
      expect.objectContaining({ decryptionKey: DECRYPTION_KEY }),
      DEPS_MARKER,
    );
    const logged = [...loggerCalls.info.mock.calls, ...loggerCalls.warn.mock.calls, ...loggerCalls.error.mock.calls];
    expect(logged.length).toBeGreaterThan(0);
    for (const call of logged) {
      const text = JSON.stringify(call, (_key, value) => (value instanceof Error ? String(value.stack) : value));
      expect(text).not.toContain(DECRYPTION_KEY);
    }
  });

  it('logs the source origin only, never the path and query the supplier link carries', async () => {
    // A supplier's link can carry a capability token in its query. Fails if any
    // log line goes back to carrying the whole URL.
    const sourceUrl = 'https://supplier.example/credentials/abc?token=SECRET-CAPABILITY-TOKEN';
    mockRegisterExternalCredential.mockRejectedValue(new EncryptionUnavailableError(new Error('no key material')));
    await post(registerRequest(validBody({ sourceUrl })));

    const logged = [...loggerCalls.info.mock.calls, ...loggerCalls.warn.mock.calls, ...loggerCalls.error.mock.calls];
    expect(logged.length).toBeGreaterThan(0);
    for (const call of logged) {
      const text = JSON.stringify(call, (_key, value) => (value instanceof Error ? String(value.stack) : value));
      expect(text).not.toContain('SECRET-CAPABILITY-TOKEN');
      expect(text).not.toContain('/credentials/abc');
    }
    // The origin is what a reader needs, and it is kept.
    expect(loggerCalls.info).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', source: 'https://supplier.example' },
      'Registering an external credential',
    );
  });
});

describe('GET /api/v1/library', () => {
  it('returns the standard paginated, keyless envelope and prevents caching', async () => {
    mockListLibraryRecords.mockResolvedValue(listResult([record()], 1));

    const response = await get('http://localhost/api/v1/library');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.body.pagination).toEqual({ total: 1, limit: 20, offset: 0, hasMore: false });
    expect(response.body.failures).toEqual([]);
    const listed = (response.body.data as Record<string, unknown>[])[0];
    expect(listed).toEqual(expect.objectContaining({ id: RECORD_ID, origin: 'external' }));
    expect(listed).not.toHaveProperty('decryptionKey');
    expect(listed).not.toHaveProperty('storageUri');
    expect(listed).not.toHaveProperty('digestMultibase');
    expect(credentialRecordSchema.safeParse(listed).success).toBe(true);
  });

  it('projects a native row through the handler with the keyless native envelope', async () => {
    mockListLibraryRecords.mockResolvedValue(listResult([nativeRecord()], 1));

    const response = await get('http://localhost/api/v1/library');
    const listed = (response.body.data as unknown[])[0] as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(listed).toEqual(expect.objectContaining({ id: RECORD_ID, origin: 'native' }));
    expect(listed).not.toHaveProperty('decryptionKey');
    expect(credentialRecordSchema.safeParse(listed).success).toBe(true);
    expect(response.body.failures).toEqual([]);
  });

  it('passes repeatable type and the filters through after full validation', async () => {
    await get(
      'http://localhost/api/v1/library?type=DPP&type=DFR&origin=external&organisationId=organisation-1&facilityId=facility-1&productId=product-1&issuer=Acme&encrypted=false&status=pending&issuedFrom=2026-01-01&issuedTo=2026-01-31&sort=createdAt:asc&limit=4&offset=2',
    );

    expect(mockListLibraryRecords).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      type: [CoreCredentialType.DPP, CoreCredentialType.DFR],
      origin: 'external',
      organisationId: 'organisation-1',
      facilityId: 'facility-1',
      productId: 'product-1',
      issuer: 'Acme',
      encrypted: false,
      status: 'pending',
      sort: 'createdAt:asc',
      limit: 4,
      offset: 2,
      issuedFrom: new Date('2026-01-01T00:00:00.000Z'),
      issuedTo: new Date('2026-01-31T23:59:59.999Z'),
    });
  });

  it('rejects every present q form before any other query validation', async () => {
    for (const query of ['?q', '?q=', '?q=   ', '?q=a&q=b']) {
      mockListLibraryRecords.mockClear();
      const response = await get(`http://localhost/api/v1/library${query}&limit=not-an-integer`);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Free-text search is not yet available in v1.',
        code: 'FREE_TEXT_SEARCH_DEFERRED',
      });
      expect(mockListLibraryRecords).not.toHaveBeenCalled();
    }
  });

  it('returns the named page-limit error without querying the repository', async () => {
    const response = await get('http://localhost/api/v1/library?limit=101');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'PAGE_LIMIT_EXCEEDED' });
    expect(response.body.error).toContain('limit: must not exceed the maximum of');
    expect(mockListLibraryRecords).not.toHaveBeenCalled();
  });

  it.each(['issuer', 'organisationId', 'facilityId', 'productId'])(
    'returns an empty page for a NUL %s filter after validation, without sending it to Postgres',
    async (key) => {
      mockListLibraryRecords.mockClear();
      const response = await get(`http://localhost/api/v1/library?${key}=${encodeURIComponent('\0')}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: [],
        pagination: { total: 0, limit: 20, offset: 0, hasMore: false },
        failures: [],
      });
      expect(mockListLibraryRecords).not.toHaveBeenCalled();
    },
  );

  it('returns readable rows and an ordered failure when one selected projection fails', async () => {
    const brokenDate = {
      toISOString: () => {
        throw new Error('row-local date conversion');
      },
    } as unknown as Date;
    const damaged = record({ parent: { id: 'record-damaged', createdAt: brokenDate } });
    mockListLibraryRecords.mockResolvedValue(listResult([record(), damaged], 2));
    const response = await get('http://localhost/api/v1/library');

    expect(response.status).toBe(200);
    expect((response.body.data as { id: string }[]).map(({ id }) => id)).toEqual([RECORD_ID]);
    expect(response.body.failures).toEqual([
      {
        id: 'record-damaged',
        code: 'RECORD_UNREADABLE',
        message: expect.stringContaining('x-correlation-id response header'),
      },
    ]);
    expect(response.body.pagination).toMatchObject({ hasMore: false });
  });

  it('still says more remain when every row on a non-final page is unreadable', async () => {
    // The other direction of the same rule. An implementation that reported
    // hasMore: false whenever `data` is empty passes the mixed-page case above
    // and strands the caller here, one page into a set they cannot finish.
    mockListLibraryRecords.mockResolvedValue(
      listResult([], 4, [
        { id: 'record-damaged-1', error: new LibraryRecordShapeError('record-damaged-1', 'has no run') },
        { id: 'record-damaged-2', error: new LibraryRecordShapeError('record-damaged-2', 'has no run') },
      ]),
    );

    const response = await get('http://localhost/api/v1/library?limit=2');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect((response.body.failures as { id: string }[]).map(({ id }) => id)).toEqual([
      'record-damaged-1',
      'record-damaged-2',
    ]);
    expect(response.body.pagination).toEqual({ total: 4, limit: 2, offset: 0, hasMore: true });
  });

  it('emits one summary line carrying the counts for the request that produced them', async () => {
    mockListLibraryRecords.mockResolvedValue(
      listResult([record()], 2, [
        { id: 'record-damaged', error: new LibraryRecordShapeError('record-damaged', 'no run') },
      ]),
    );

    await get('http://localhost/api/v1/library');

    const summaries = loggerCalls.info.mock.calls.filter(([, message]) => message === 'Library record read summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0][0]).toMatchObject({
      route: '/api/v1/library',
      returned: 1,
      unreadable: 1,
      notFound: 0,
    });
  });

  it('sanitises a selection-boundary failure and publishes no id from it', async () => {
    // A row outside the page's selection cannot be attributed to any id, so
    // the whole request fails and the offending id stays out of the body.
    mockListLibraryRecords.mockRejectedValue(
      new LibraryRecordSelectionError('record record-foreign was returned during hydration but was not selected'),
    );

    const response = await get('http://localhost/api/v1/library');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'An unexpected error has occurred.' });
    expect(JSON.stringify(response.body)).not.toContain('record-foreign');
  });

  it.each([
    ['a non-Error throw', 'internal list failure'],
    ['a list invariant error', new LibraryRecordListError('the total was inconsistent')],
  ])('sanitises %s', async (_description, failure) => {
    mockListLibraryRecords.mockRejectedValue(failure);

    const response = await get('http://localhost/api/v1/library');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('An unexpected error has occurred.');
    expect(response.body.error).not.toContain(String(failure));
  });

  it('sanitises an unclassified Error from the list path', async () => {
    mockListLibraryRecords.mockRejectedValue(new Error('Database error'));

    const response = await get('http://localhost/api/v1/library');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('An unexpected error has occurred.');
    expect(response.body.error).not.toContain('Database error');
  });
});
