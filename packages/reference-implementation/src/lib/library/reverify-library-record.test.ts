const logLines: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = [];

/**
 * The same calls again, rendered by the REAL pino logger into a captured
 * destination. The reduced `{ level, message }` capture above is convenient
 * for pinning which lines were written, and structurally cannot see a leak:
 * it discards every binding, so a line that hands pino a raw `err` for it to
 * expand, cause chain and all, looks identical to one that reduced it. Any
 * assertion about what a line CARRIES is made against these strings.
 */
const renderedLogLines: string[] = [];

jest.mock('@/lib/api/logger', () => {
  const { createLogger } = jest.requireActual('@uncefact/untp-ri-services/logging');
  const rendering = createLogger({
    level: 'debug',
    destination: { write: (line: string) => renderedLogLines.push(line) },
  });
  const record =
    (level: 'info' | 'warn' | 'error') =>
    (...args: unknown[]) => {
      logLines.push({ level, message: String(args[args.length - 1]) });
      (rendering as Record<string, (...a: unknown[]) => void>)[level](...args);
    };
  const logger: Record<string, unknown> = { info: record('info'), warn: record('warn'), error: record('error') };
  logger.child = () => logger;
  return { apiLogger: logger };
});

jest.mock('@/lib/services/resolve-vc-service', () => ({ resolveVcService: jest.fn() }));
// `settleReservationQueueUnavailable` calls `settleCheckRunFailed` directly
// (not through the injectable deps, since it is an edge-case cleanup path
// rather than a decision this module owns), so it is spied here rather than
// through the `deps` object the rest of this file uses.
const mockSettleCheckRunFailed = jest.fn().mockResolvedValue({ outcome: 'applied' });
jest.mock('@/lib/prisma/repositories/check-run.repository', () => ({
  ...jest.requireActual('@/lib/prisma/repositories/check-run.repository'),
  settleCheckRunFailed: (...args: unknown[]) => mockSettleCheckRunFailed(...args),
}));
// The removal of a retired copy resolves the storage instance the retired
// coordinates name. Mocked here so no test reaches a real adapter, and so a
// case can make the removal fail.
const mockStorageDelete = jest.fn();
const mockResolveStorageService = jest.fn();
const mockRemoveStoredObject = jest.fn();
jest.mock('@/lib/services/resolve-storage-service', () => ({
  resolveStorageService: (...args: unknown[]) => mockResolveStorageService(...args),
}));
jest.mock('./remove-stored-object', () => ({
  ...jest.requireActual('./remove-stored-object'),
  removeStoredObject: (...args: unknown[]) => mockRemoveStoredObject(...args),
}));
jest.mock('@uncefact/untp-utils/resolvers', () => ({
  ...jest.requireActual('@uncefact/untp-utils/resolvers/errors'),
  resolveDocument: jest.fn(),
}));
jest.mock('@uncefact/untp-utils/node', () => ({
  ...jest.requireActual('@uncefact/untp-utils/node'),
  validatePublicUrl: jest.fn(),
}));

import { createCipheriv, randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import {
  CheckResult,
  CheckRunFailureCode,
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
import { ConfigDecryptionError, ConfigValidationError, NotFoundError, ServiceResolutionError } from '@/lib/api/errors';
import { CredentialDocumentFetchError, type DocumentFetchFailure } from '@/lib/credentials/fetch-credential-document';
import { LibraryRecordShapeError, type NativeLibraryRecordView } from '@/lib/library/library-record-view';
import { noChecksRun, RecoveryLockDiscoveryExhaustedError } from '@/lib/prisma/repositories/check-run.repository';
import { StoredCopyReadError } from '@/lib/library/verify-generation-job';
import {
  ABANDONED_UNOPENED_COPY_MESSAGE,
  ENCRYPTION_UNAVAILABLE_RECOVERY_DETAIL,
  RESUME_BY_RESENDING_KEY,
  RESUME_BY_REVERIFYING,
  STORED_COPY_DIGEST_MISMATCH_MESSAGE,
  storedCopyReadFailedMessage,
  VERIFICATION_IN_PROGRESS_MESSAGE,
  VERIFICATION_RACE_LOST_MESSAGE,
} from './reverify-messages';
import {
  EncryptionUnavailableError,
  settleInRequest,
  StoreAttemptFailedError,
  type AcquiredCredentialInput,
  type RecoverFromSourceOptions,
  type RecoverFromStoredCopyOptions,
  type RegisterExternalCredentialDependencies,
  type RegisterExternalCredentialInput,
} from '@/lib/library/register-external-credential';
import {
  DecryptionRequiredError,
  reverifyLibraryRecord,
  type EnqueueVerification,
  type PrepareEnqueue,
  type ReverifyLibraryRecordDependencies,
} from './reverify-library-record';

/**
 * `jest.fn` in this project's @types/jest takes the mock's return type and
 * argument tuple as two separate generics, not the function type itself.
 * This wrapper takes the function type once, so a seam's real signature
 * checks every call site instead of falling back to `any`.
 */
function typedMock<F extends (...args: never[]) => unknown>(): jest.Mock<ReturnType<F>, Parameters<F>> {
  return jest.fn<ReturnType<F>, Parameters<F>>();
}

const RECORD_ID = 'crec0000000000000000000001';
const TENANT_ID = 'tenant-1';
const SOURCE_URL = 'https://supplier.example/credential-a';
const STORAGE_URI = 'https://storage.example/objects/abc';
const SOURCE_BYTES = new TextEncoder().encode('{"credential":true}');

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
    sourceUrl: SOURCE_URL,
    sourceDigest: 'zQmOriginalSourceDigest',
    encrypted: false,
    contentKind: ExternalContentKind.CREDENTIAL,
    storageUri: STORAGE_URI,
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

/** What a reservation observes for a record with no durable copy: mode A. */
const NO_COPY_CUSTODY = {
  storageUri: null,
  storageDigestMultibase: null,
  storageExternalId: null,
  decryptionKeyPresent: false,
  encrypted: null,
} as const;

/** The bytes a stored unopened copy returns in this suite. */
const STORED_CIPHERTEXT = new TextEncoder().encode('{"ciphertext":"opaque"}');

/**
 * What a reservation observes for a record holding an unopened encrypted
 * copy: mode B. The digest is computed from {@link STORED_CIPHERTEXT} so the
 * integrity check the acquisition runs actually passes.
 */
async function rawCopyCustody(overrides: Record<string, unknown> = {}) {
  return {
    storageUri: STORAGE_URI,
    storageDigestMultibase: (
      await MultibaseDigest.fromData(STORED_CIPHERTEXT, { algorithm: 'sha2-256', base: 'base58btc' })
    ).toString(),
    storageExternalId: 'obj-1',
    decryptionKeyPresent: false,
    encrypted: true,
    ...overrides,
  };
}

/** A record holding an unopened encrypted copy, as the entry read sees it. */
function unopenedCopyView(overrides: Partial<ExternalCredential> = {}) {
  return view({ external: { decryptionKey: null, encrypted: true, ...overrides } });
}

const NATIVE_STORAGE_URI = 'https://storage.example/native/credential-a';

function nativeView(overrides: { run?: Partial<CheckRun> | null } = {}): NativeLibraryRecordView {
  const credential: Credential = {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.NATIVE,
    storageUri: NATIVE_STORAGE_URI,
    digestMultibase: 'zQmNativeStoredDigest',
    decryptionKey: 'protected-receiver-key',
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
    checkRun: overrides.run === null ? null : run(overrides.run),
  };
}

function fetchFailure(failure: DocumentFetchFailure): CredentialDocumentFetchError {
  return new CredentialDocumentFetchError(failure);
}

function dependencies(overrides: Partial<ReverifyLibraryRecordDependencies> = {}): ReverifyLibraryRecordDependencies {
  return {
    // Typed on the interface's own signatures, not left to infer from the
    // resolved value, so a seam that drifts from ReverifyLibraryRecordDependencies
    // fails here instead of only at a call site deep in the module under test.
    getRecord: typedMock<ReverifyLibraryRecordDependencies['getRecord']>().mockResolvedValue(view()),
    fetchSource: typedMock<ReverifyLibraryRecordDependencies['fetchSource']>().mockResolvedValue({
      bytes: SOURCE_BYTES,
      finalUrl: SOURCE_URL,
    }),
    createGeneration: typedMock<ReverifyLibraryRecordDependencies['createGeneration']>().mockResolvedValue({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
    }),
    reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
      outcome: 'reserved',
      generation: 2,
      checkRunId: 'run-2',
      identity: { contentDigest: null, duplicateOfRecordId: null },
      // The mode, the acquisition target and the finalisation fence all come
      // from THIS snapshot, not from whatever the entry read saw, so a double
      // that omits it would test mode selection against the wrong state.
      custody: NO_COPY_CUSTODY,
    }),
    finaliseGeneration: typedMock<ReverifyLibraryRecordDependencies['finaliseGeneration']>().mockResolvedValue({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
    }),
    // Required, so a partial deps object cannot silently fall through to the
    // real `fetch` against a storage URI.
    fetchStoredCopy:
      typedMock<ReverifyLibraryRecordDependencies['fetchStoredCopy']>().mockResolvedValue(STORED_CIPHERTEXT),
    ...overrides,
  };
}

const enqueue = typedMock<EnqueueVerification>();
enqueue.mockImplementation(async () => undefined);
/** Readied only once the module has decided a generation will be created. */
const prepareEnqueue = typedMock<PrepareEnqueue>();
prepareEnqueue.mockImplementation(async () => enqueue);

beforeEach(() => {
  logLines.length = 0;
  renderedLogLines.length = 0;
  jest.clearAllMocks();
  prepareEnqueue.mockImplementation(async () => enqueue);
  mockStorageDelete.mockResolvedValue(undefined);
  mockResolveStorageService.mockResolvedValue({ service: { delete: mockStorageDelete } });
  mockRemoveStoredObject.mockImplementation(
    async (tenantId: string, storage: Parameters<typeof import('./remove-stored-object').removeStoredObject>[1]) => {
      const actual = jest.requireActual('./remove-stored-object') as typeof import('./remove-stored-object');
      return actual.removeStoredObject(tenantId, storage);
    },
  );
});

describe('reverifyLibraryRecord', () => {
  it('checks a protected source for freshness without changing the pinned custody tuple', async () => {
    // Fails if re-verification silently replaces the pinned copy or omits the
    // source comparison that reports supplier drift.
    const sourceDigest = (
      await MultibaseDigest.fromData(SOURCE_BYTES, { algorithm: 'sha2-256', base: 'base58btc' })
    ).toString();
    const deps = dependencies({
      fetchSource: jest.fn().mockResolvedValue({ bytes: SOURCE_BYTES, finalUrl: SOURCE_URL }),
    });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, {
      ...deps,
      getRecord: jest.fn().mockResolvedValue(view({ external: { sourceDigest } })),
    });

    expect(deps.fetchSource).toHaveBeenCalledWith(SOURCE_URL);
    expect(deps.createGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: RECORD_ID,
        tenantId: TENANT_ID,
        expectedGeneration: 1,
        expectedCustody: {
          storageUri: STORAGE_URI,
          storageDigestMultibase: 'zQmStoredDigest',
          storageExternalId: 'obj-1',
          decryptionKeyPresent: true,
          encrypted: false,
        },
        expectedOrigin: LibraryRecordOrigin.EXTERNAL,
        freshness: { sourceChanged: false, checkedAt: expect.any(Date) },
        enqueue,
      }),
    );
  });

  it('records changed when the fresh source digest differs from the pinned baseline', async () => {
    // Fails if freshness is inferred from the content kind or if a changed
    // source is overwritten instead of recorded on the new generation.
    const deps = dependencies();

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

    expect(deps.createGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ freshness: { sourceChanged: true, checkedAt: expect.any(Date) } }),
    );
  });

  it('records not_checked with a timestamp when the supplier source cannot be fetched', async () => {
    // Fails if a source outage is collapsed into unchanged or freshness is
    // silently omitted from the settled envelope.
    const deps = dependencies({ fetchSource: jest.fn().mockRejectedValue(new Error('supplier unavailable')) });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

    expect(deps.createGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ freshness: { sourceChanged: null, checkedAt: expect.any(Date) } }),
    );
  });

  it.each([
    ['a guard rejection', { kind: 'rejected', reason: 'source-not-permitted', error: new Error('blocked') }],
    ['an HTTP status', { kind: 'failed', reason: 'http', status: 503, error: new Error('503') }],
    ['a DNS fault', { kind: 'failed', reason: 'dns', error: new Error('ENOTFOUND') }],
    ['a timeout', { kind: 'failed', reason: 'timeout', error: new Error('timed out') }],
    ['an over-sized body', { kind: 'failed', reason: 'too-large', error: new Error('too large') }],
  ] as Array<[string, DocumentFetchFailure]>)(
    'records not_checked when the source fetch reports %s',
    async (_label, failure) => {
      // Fails if any typed fetch failure is allowed to become a comparison
      // result, or to abandon the generation instead of recording that the
      // source could not be checked.
      const deps = dependencies({ fetchSource: jest.fn().mockRejectedValue(fetchFailure(failure)) });

      await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

      expect(deps.createGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ freshness: { sourceChanged: null, checkedAt: expect.any(Date) } }),
      );
    },
  );

  it('logs one entry breadcrumb per request', async () => {
    // The route projects the answer and repeats none of this module's
    // decisions. Fails if the entry line is emitted from two owners again, so
    // that any count taken from the logs is doubled.
    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, dependencies());

    expect(logLines.filter((line) => line.message === 'Re-verification entered')).toHaveLength(1);
  });

  it.each([
    ['a record that does not exist', () => dependencies({ getRecord: jest.fn().mockResolvedValue(null) })],
    [
      'a pending generation to join',
      () => dependencies({ getRecord: jest.fn().mockResolvedValue(view({ run: { state: CheckRunState.PENDING } })) }),
    ],
    [
      'an unopened protected copy',
      () =>
        dependencies({
          getRecord: jest.fn().mockResolvedValue(view({ external: { encrypted: true, decryptionKey: null } })),
        }),
    ],
  ])('readies the enqueue only after it has decided, so %s never reaches it', async (_label, build) => {
    // Fails if a caller has to hand over a live queue before the record is
    // read, which would turn a not-found, a join and a key refusal into
    // server errors the moment the queue is unavailable.
    const deps = build();

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps).catch(() => undefined);

    expect(prepareEnqueue).not.toHaveBeenCalled();
    expect(deps.createGeneration).not.toHaveBeenCalled();
  });

  it('joins a pending generation before fetching freshness or creating another generation', async () => {
    // Fails if repeated requests compete with a pending generation or trigger
    // a supplier request that the existing worker generation does not need.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(view({ run: { state: CheckRunState.PENDING } })),
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).resolves.toEqual({
      outcome: 'joined',
    });
    expect(deps.fetchSource).not.toHaveBeenCalled();
    expect(deps.createGeneration).not.toHaveBeenCalled();
  });

  it('fails with NOT_FOUND when the tenant-scoped record read misses', async () => {
    // Fails if an id from another tenant can reach generation creation.
    const deps = dependencies({ getRecord: jest.fn().mockResolvedValue(null) });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(deps.createGeneration).not.toHaveBeenCalled();
  });

  it('refuses a protected copy when no usable receiver key is held', async () => {
    // Fails if an unopened ciphertext creates a worker generation that cannot
    // make progress without a caller-supplied key.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(view({ external: { encrypted: true, decryptionKey: null } })),
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).rejects.toBeInstanceOf(
      DecryptionRequiredError,
    );
    expect(deps.createGeneration).not.toHaveBeenCalled();
  });

  it('reserves a generation, fetches, then finalises it with the prepared outcome', async () => {
    // Fails if the no-copy branch skips the reserve step, does not readdy the
    // queue between reserve and fetch, or hands finalisation anything but the
    // exact reservation it just made.
    const recoverInRequest = typedMock<
      NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
    >().mockResolvedValue({
      acquisition: { mode: 'source-failed' },
      encrypted: null,
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.FAILED,
        checks: { retrieval: CheckResult.FAIL },
        failure: {
          code: CheckRunFailureCode.RETRIEVAL_FAILED,
          message: 'source unavailable',
          retryable: true,
        },
      },
    });
    const deps = dependencies({
      getRecord: jest
        .fn()
        .mockResolvedValue(
          view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } }),
        ),
      recoverInRequest,
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).resolves.toEqual({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
    });
    expect(deps.reserveGeneration).toHaveBeenCalledWith({
      recordId: RECORD_ID,
      tenantId: TENANT_ID,
      expectedCustody: {
        storageUri: null,
        storageDigestMultibase: null,
        storageExternalId: null,
        decryptionKeyPresent: true,
        encrypted: false,
      },
      expectedGeneration: 1,
    });
    expect(recoverInRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, sourceUrl: SOURCE_URL }),
      expect.objectContaining({
        mode: 'recover',
        currentRecordId: RECORD_ID,
        holdsIdentity: false,
        acquisition: { from: 'source' },
      }),
    );
    expect(prepareEnqueue).toHaveBeenCalledTimes(1);
    expect(deps.finaliseGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: RECORD_ID,
        tenantId: TENANT_ID,
        checkRunId: 'run-2',
        generation: 2,
        enqueue,
        prepared: expect.objectContaining({ checkRun: expect.objectContaining({ state: CheckRunState.FAILED }) }),
      }),
    );
  });

  it('derives holdsIdentity from the reservation snapshot, not the entry read this function started with', async () => {
    // The entry read (`getRecord`) says this row already holds an identity;
    // the reservation's own row lock, taken afterwards, says it does not (a
    // concurrent write cleared it in between). The two reads can straddle
    // exactly this kind of change, and it is the reservation's own lock that
    // must win: recoverInRequest's `holdsIdentity` argument must come from
    // there, not from the stale entry snapshot.
    const recoverInRequest = typedMock<
      NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
    >().mockResolvedValue({
      acquisition: { mode: 'source-failed' },
      encrypted: null,
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.FAILED,
        checks: { retrieval: CheckResult.FAIL },
        failure: { code: CheckRunFailureCode.RETRIEVAL_FAILED, message: 'source unavailable', retryable: true },
      },
    });
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(
        view({
          external: {
            storageUri: null,
            storageDigestMultibase: null,
            storageExternalId: null,
            contentDigest: 'zEntryReadDigest',
          },
        }),
      ),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'reserved',
        generation: 2,
        checkRunId: 'run-2',
        identity: { contentDigest: null, duplicateOfRecordId: null },
        custody: NO_COPY_CUSTODY,
      }),
      recoverInRequest,
    });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

    expect(recoverInRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, sourceUrl: SOURCE_URL }),
      expect.objectContaining({
        mode: 'recover',
        currentRecordId: RECORD_ID,
        holdsIdentity: false,
        acquisition: { from: 'source' },
      }),
    );
  });

  it('joins without fetching or finalising when the reservation joins an existing pending run', async () => {
    // Fails if a concurrent caller's fetch runs twice for the same
    // reservation (criterion 5).
    const recoverInRequest = typedMock<NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>>();
    const deps = dependencies({
      getRecord: jest
        .fn()
        .mockResolvedValue(
          view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } }),
        ),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'joined',
      }),
      recoverInRequest,
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).resolves.toEqual({
      outcome: 'joined',
    });
    expect(prepareEnqueue).not.toHaveBeenCalled();
    expect(recoverInRequest).not.toHaveBeenCalled();
    expect(deps.fetchSource).not.toHaveBeenCalled();
    expect(deps.finaliseGeneration).not.toHaveBeenCalled();
  });

  it('reports superseded without fetching when the reservation finds the record already moved', async () => {
    const recoverInRequest = typedMock<NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>>();
    const deps = dependencies({
      getRecord: jest
        .fn()
        .mockResolvedValue(
          view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } }),
        ),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'superseded',
        generation: 3,
      }),
      recoverInRequest,
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).resolves.toEqual({
      outcome: 'superseded',
      generation: 3,
    });
    expect(recoverInRequest).not.toHaveBeenCalled();
    expect(deps.finaliseGeneration).not.toHaveBeenCalled();
  });

  it('fetches an encrypted no-copy record rather than refusing it synchronously', async () => {
    // A no-copy row is never refused before the fetch: whether the
    // fetched content ends up recovering or being refused now depends on
    // what the source actually returns, decided in finalisation, not on the
    // row's own stale `encrypted` flag before any fetch runs.
    const recoverInRequest = typedMock<
      NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
    >().mockResolvedValue({
      acquisition: { mode: 'source-failed' },
      encrypted: null,
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.FAILED,
        checks: { retrieval: CheckResult.FAIL },
        failure: { code: CheckRunFailureCode.RETRIEVAL_FAILED, message: 'unavailable', retryable: true },
      },
    });
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(
        view({
          external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null, encrypted: true },
        }),
      ),
      recoverInRequest,
    });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

    expect(deps.reserveGeneration).toHaveBeenCalled();
    expect(recoverInRequest).toHaveBeenCalled();
  });

  it('raises a shape error for a no-copy record with no source URL before touching recovery', async () => {
    // Nothing about recovery should run when there is nothing to recover
    // from.
    const recoverInRequest = typedMock<NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>>();
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(
        view({
          external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null, sourceUrl: null },
        }),
      ),
      recoverInRequest,
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).rejects.toBeInstanceOf(
      LibraryRecordShapeError,
    );
    expect(prepareEnqueue).not.toHaveBeenCalled();
    expect(recoverInRequest).not.toHaveBeenCalled();
    expect(deps.reserveGeneration).not.toHaveBeenCalled();
  });

  it('settles the reservation FAILED and answers 202 with it when the queue cannot be started after a successful reserve', async () => {
    // A queue that will not start must not leave the reservation PENDING
    // with no job for the sweep to eventually notice; it is settled
    // immediately so a later re-verify reserves a fresh generation instead.
    // Because the reservation already exists, this is answered as the
    // created (now-failed) generation rather than rethrown to a 500.
    const recoverInRequest = typedMock<NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>>();
    const failingPrepareEnqueue = jest.fn().mockRejectedValue(new Error('queue unavailable'));
    const deps = dependencies({
      getRecord: jest
        .fn()
        .mockResolvedValue(
          view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } }),
        ),
      recoverInRequest,
    });
    mockSettleCheckRunFailed.mockClear();

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, failingPrepareEnqueue, deps)).resolves.toEqual({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
    });
    expect(recoverInRequest).not.toHaveBeenCalled();
    expect(deps.finaliseGeneration).not.toHaveBeenCalled();
    expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'run-2',
        tenantId: TENANT_ID,
        failure: expect.objectContaining({ code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE, retryable: true }),
      }),
    );
  });

  it('rethrows the original queue failure, not a 202, when the settle itself cannot be confirmed', async () => {
    // Answering 202 with "the settled generation" is only truthful once the
    // settle actually committed. A transient database fault on the settle
    // write itself must not be papered over by answering 202 anyway: the run
    // is still PENDING, and the caller needs the queue's own sanitised 500,
    // not a false promise. The sweep remains the eventual backstop.
    const recoverInRequest = typedMock<NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>>();
    const queueError = new Error('queue unavailable');
    const failingPrepareEnqueue = jest.fn().mockRejectedValue(queueError);
    const deps = dependencies({
      getRecord: jest
        .fn()
        .mockResolvedValue(
          view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } }),
        ),
      recoverInRequest,
    });
    mockSettleCheckRunFailed.mockClear();
    mockSettleCheckRunFailed.mockRejectedValueOnce(new Error('settle write failed'));

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, failingPrepareEnqueue, deps)).rejects.toBe(queueError);
    expect(recoverInRequest).not.toHaveBeenCalled();
    expect(deps.finaliseGeneration).not.toHaveBeenCalled();

    mockSettleCheckRunFailed.mockResolvedValue({ outcome: 'applied' });
  });

  it('settles the reservation FAILED STORAGE_FAILED and rethrows when the fetch throws an encryption preflight failure', async () => {
    // A throw from the fetch (as opposed to the queue-start step already
    // covered above) must not leave the reservation PENDING with no job,
    // reachable only by the reconciliation sweep half an hour or more later.
    // EncryptionUnavailableError keeps its coded 500 at the route, which
    // needs this rethrow to still happen.
    const preflightError = new EncryptionUnavailableError(new Error('kms unreachable'));
    const recoverInRequest =
      typedMock<NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>>().mockRejectedValue(preflightError);
    const deps = dependencies({
      getRecord: jest
        .fn()
        .mockResolvedValue(
          view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } }),
        ),
      recoverInRequest,
    });
    mockSettleCheckRunFailed.mockClear();

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).rejects.toBe(preflightError);
    expect(deps.finaliseGeneration).not.toHaveBeenCalled();
    expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'run-2',
        tenantId: TENANT_ID,
        failure: expect.objectContaining({
          code: CheckRunFailureCode.STORAGE_FAILED,
          // The bare cause sentence was written for an immediate 500 on
          // the register path. Here it lands on a settled generation a caller
          // reads later, so it says what became of the record, who has to act
          // and what to do afterwards. Fails if the settlement goes back to
          // reporting the operator-side condition and nothing else.
          message: `${preflightError.message} ${ENCRYPTION_UNAVAILABLE_RECOVERY_DETAIL} ${RESUME_BY_REVERIFYING}`,
          retryable: true,
        }),
      }),
    );

    // The comparison above recomposes from the same constants the
    // code reads, so both sides move together and a rewritten detail
    // sentence would stay green. The literal anchors what the caller is
    // actually told, as the transient read-failure and digest-mismatch
    // tests already do for their own sentences.
    const settled = mockSettleCheckRunFailed.mock.calls.at(-1)?.[0] as { failure: { message: string } };
    expect(settled.failure.message).toContain('The credential was opened but not stored, so this record is unchanged.');
    expect(settled.failure.message).toContain('Wait for an operator to restore storage encryption.');
  });

  it.each([
    ['ServiceResolutionError', () => new ServiceResolutionError('STORAGE', 'tenant-1')],
    ['ConfigDecryptionError', () => new ConfigDecryptionError('storage-instance-1')],
    ['ConfigValidationError', () => new ConfigValidationError('storage-instance-1', 'missing baseUrl')],
  ])(
    'settles the reservation FAILED STORAGE_FAILED and rethrows when storage resolution throws %s',
    async (_label, makeError) => {
      // Storage is the only service resolution the recover path ever
      // reaches, so all three of resolveStorageService's own thrown classes
      // are attributed to storage configuration here, not left generic.
      const resolutionError = makeError();
      const recoverInRequest =
        typedMock<NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>>().mockRejectedValue(
          resolutionError,
        );
      const deps = dependencies({
        getRecord: jest
          .fn()
          .mockResolvedValue(
            view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } }),
          ),
        recoverInRequest,
      });
      mockSettleCheckRunFailed.mockClear();

      await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).rejects.toBe(resolutionError);
      expect(deps.finaliseGeneration).not.toHaveBeenCalled();
      expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'run-2',
          tenantId: TENANT_ID,
          failure: expect.objectContaining({
            code: CheckRunFailureCode.STORAGE_FAILED,
            retryable: true,
            message: expect.stringContaining(resolutionError.message),
          }),
        }),
      );
    },
  );

  it('settles the reservation FAILED and rethrows when finalisation itself throws', async () => {
    // The same gap exists on the finalisation side of the fetch.
    const recoverInRequest = typedMock<
      NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
    >().mockResolvedValue({
      acquisition: { mode: 'source', sourceDigest: 'zQmDigest' },
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zQmDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue },
    });
    const finaliseError = new Error('unexpected finalisation fault');
    const deps = dependencies({
      getRecord: jest
        .fn()
        .mockResolvedValue(
          view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } }),
        ),
      recoverInRequest,
      finaliseGeneration:
        typedMock<ReverifyLibraryRecordDependencies['finaliseGeneration']>().mockRejectedValue(finaliseError),
    });
    mockSettleCheckRunFailed.mockClear();

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).rejects.toBe(finaliseError);
    expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'run-2',
        tenantId: TENANT_ID,
        failure: expect.objectContaining({ code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE, retryable: true }),
      }),
    );
  });

  it('settles the reservation FAILED, naming a moving identity set, and answers 202 with it when lock discovery is exhausted', async () => {
    // The bounded restart budget finalisation gets is spent across a
    // pathologically moving identity set: `RecoveryLockDiscoveryExhaustedError`
    // is what check-run.repository throws in that case, and this module must
    // settle it the same way any other finalisation throw is settled, naming
    // the moving identity set rather than a generic message. Answered as
    // `202` with the settled generation once that settle write actually
    // commits, exactly like the queue-unavailable-after-reservation case,
    // because the reservation itself already exists and is already
    // finalised.
    const recoverInRequest = typedMock<
      NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
    >().mockResolvedValue({
      acquisition: { mode: 'source', sourceDigest: 'zQmDigest' },
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zQmDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue },
    });
    const exhaustedError = new RecoveryLockDiscoveryExhaustedError();
    const deps = dependencies({
      getRecord: jest
        .fn()
        .mockResolvedValue(
          view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } }),
        ),
      recoverInRequest,
      finaliseGeneration:
        typedMock<ReverifyLibraryRecordDependencies['finaliseGeneration']>().mockRejectedValue(exhaustedError),
    });
    mockSettleCheckRunFailed.mockClear();
    mockSettleCheckRunFailed.mockResolvedValue({ outcome: 'applied' });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).resolves.toEqual({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
    });
    expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'run-2',
        tenantId: TENANT_ID,
        failure: expect.objectContaining({
          code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
          message: `${exhaustedError.message} ${RESUME_BY_REVERIFYING}`,
          retryable: true,
        }),
      }),
    );
  });

  /**
   * A throw AFTER a successful acquisition still has to settle with what that
   * acquisition earned. The two throws below carry no checks of their own,
   * unlike `EncryptionUnavailableError` and `StoreAttemptFailedError`, and
   * before this the settlement wrote `noChecksRun()` over results the attempt
   * had actually proved: a run that read the copy, proved it intact and
   * opened it would publish `retrieval: not_run`, which is the opposite of
   * what happened and is what a caller decides whether to retry on.
   *
   * `checks` is asserted as a whole object rather than through a partial
   * match of it. A partial match already rejects a wrong value under a key it
   * names; what it does not reject is a result the settlement wrote that the
   * acquisition never earned. Asserting the whole object covers both.
   */
  describe.each([
    ['a lock-discovery exhaustion', () => new RecoveryLockDiscoveryExhaustedError()],
    ['a generic finalisation rejection', () => new Error('finalisation transaction rolled back')],
  ])('settling %s after a successful acquisition', (_name, makeError) => {
    it('records the checks the acquisition earned, not a run of nothing', async () => {
      const recoverInRequest = typedMock<
        NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
      >().mockResolvedValue({
        acquisition: { mode: 'source', sourceDigest: 'zQmDigest' },
        encrypted: true,
        contentKind: ExternalContentKind.CREDENTIAL,
        decryptionKeyUnused: false,
        contentDigest: 'zQmDigest',
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: {
          state: CheckRunState.PENDING,
          checks: { retrieval: CheckResult.PASS, decryption: CheckResult.PASS, digest: CheckResult.PASS },
          enqueue,
        },
      });
      const thrown = makeError();
      const deps = dependencies({
        getRecord: jest
          .fn()
          .mockResolvedValue(
            view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } }),
          ),
        recoverInRequest,
        finaliseGeneration:
          typedMock<ReverifyLibraryRecordDependencies['finaliseGeneration']>().mockRejectedValue(thrown),
      });
      mockSettleCheckRunFailed.mockClear();
      mockSettleCheckRunFailed.mockResolvedValue({ outcome: 'applied' });

      // A lock-discovery exhaustion answers 202 with the settled generation;
      // every other finalisation throw rethrows. Both settle first, which is
      // what this case is about, so the outcome is allowed to differ.
      await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps).catch(() => undefined);

      expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'run-2',
          tenantId: TENANT_ID,
          checks: {
            ...noChecksRun(),
            retrieval: CheckResult.PASS,
            decryption: CheckResult.PASS,
            digest: CheckResult.PASS,
          },
        }),
      );
    });
  });

  it('records the retrieval and digest a stored-copy read earned when finalisation then throws', async () => {
    // Mode B's first two boundaries are crossed inside this module rather
    // than inside the pipeline, so the orchestration is the only place that
    // knows they passed. Both had passed before the finalisation threw, and
    // the settled run says so.
    const recoverInRequest = typedMock<
      NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
    >().mockResolvedValue({
      acquisition: { mode: 'stored-copy' },
      encrypted: true,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zQmDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.PENDING,
        checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS, decryption: CheckResult.PASS },
        enqueue,
      },
    });
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'reserved',
        generation: 2,
        checkRunId: 'run-2',
        identity: { contentDigest: null, duplicateOfRecordId: null },
        custody: await rawCopyCustody(),
      }),
      recoverInRequest,
      finaliseGeneration: typedMock<ReverifyLibraryRecordDependencies['finaliseGeneration']>().mockRejectedValue(
        new Error('finalisation transaction rolled back'),
      ),
    });
    mockSettleCheckRunFailed.mockClear();
    mockSettleCheckRunFailed.mockResolvedValue({ outcome: 'applied' });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, 'a'.repeat(64), deps)).rejects.toThrow(
      'finalisation transaction rolled back',
    );

    expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        checks: {
          ...noChecksRun(),
          retrieval: CheckResult.PASS,
          digest: CheckResult.PASS,
          decryption: CheckResult.PASS,
        },
      }),
    );
  });

  /**
   * The duplicate lookup runs between opening the body and returning an
   * outcome, and it is the one await in that stretch whose throw carries
   * nothing. Neither `EncryptionUnavailableError` nor
   * `StoreAttemptFailedError` applies to it: both are raised further down. So
   * a lookup that rejects after a successful decrypt used to settle a
   * generation saying the credential was never decrypted, and in mode A never
   * even retrieved, which is the opposite of what happened.
   *
   * These two run the real pipeline over a real AES-256-GCM envelope, so the
   * decrypt genuinely succeeds before the lookup rejects. The seam is used to
   * supply the register dependencies rather than to replace preparation
   * itself: everything the pipeline decides here, it decides for real.
   */
  describe('settling a duplicate-lookup rejection after a successful decrypt', () => {
    const LOOKUP_FAILURE = 'the content-identity lookup lost its connection';
    const SUPPLIER_KEY = 'b'.repeat(64);

    /** A JWT whose payload decodes, which is what tells a signed credential from other JSON. */
    const CREDENTIAL_JWT = 'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.c2lnbmF0dXJl';

    /**
     * A real envelope in the shape the encryption adapter produces, built from
     * the plaintext rather than stubbed, so `readExternalArtefact` runs its
     * structure check and its actual AES-GCM decrypt over these bytes.
     */
    function encryptedEnvelope(plaintext: string, key: string): Uint8Array {
      const iv = new Uint8Array(randomBytes(12));
      const cipher = createCipheriv('aes-256-gcm', new Uint8Array(Buffer.from(key, 'hex')), iv);
      const cipherText = Buffer.concat([
        cipher.update(Buffer.from(plaintext, 'utf8')),
        cipher.final(),
      ] as unknown as Uint8Array[]);
      return new TextEncoder().encode(
        JSON.stringify({
          cipherText: cipherText.toString('base64'),
          iv: Buffer.from(iv).toString('base64'),
          tag: cipher.getAuthTag().toString('base64'),
          type: 'aes-256-gcm',
        }),
      );
    }

    const ENCRYPTED_CREDENTIAL = encryptedEnvelope(
      JSON.stringify({
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: `data:application/vc+jwt,${CREDENTIAL_JWT}`,
      }),
      SUPPLIER_KEY,
    );

    /**
     * The register dependencies this suite owns, with the duplicate lookup as
     * the failing boundary. The two dependencies that sit after the lookup
     * throw rather than pretend: if the lookup ever stopped being the first
     * thing reached, the preflight's own `EncryptionUnavailableError` carries
     * checks of its own and would settle the same values for the wrong
     * reason. `assertEncryptionReady` is returned so each case can state that
     * it was never called.
     */
    function preparationWithRejectingLookup() {
      const assertEncryptionReady = jest.fn(() => {
        throw new Error('the encryption preflight runs after the duplicate lookup and is unreachable here');
      });
      const registerDeps: RegisterExternalCredentialDependencies = {
        fetchDocument: async () => ({ bytes: ENCRYPTED_CREDENTIAL, finalUrl: SOURCE_URL }),
        resolveStorage: async () => {
          throw new Error('the store runs after the duplicate lookup and is unreachable here');
        },
        assertEncryptionReady,
        enqueueVerification: async () => undefined,
        persist: async () => {
          throw new Error('recover mode never persists through the register path');
        },
        findExistingExternal: async () => {
          throw new Error(LOOKUP_FAILURE);
        },
      };
      // The seam's parameters are the two modes' unions, and the pipeline's
      // overloads pair each input shape with its own options shape, so the
      // pair is restated per branch here.
      const recoverInRequest: NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']> = (input, options) => {
        if (options.acquisition.from === 'stored-copy') {
          return settleInRequest(
            input as AcquiredCredentialInput,
            registerDeps,
            options as RecoverFromStoredCopyOptions,
          );
        }
        return settleInRequest(
          input as RegisterExternalCredentialInput,
          registerDeps,
          options as RecoverFromSourceOptions,
        );
      };
      return { recoverInRequest, assertEncryptionReady };
    }

    beforeEach(() => {
      // This runtime maps jose to a stub whose `decodeJwt` returns undefined,
      // which would classify the opened body as plain JSON and skip the
      // duplicate lookup this case is about.
      (decodeJwt as jest.Mock).mockImplementation((jwt: string) =>
        JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()),
      );
      mockSettleCheckRunFailed.mockClear();
      mockSettleCheckRunFailed.mockResolvedValue({ outcome: 'applied' });
    });

    afterEach(() => {
      (decodeJwt as jest.Mock).mockReset();
    });

    it('records the retrieval, decryption and digest mode A earned', async () => {
      const { recoverInRequest, assertEncryptionReady } = preparationWithRejectingLookup();
      const deps = dependencies({
        getRecord: jest.fn().mockResolvedValue(
          view({
            external: {
              storageUri: null,
              storageDigestMultibase: null,
              storageExternalId: null,
              decryptionKey: null,
            },
          }),
        ),
        recoverInRequest,
      });

      await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIER_KEY, deps)).rejects.toThrow(
        LOOKUP_FAILURE,
      );

      expect(assertEncryptionReady).not.toHaveBeenCalled();
      expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          checks: {
            ...noChecksRun(),
            retrieval: CheckResult.PASS,
            decryption: CheckResult.PASS,
            digest: CheckResult.PASS,
          },
        }),
      );
    });

    it('records the decryption mode B earned beside its stored read and digest', async () => {
      const { recoverInRequest, assertEncryptionReady } = preparationWithRejectingLookup();
      const deps = dependencies({
        getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
        reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
          outcome: 'reserved',
          generation: 2,
          checkRunId: 'run-2',
          identity: { contentDigest: null, duplicateOfRecordId: null },
          custody: await rawCopyCustody({
            storageDigestMultibase: (
              await MultibaseDigest.fromData(ENCRYPTED_CREDENTIAL, { algorithm: 'sha2-256', base: 'base58btc' })
            ).toString(),
          }),
        }),
        fetchStoredCopy:
          typedMock<ReverifyLibraryRecordDependencies['fetchStoredCopy']>().mockResolvedValue(ENCRYPTED_CREDENTIAL),
        recoverInRequest,
      });

      await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIER_KEY, deps)).rejects.toThrow(
        LOOKUP_FAILURE,
      );

      expect(assertEncryptionReady).not.toHaveBeenCalled();
      expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          checks: {
            ...noChecksRun(),
            retrieval: CheckResult.PASS,
            digest: CheckResult.PASS,
            decryption: CheckResult.PASS,
          },
        }),
      );
    });
  });

  it('rethrows the lock-discovery exhaustion, not a 202, when its own settle cannot be confirmed', async () => {
    // Answering `202` with "the settled generation" is only truthful once
    // the settle write itself actually committed. A transient database
    // fault on that settle write, separate from the exhaustion that
    // triggered it, must not be papered over by answering `202` anyway: the
    // run is still `PENDING`, and the caller needs the original error
    // (mapped by the route to its own sanitised `500`) rather than a false
    // promise of a settled generation. The sweep remains the eventual
    // backstop.
    const recoverInRequest = typedMock<
      NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
    >().mockResolvedValue({
      acquisition: { mode: 'source', sourceDigest: 'zQmDigest' },
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zQmDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue },
    });
    const exhaustedError = new RecoveryLockDiscoveryExhaustedError();
    const deps = dependencies({
      getRecord: jest
        .fn()
        .mockResolvedValue(
          view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } }),
        ),
      recoverInRequest,
      finaliseGeneration:
        typedMock<ReverifyLibraryRecordDependencies['finaliseGeneration']>().mockRejectedValue(exhaustedError),
    });
    mockSettleCheckRunFailed.mockClear();
    mockSettleCheckRunFailed.mockRejectedValueOnce(new Error('settle write failed'));

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).rejects.toBe(exhaustedError);

    mockSettleCheckRunFailed.mockResolvedValue({ outcome: 'applied' });
  });

  it('records freshness and passes the observed outcome through to finalisation', async () => {
    // Fails if the old source baseline is replaced before comparison, or if
    // finalisation is not given the exact reservation this request made.
    const recoverInRequest = typedMock<
      NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
    >().mockResolvedValue({
      acquisition: { mode: 'source', sourceDigest: 'zQmNewSourceDigest' },
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zQmNewContentDigest',
      details: {
        status: CredentialDetailsStatus.EXTRACTED,
        fields: {
          name: 'Recovered credential',
          issuerName: 'Supplier Ltd',
          issuerDid: 'did:web:supplier.example',
          subjectName: 'Product',
          subjectId: 'product-1',
          validFrom: null,
          validUntil: null,
        },
        credentialType: 'DigitalProductPassport',
        coreCredentialType: CoreCredentialType.DPP,
        coreDataModelVersion: '0.6.0',
      },
      storage: {
        uri: 'https://storage.example/recovered',
        digestMultibase: 'zQmStorageDigest',
        serviceInstanceId: 'svc-1',
        externalId: 'recovered-object',
        decryptionKey: 'protected-key-envelope' as never,
      },
      checkRun: {
        state: CheckRunState.PENDING,
        checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS },
        enqueue: jest.fn(async () => undefined),
      },
    });
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(
        view({
          external: {
            storageUri: null,
            storageDigestMultibase: null,
            storageExternalId: null,
            sourceDigest: 'zQmOldSource',
          },
        }),
      ),
      recoverInRequest,
    });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

    expect(prepareEnqueue).toHaveBeenCalledTimes(1);
    expect(deps.finaliseGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        checkRunId: 'run-2',
        generation: 2,
        freshness: { sourceChanged: true, checkedAt: expect.any(Date) },
        prepared: expect.objectContaining({ acquisition: { mode: 'source', sourceDigest: 'zQmNewSourceDigest' } }),
        enqueue,
      }),
    );
  });

  it.each([
    ['a stored copy with neither a key nor a ciphertext flag', { encrypted: false, decryptionKey: null }],
    ['a key beside an unknown ciphertext flag', { encrypted: null }],
    ['no source URL to compare against', { sourceUrl: null }],
    ['no source digest to compare against', { sourceDigest: null }],
  ] as Array<[string, Partial<ExternalCredential>]>)(
    'raises a shape error for %s',
    async (_label, externalOverrides) => {
      // A committed read returning a shape the write paths never produce is a
      // data-integrity finding, not an unanticipated bug. Fails if these fall
      // back to a bare Error and are logged as an ordinary failure.
      const deps = dependencies({ getRecord: jest.fn().mockResolvedValue(view({ external: externalOverrides })) });

      await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).rejects.toBeInstanceOf(
        LibraryRecordShapeError,
      );
      expect(deps.createGeneration).not.toHaveBeenCalled();
    },
  );
});

describe('reverifyLibraryRecord on native records', () => {
  it('creates the next generation from the native custody tuple and checks no supplier source', async () => {
    // A native record has no supplier to compare against. Fails if the
    // freshness fetch runs for a record with no sourceUrl, or if the custody
    // snapshot is read off the external child that a native record lacks.
    const deps = dependencies({ getRecord: jest.fn().mockResolvedValue(nativeView()) });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

    expect(deps.fetchSource).not.toHaveBeenCalled();
    expect(deps.createGeneration).toHaveBeenCalledWith({
      recordId: RECORD_ID,
      tenantId: TENANT_ID,
      expectedOrigin: LibraryRecordOrigin.NATIVE,
      expectedGeneration: 1,
      expectedCustody: {
        storageUri: NATIVE_STORAGE_URI,
        storageDigestMultibase: 'zQmNativeStoredDigest',
        storageExternalId: null,
        decryptionKeyPresent: true,
        encrypted: null,
      },
      enqueue,
    });
  });

  it('treats generation 1 as the issuance assertion when no run is stored', async () => {
    // Fails if a native record with no stored run is given an expected
    // generation of 0, which would ask the repository for generation 1 and
    // collide with the issuance assertion the projection synthesises.
    const deps = dependencies({ getRecord: jest.fn().mockResolvedValue(nativeView({ run: null })) });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

    expect(deps.createGeneration).toHaveBeenCalledWith(expect.objectContaining({ expectedGeneration: 1 }));
  });

  it('carries no freshness on the repository input', async () => {
    // The repository input's external arm is the only one that carries a
    // supplier comparison. Fails if a native run is written with one.
    const deps = dependencies({ getRecord: jest.fn().mockResolvedValue(nativeView()) });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

    expect((deps.createGeneration as jest.Mock).mock.calls[0][0]).not.toHaveProperty('freshness');
  });
});

/**
 * The key-bearing form (#958). Every case here runs through the REAL
 * orchestration order: the record is read, the refusals are evaluated in
 * their own order, and only the reservation itself is stubbed, so a test
 * cannot pass by reaching a decision the production order would never have
 * arrived at. `reserveGeneration` is stubbed only where the reservation's own
 * decision is not what is under test.
 */
describe('reverifyLibraryRecord with a supplied decryption key', () => {
  const SUPPLIED_KEY = 'a'.repeat(64);
  /** Decrypted content, or an echo of it, which no log line may ever carry either. */
  const PLAINTEXT_SENTINEL = 'PLAINTEXT-SENTINEL-4f2a91';

  it('refuses a native record before the pending join, whatever its state', async () => {
    // Rules 3 and 21 together: the refusal has to come before the join, or a
    // native record with a pending generation would answer 202 joined and
    // silently drop the key. Fails if the refusal moves after the join.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(nativeView({ run: { state: CheckRunState.PENDING } })),
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).rejects.toMatchObject(
      { code: 'SOURCE_ENCRYPTION_NOT_ALLOWED' },
    );
    expect(deps.createGeneration).not.toHaveBeenCalled();
    expect(deps.reserveGeneration).not.toHaveBeenCalled();
  });

  it('refuses an external record this service already holds a key for, before the pending join', async () => {
    // Rule 4, judged on the held key rather than the `encrypted` flag. The
    // default fixture holds a protected key envelope.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(view({ run: { state: CheckRunState.PENDING } })),
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).rejects.toMatchObject(
      { code: 'SOURCE_ENCRYPTION_NOT_ALLOWED' },
    );
    expect(deps.createGeneration).not.toHaveBeenCalled();
    expect(deps.reserveGeneration).not.toHaveBeenCalled();
  });

  it('skips the early pending join and reaches the reservation, which answers the conflict', async () => {
    // A bodyless request in this state joins; a key-bearing one must
    // not, because a pending generation cannot consume its key. Fails if the
    // `!keyBearing` guard on the join is removed, which would return
    // `{ outcome: 'joined' }` here and never reach `reserveGeneration`.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'conflict',
        reason: 'pending',
        generation: 2,
      }),
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).rejects.toMatchObject(
      {
        code: 'VERIFICATION_IN_PROGRESS',
        reason: 'pending',
        generation: 2,
        message: VERIFICATION_IN_PROGRESS_MESSAGE,
      },
    );
    expect(deps.reserveGeneration).toHaveBeenCalledWith(expect.objectContaining({ keyBearing: true }));
  });

  it('tells a doubly-lost race that its key was not used, rather than to wait for a settlement', async () => {
    // The same 409, a different next step. The winner has already
    // settled and the record is still eligible, so nothing is in progress and
    // the key was never consumed. Fails if the reservation's `race-lost`
    // reason stops reaching the message, which would send the caller to poll
    // for a settlement that already happened.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'conflict',
        reason: 'race-lost',
        generation: 3,
      }),
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).rejects.toMatchObject(
      {
        code: 'VERIFICATION_IN_PROGRESS',
        reason: 'race-lost',
        generation: 3,
        message: VERIFICATION_RACE_LOST_MESSAGE,
      },
    );
    expect(VERIFICATION_RACE_LOST_MESSAGE).not.toEqual(VERIFICATION_IN_PROGRESS_MESSAGE);
  });

  it('still joins a pending generation for a bodyless request on the same record', async () => {
    // The control for the case above: the join itself is unchanged.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView({ decryptionKey: 'protected-key-envelope' })),
    });
    (deps.getRecord as jest.Mock).mockResolvedValue(
      view({ external: { decryptionKey: null, encrypted: true }, run: { state: CheckRunState.PENDING } }),
    );

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).resolves.toEqual({
      outcome: 'joined',
    });
    expect(deps.reserveGeneration).not.toHaveBeenCalled();
  });

  it('maps a not-applicable reservation to the same refusal the pre-lock checks raise', async () => {
    // Rule 4 re-checked under the lock: the copy became receiver-protected
    // between the entry read and the reservation.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'not-applicable',
      }),
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).rejects.toMatchObject(
      { code: 'SOURCE_ENCRYPTION_NOT_ALLOWED' },
    );
  });

  it('takes mode B against the reserved copy, reading no source and using no guarded fetch', async () => {
    // Fails if the mode is chosen from the entry read, if the
    // supplier is fetched, or if the stored copy is pulled through the
    // guarded document fetcher instead of the storage transport.
    const custody = await rawCopyCustody();
    const fetchStoredCopy =
      typedMock<ReverifyLibraryRecordDependencies['fetchStoredCopy']>().mockResolvedValue(STORED_CIPHERTEXT);
    const recoverInRequest = typedMock<
      NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
    >().mockResolvedValue({
      acquisition: { mode: 'stored-copy' },
      encrypted: true,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zOpenedDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue },
    });
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'reserved',
        generation: 2,
        checkRunId: 'run-2',
        identity: { contentDigest: null, duplicateOfRecordId: null },
        custody,
      }),
      fetchStoredCopy,
      recoverInRequest,
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).resolves.toEqual({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
    });

    expect(fetchStoredCopy).toHaveBeenCalledWith(STORAGE_URI);
    expect(deps.fetchSource).not.toHaveBeenCalled();
    const [input, options] = recoverInRequest.mock.calls[0];
    expect(input).not.toHaveProperty('sourceUrl');
    expect(input).toMatchObject({ tenantId: TENANT_ID, decryptionKey: SUPPLIED_KEY });
    expect(options).toMatchObject({
      mode: 'recover',
      currentRecordId: RECORD_ID,
      acquisition: {
        from: 'stored-copy',
        storageUri: STORAGE_URI,
        checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS },
      },
    });
    // The fence and the freshness rule: the reserved tuple, and no source
    // observation at all.
    expect(deps.finaliseGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ expectedCustody: custody, generation: 2, checkRunId: 'run-2' }),
    );
    expect((deps.finaliseGeneration as jest.Mock).mock.calls[0][0]).not.toHaveProperty('freshness');
  });

  it('takes mode B when the record acquired a copy between the entry read and the lock', async () => {
    // The entry read saw no copy, so
    // the pre-lock state says mode A. Fails if the mode still comes from that
    // read, which would fetch the supplier and spend the key on it while the
    // fence then rejected the result.
    const custody = await rawCopyCustody();
    const fetchStoredCopy =
      typedMock<ReverifyLibraryRecordDependencies['fetchStoredCopy']>().mockResolvedValue(STORED_CIPHERTEXT);
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(
        view({
          external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null, decryptionKey: null },
        }),
      ),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'reserved',
        generation: 2,
        checkRunId: 'run-2',
        identity: { contentDigest: null, duplicateOfRecordId: null },
        custody,
      }),
      fetchStoredCopy,
      recoverInRequest: typedMock<
        NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
      >().mockResolvedValue({
        acquisition: { mode: 'stored-copy' },
        encrypted: true,
        contentKind: ExternalContentKind.CREDENTIAL,
        decryptionKeyUnused: false,
        contentDigest: 'zOpenedDigest',
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue },
      }),
    });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps);

    expect(fetchStoredCopy).toHaveBeenCalledWith(STORAGE_URI);
    expect(deps.fetchSource).not.toHaveBeenCalled();
  });

  it('takes mode A when the record lost its copy between the entry read and the lock', async () => {
    // The reverse switch. The entry read saw an unopened copy; the lock sees
    // none, so the supplier is fetched with the key instead.
    const fetchStoredCopy = typedMock<ReverifyLibraryRecordDependencies['fetchStoredCopy']>();
    const recoverInRequest = typedMock<
      NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
    >().mockResolvedValue({
      acquisition: { mode: 'source', sourceDigest: 'zFetchedDigest' },
      encrypted: true,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zOpenedDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue },
    });
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'reserved',
        generation: 2,
        checkRunId: 'run-2',
        identity: { contentDigest: null, duplicateOfRecordId: null },
        custody: NO_COPY_CUSTODY,
      }),
      fetchStoredCopy,
      recoverInRequest,
    });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps);

    expect(fetchStoredCopy).not.toHaveBeenCalled();
    const [input, options] = recoverInRequest.mock.calls[0];
    expect(input).toMatchObject({ sourceUrl: SOURCE_URL, decryptionKey: SUPPLIED_KEY });
    expect(options).toMatchObject({ acquisition: { from: 'source' } });
  });

  it('threads the key down mode A for a record whose copy was never written', async () => {
    // Acceptance criterion 7: a storage-failed encrypted source has no copy
    // to open, so the key is applied to a fresh fetch of the supplier. Fails
    // if the key stops reaching the pipeline on this branch.
    const recoverInRequest = typedMock<
      NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
    >().mockResolvedValue({
      acquisition: { mode: 'source', sourceDigest: 'zFetchedDigest' },
      encrypted: true,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zOpenedDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue },
    });
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(
        view({
          external: {
            storageUri: null,
            storageDigestMultibase: null,
            storageExternalId: null,
            decryptionKey: null,
            encrypted: true,
          },
        }),
      ),
      recoverInRequest,
    });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps);

    expect(recoverInRequest.mock.calls[0][0]).toMatchObject({
      sourceUrl: SOURCE_URL,
      decryptionKey: SUPPLIED_KEY,
    });
  });

  describe('mode B acquisition failures', () => {
    async function runModeB(
      overrides: {
        custody?: Record<string, unknown>;
        fetchStoredCopy?: ReverifyLibraryRecordDependencies['fetchStoredCopy'];
      } = {},
    ) {
      const custody = { ...(await rawCopyCustody()), ...(overrides.custody ?? {}) };
      // Resolved, not a bare mock: most cases here never reach the pipeline,
      // but the orchestration reads the outcome it returns (to pick up the
      // decryption result the acquisition could not know), so a double that
      // resolves `undefined` would test against a state production cannot
      // produce.
      const recoverInRequest = typedMock<
        NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
      >().mockResolvedValue({
        acquisition: { mode: 'stored-copy' },
        encrypted: true,
        contentKind: ExternalContentKind.CREDENTIAL,
        decryptionKeyUnused: false,
        contentDigest: 'zQmOpenedDigest',
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: {
          state: CheckRunState.PENDING,
          checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS, decryption: CheckResult.PASS },
          enqueue,
        },
      });
      const deps = dependencies({
        getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
        reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
          outcome: 'reserved',
          generation: 2,
          checkRunId: 'run-2',
          identity: { contentDigest: null, duplicateOfRecordId: null },
          custody,
        }),
        ...(overrides.fetchStoredCopy === undefined ? {} : { fetchStoredCopy: overrides.fetchStoredCopy }),
        recoverInRequest,
      });

      await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps);

      return {
        recoverInRequest,
        prepared: (deps.finaliseGeneration as jest.Mock).mock.calls[0][0].prepared,
      };
    }

    it('settles STORED_COPY_UNAVAILABLE with every check not run when the copy cannot be read back', async () => {
      // Fails if a failed read is reported as `retrieval: fail`, which
      // the published contract says it is not, or if the reader is called
      // anyway with bytes it never received.
      const { recoverInRequest, prepared } = await runModeB({
        fetchStoredCopy: jest.fn().mockRejectedValue(new Error('connection reset')),
      });

      expect(recoverInRequest).not.toHaveBeenCalled();
      expect(prepared).toMatchObject({
        acquisition: { mode: 'stored-copy' },
        encrypted: null,
        checkRun: {
          state: CheckRunState.FAILED,
          checks: {},
          failure: { code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE },
        },
      });
      expect(prepared.checkRun.checks).toEqual({});
    });

    it('treats an unclassified read failure as transient, matching the worker default', async () => {
      // S-1: a post-headers abort or a mid-body close arrives unwrapped, and
      // settling it non-retryable tells a caller a transient outage is
      // permanent after their key has already been spent.
      const { prepared } = await runModeB({
        fetchStoredCopy: jest.fn().mockRejectedValue(new TypeError('terminated')),
      });

      expect(prepared.checkRun.failure).toMatchObject({
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        retryable: true,
      });
    });

    it('carries the read failure reason into the caller-facing message', async () => {
      // S-2: one fixed sentence for every cause leaves an operator unable to
      // tell a 404 from a timeout from the read cap.
      const { prepared } = await runModeB({
        fetchStoredCopy: jest.fn().mockRejectedValue(new StoredCopyReadError('terminal', 'storage returned HTTP 404')),
      });

      expect(prepared.checkRun.failure.message).toContain('storage returned HTTP 404');
      expect(prepared.checkRun.failure.retryable).toBe(false);
    });

    it('sends a transient read failure on an unopened copy back to resending the key, and a terminal one to an operator', async () => {
      // One sentence for both retryability classes gets both wrong: a
      // caller whose storage was briefly unreachable is told to inspect an
      // object they cannot reach, and one whose object is gone for good is
      // told to keep retrying. The worker already splits these two the same
      // way; a single code with two contradictory instructions for the same
      // record is the divergence this closes.
      //
      // The retryable half's move is chosen from the same custody the
      // rest of the recovery failures choose theirs from. This record holds
      // an unopened encrypted copy, so a plain re-verify of it is refused
      // `400 DECRYPTION_REQUIRED` before any fetch: a message telling this
      // caller to re-verify once storage is reachable names an action the
      // route will not carry out, which is what the live exercise saw.
      const custody = await rawCopyCustody();
      const transient = await runModeB({
        fetchStoredCopy: jest.fn().mockRejectedValue(new StoredCopyReadError('transient', 'storage returned HTTP 503')),
      });
      expect(transient.prepared.checkRun.failure.retryable).toBe(true);
      expect(transient.prepared.checkRun.failure.message).toBe(
        storedCopyReadFailedMessage('storage returned HTTP 503', 'transient', custody),
      );
      expect(transient.prepared.checkRun.failure.message).toContain(
        'resend the key as sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify',
      );
      expect(transient.prepared.checkRun.failure.message).not.toContain('re-verify once storage is reachable');
      expect(transient.prepared.checkRun.failure.message).not.toContain('operator');

      const terminal = await runModeB({
        fetchStoredCopy: jest.fn().mockRejectedValue(new StoredCopyReadError('terminal', 'storage returned HTTP 404')),
      });
      expect(terminal.prepared.checkRun.failure.retryable).toBe(false);
      expect(terminal.prepared.checkRun.failure.message).toBe(
        storedCopyReadFailedMessage('storage returned HTTP 404', 'terminal', custody),
      );
      expect(terminal.prepared.checkRun.failure.message).toContain('needs an operator to inspect the stored object');
      expect(terminal.prepared.checkRun.failure.message).not.toContain('resend the key');
    });

    it('sends a transient read failure on a copy this service can open back to a plain re-verify', async () => {
      // The second custody shape. Mode B also runs against a copy whose
      // receiver key this service already holds: a bodyless request that
      // entered on a no-copy record and found, under the reservation's lock,
      // that a protected copy had arrived. Nothing refuses a re-verify of
      // that record, so telling its caller to resend a key would name a
      // field the route answers `400 SOURCE_ENCRYPTION_NOT_ALLOWED` for.
      const protectedCustody = await rawCopyCustody({ decryptionKeyPresent: true });
      const deps = dependencies({
        getRecord: jest.fn().mockResolvedValue(
          view({
            external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null, decryptionKey: null },
          }),
        ),
        reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
          outcome: 'reserved',
          generation: 2,
          checkRunId: 'run-2',
          identity: { contentDigest: null, duplicateOfRecordId: null },
          custody: protectedCustody,
        }),
        fetchStoredCopy: jest.fn().mockRejectedValue(new StoredCopyReadError('transient', 'storage returned HTTP 503')),
        recoverInRequest: typedMock<NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>>(),
      });

      await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

      const { prepared } = (deps.finaliseGeneration as jest.Mock).mock.calls[0][0];
      expect(prepared.checkRun.failure.retryable).toBe(true);
      expect(prepared.checkRun.failure.message).toBe(
        storedCopyReadFailedMessage('storage returned HTTP 503', 'transient', protectedCustody),
      );
      expect(prepared.checkRun.failure.message).toContain('Re-verify to try again.');
      expect(prepared.checkRun.failure.message).not.toContain('resend the key');
    });

    it('names the operator on a digest mismatch, as its two siblings do', async () => {
      // The outcome is not retryable, so the caller has no move of their
      // own through the API at all. Its two siblings, the missing and the
      // unreadable recorded digest, both end by naming the operator; this one
      // handed the caller an operator's job without saying so.
      const digest = (
        await MultibaseDigest.fromData(new TextEncoder().encode('different bytes'), {
          algorithm: 'sha2-256',
          base: 'base58btc',
        })
      ).toString();
      const { prepared } = await runModeB({ custody: { storageDigestMultibase: digest } });

      expect(prepared.checkRun.failure).toMatchObject({
        code: CheckRunFailureCode.STORED_COPY_CORRUPT,
        retryable: false,
      });
      expect(prepared.checkRun.failure.message).toBe(STORED_COPY_DIGEST_MISMATCH_MESSAGE);
      expect(prepared.checkRun.failure.message).toContain('needs an operator to inspect the stored object');
    });

    it('says the copy cannot be proven intact, not that it could not be read, when no digest is recorded', async () => {
      // This generation carries `retrieval: pass`, so a message saying
      // the copy could not be read back contradicts the checks beside it.
      const { prepared, recoverInRequest } = await runModeB({ custody: { storageDigestMultibase: null } });

      expect(prepared.checkRun.checks).toEqual({ retrieval: CheckResult.PASS });
      expect(prepared.checkRun.failure).toMatchObject({
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        retryable: false,
      });
      expect(prepared.checkRun.failure.message).toContain('read back');
      expect(prepared.checkRun.failure.message).toContain('no integrity digest');
      expect(recoverInRequest).not.toHaveBeenCalled();
    });

    it('says the same for a recorded digest that cannot be read', async () => {
      const { prepared } = await runModeB({ custody: { storageDigestMultibase: 'not-a-multibase-digest' } });

      expect(prepared.checkRun.checks).toEqual({ retrieval: CheckResult.PASS });
      expect(prepared.checkRun.failure).toMatchObject({
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        retryable: false,
      });
      expect(prepared.checkRun.failure.message).toContain('could not be read');
    });

    it('settles STORED_COPY_CORRUPT with digest fail and decryption not run on a mismatch', async () => {
      // The copy is proven changed before anything tries to open it, so
      // a corrupt object is never reported as a wrong key.
      const otherDigest = (
        await MultibaseDigest.fromData(new TextEncoder().encode('different bytes'), {
          algorithm: 'sha2-256',
          base: 'base58btc',
        })
      ).toString();
      const { prepared, recoverInRequest } = await runModeB({ custody: { storageDigestMultibase: otherDigest } });

      expect(prepared).toMatchObject({
        acquisition: { mode: 'stored-copy' },
        checkRun: {
          state: CheckRunState.FAILED,
          checks: { retrieval: CheckResult.PASS, digest: CheckResult.FAIL },
          failure: { code: CheckRunFailureCode.STORED_COPY_CORRUPT, retryable: false },
        },
      });
      expect(prepared.checkRun.checks).not.toHaveProperty('decryption');
      expect(recoverInRequest).not.toHaveBeenCalled();
    });

    it('hands the pipeline retrieval and digest passes once the copy is proven intact', async () => {
      // The checks the acquisition earned have to survive into whatever the
      // pipeline settles, or a wrong-key generation publishes them as not
      // run.
      const { recoverInRequest } = await runModeB();

      expect(recoverInRequest.mock.calls[0][1]).toMatchObject({
        acquisition: { checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS } },
      });
    });
  });

  it('carries the checks a thrown store failure had already earned into the settlement', async () => {
    // The throw path. Fails if `settleReservationOnThrow` stops
    // being given the checks, or if the carrier stops being read: the
    // generation would then publish `retrieval: not_run` for a read that
    // demonstrably happened.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'reserved',
        generation: 2,
        checkRunId: 'run-2',
        identity: { contentDigest: null, duplicateOfRecordId: null },
        custody: await rawCopyCustody(),
      }),
      recoverInRequest: jest.fn().mockRejectedValue(
        new StoreAttemptFailedError(new Error('storage down'), {
          retrieval: CheckResult.PASS,
          digest: CheckResult.PASS,
          decryption: CheckResult.PASS,
        }),
      ),
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).rejects.toThrow();

    expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'run-2',
        checks: expect.objectContaining({
          retrieval: CheckResult.PASS,
          digest: CheckResult.PASS,
          decryption: CheckResult.PASS,
        }),
      }),
    );
  });

  it('carries the D10 preflight checks into the settlement too', async () => {
    // The same rule applies on the other carrier.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'reserved',
        generation: 2,
        checkRunId: 'run-2',
        identity: { contentDigest: null, duplicateOfRecordId: null },
        custody: await rawCopyCustody(),
      }),
      recoverInRequest: jest.fn().mockRejectedValue(
        new EncryptionUnavailableError(new Error('kms unreachable'), {
          retrieval: CheckResult.PASS,
          digest: CheckResult.PASS,
          decryption: CheckResult.PASS,
        }),
      ),
    });

    await expect(
      reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps),
    ).rejects.toBeInstanceOf(EncryptionUnavailableError);

    expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        checks: expect.objectContaining({ retrieval: CheckResult.PASS, digest: CheckResult.PASS }),
        failure: expect.objectContaining({ code: CheckRunFailureCode.STORAGE_FAILED }),
      }),
    );
  });

  it('ignores a checks property on an unrelated error rather than spreading it into the settlement', async () => {
    // Y-F6. Narrowing on a property name accepts any dependency's error that
    // happens to carry one, and spreads unvalidated values straight into a
    // check-run update.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'reserved',
        generation: 2,
        checkRunId: 'run-2',
        identity: { contentDigest: null, duplicateOfRecordId: null },
        custody: await rawCopyCustody(),
      }),
      recoverInRequest: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('unrelated'), { checks: { digest: 'not-a-check-result' } })),
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).rejects.toThrow(
      'unrelated',
    );

    // The settlement carries the digest THIS attempt earned against the
    // stored copy, not the string the unrelated error offered. Asserted as
    // the earned value rather than as `not_run`: mode B genuinely proved the
    // copy intact before the pipeline threw, so `not_run` would now be the
    // wrong answer for a different reason and would stop testing refusal.
    expect(mockSettleCheckRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({ checks: expect.objectContaining({ digest: CheckResult.PASS }) }),
    );
  });

  describe('settled recovery failures choose their next step from the reserved custody', () => {
    // All four of these sentences were written for #957, where the only
    // recoverable record had no durable copy and "re-verify" genuinely was
    // the next step. Every one of them is now reachable from a record still
    // holding an unopened encrypted copy, whose bodyless re-verify this same
    // module refuses `400 DECRYPTION_REQUIRED` before any fetch. Each site is
    // driven twice, once per custody shape, so a site that stops consulting
    // custody fails on the unopened half and a site that always resends fails
    // on the no-copy half.
    const collision = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
      meta: { target: ['tenantId', 'contentDigest'] },
    });

    /**
     * Drives one settled-failure site against one custody shape and returns
     * the message the settlement recorded. `mode` selects the record and the
     * custody the reservation reports, which is the only input the guidance
     * is allowed to depend on.
     */
    async function settledMessage(
      mode: 'no-copy' | 'unopened-copy',
      site: 'queue' | 'collision' | 'unexpected' | 'lock-discovery',
    ): Promise<string> {
      const custody = mode === 'no-copy' ? NO_COPY_CUSTODY : await rawCopyCustody();
      const record =
        mode === 'no-copy'
          ? view({ external: { storageUri: null, storageDigestMultibase: null, storageExternalId: null } })
          : unopenedCopyView();
      const thrown =
        site === 'collision'
          ? collision
          : site === 'lock-discovery'
            ? new RecoveryLockDiscoveryExhaustedError()
            : new Error('something unexpected');
      const deps = dependencies({
        getRecord: jest.fn().mockResolvedValue(record),
        reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
          outcome: 'reserved',
          generation: 2,
          checkRunId: 'run-2',
          identity: { contentDigest: null, duplicateOfRecordId: null },
          custody,
        }),
        recoverInRequest: typedMock<
          NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
        >().mockResolvedValue({
          acquisition: mode === 'no-copy' ? { mode: 'source', sourceDigest: 'zQmDigest' } : { mode: 'stored-copy' },
          encrypted: false,
          contentKind: ExternalContentKind.CREDENTIAL,
          decryptionKeyUnused: false,
          contentDigest: 'zQmDigest',
          details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
          checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue },
        }),
        finaliseGeneration:
          site === 'queue'
            ? typedMock<ReverifyLibraryRecordDependencies['finaliseGeneration']>().mockResolvedValue({
                outcome: 'created',
                generation: 2,
                checkRunId: 'run-2',
              })
            : typedMock<ReverifyLibraryRecordDependencies['finaliseGeneration']>().mockRejectedValue(thrown),
      });
      if (site === 'queue') {
        prepareEnqueue.mockImplementationOnce(async () => {
          throw new Error('queue unavailable');
        });
      }
      mockSettleCheckRunFailed.mockResolvedValue({ outcome: 'applied' });

      const call =
        mode === 'no-copy'
          ? reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)
          : reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps);
      await call.catch(() => undefined);

      const settled = mockSettleCheckRunFailed.mock.calls.at(-1)?.[0] as { failure: { message: string } };
      return settled.failure.message;
    }

    it.each(['queue', 'collision', 'unexpected', 'lock-discovery'] as const)(
      'tells a no-copy caller to re-verify after a %s failure',
      async (site) => {
        const message = await settledMessage('no-copy', site);

        expect(message.endsWith(RESUME_BY_REVERIFYING)).toBe(true);
        expect(message).not.toContain(RESUME_BY_RESENDING_KEY);
      },
    );

    it.each(['queue', 'collision', 'unexpected', 'lock-discovery'] as const)(
      'tells an unopened-copy caller to resend the key after a %s failure',
      async (site) => {
        const message = await settledMessage('unopened-copy', site);

        expect(message.endsWith(RESUME_BY_RESENDING_KEY)).toBe(true);
        expect(message).not.toContain(RESUME_BY_REVERIFYING);
      },
    );

    it('picks the same sentence the sweep picks for the same custody', () => {
      // The two paths must never disagree about which records have to resend
      // a key, so they share one predicate and one pair of sentences.
      expect(ABANDONED_UNOPENED_COPY_MESSAGE.endsWith(RESUME_BY_RESENDING_KEY)).toBe(true);
    });
  });

  it('stamps lastSourceCheckAt before the source fetch, not after the whole pipeline', async () => {
    // `library.md` promises an integrator that `lastSourceCheckAt`
    // follows `requestedAt` only by the reservation-and-queue interval,
    // "never by the fetch's own duration". A stamp taken after
    // `recoverInRequest` returns folds the fetch, the decrypt, the duplicate
    // lookup, the encryption preflight and the store into a value read as
    // supplier freshness. The clock is advanced by an hour inside the
    // pipeline, so a stamp taken afterwards is an hour late and fails here.
    const START = new Date('2026-09-09T09:00:00.000Z').getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(START);
    try {
      const recoverInRequest = typedMock<
        NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
      >().mockImplementation(async () => {
        nowSpy.mockReturnValue(START + 3_600_000);
        return {
          acquisition: { mode: 'source', sourceDigest: 'zQmNewSourceDigest' },
          encrypted: false,
          contentKind: ExternalContentKind.CREDENTIAL,
          decryptionKeyUnused: false,
          contentDigest: 'zQmDigest',
          details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
          checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue },
        };
      });
      const deps = dependencies({
        getRecord: jest.fn().mockResolvedValue(
          view({
            external: {
              storageUri: null,
              storageDigestMultibase: null,
              storageExternalId: null,
              sourceDigest: 'zQmOldSourceDigest',
            },
          }),
        ),
        recoverInRequest,
      });

      await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

      expect(deps.finaliseGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ freshness: { sourceChanged: true, checkedAt: new Date(START) } }),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('logs neither the supplied key nor the settle cause raw when settlement itself fails', async () => {
    // The settled secrecy decision. A cause chain from this path has run with
    // the supplier key in scope, and pino renders an unreduced chain in full.
    //
    // Asserted against the RENDERED line, not against `{ level, message }`:
    // the reduced capture discards the bindings, so it cannot tell
    // `{ err: settleError, cause }` from `{ error: safeError(settleError),
    // cause: safeError(cause) }`. Both the settle failure and the original
    // cause carry a sentinel, so restoring either half of the pre-fix binding
    // fails this test.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'reserved',
        generation: 2,
        checkRunId: 'run-2',
        identity: { contentDigest: null, duplicateOfRecordId: null },
        custody: await rawCopyCustody(),
      }),
      recoverInRequest: jest.fn().mockRejectedValue(
        // The sentinels sit one level down the chain, which is where a real
        // one would be: `safeError` keeps the top error's own name and
        // message and drops everything below it, and pino expands the whole
        // chain when it is handed a raw `err`.
        new Error('the recovery pipeline failed', {
          cause: new Error(`it held ${SUPPLIED_KEY} and ${PLAINTEXT_SENTINEL}`),
        }),
      ),
    });
    mockSettleCheckRunFailed.mockRejectedValueOnce(
      new Error('settle write failed', {
        cause: new Error(`settling a run opened with ${SUPPLIED_KEY} holding ${PLAINTEXT_SENTINEL}`),
      }),
    );

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).rejects.toThrow();

    const rendered = renderedLogLines.join('');
    expect(rendered).toContain('Reserved recovery generation could not be settled after it could not be finalised');
    expect(rendered).not.toContain(SUPPLIED_KEY);
    expect(rendered).not.toContain(PLAINTEXT_SENTINEL);
  });

  it('proves the rendered capture would show a sentinel if a line carried one', () => {
    // Without this, the assertions above would also pass against a capture
    // that rendered nothing at all.
    const { createLogger } = jest.requireActual('@uncefact/untp-ri-services/logging') as {
      createLogger: (config: Record<string, unknown>) => { warn: (...a: unknown[]) => void };
    };
    createLogger({
      level: 'debug',
      destination: { write: (line: string) => renderedLogLines.push(line) },
    }).warn({ leakCheck: SUPPLIED_KEY, plaintext: PLAINTEXT_SENTINEL }, 'deliberate sentinel write');

    const rendered = renderedLogLines.join('');
    expect(rendered).toContain(SUPPLIED_KEY);
    expect(rendered).toContain(PLAINTEXT_SENTINEL);
  });
});

/**
 * A key-bearing recovery that opens the record's ciphertext stores a
 * receiver-protected replacement and repoints the row at it. The supplier's
 * original object is then named by nothing, survives the record's own
 * deletion and is reachable by no sweep, so it is removed at the moment it is
 * retired. The removal is best effort: it runs after the finalisation has
 * committed, and a storage failure leaves an object for an operator rather
 * than changing anything the caller was told.
 */
describe('a successful key-bearing recovery removes the copy it retired', () => {
  const SUPPLIED_KEY = 'a'.repeat(64);
  /** Content a storage failure could echo back, which must not reach a line. */
  const PLAINTEXT_SENTINEL = 'PLAINTEXT-SENTINEL-4f2a91';
  const RETIRED = {
    storageUri: STORAGE_URI,
    storageServiceInstanceId: 'storage-instance-1',
    storageExternalId: 'obj-1',
    storageBucket: 'private-data',
  };

  /** A mode B recovery whose finalisation reports the copy it displaced. */
  async function recoveryReplacingCustody(
    finalised: Awaited<ReturnType<ReverifyLibraryRecordDependencies['finaliseGeneration']>>,
  ) {
    const custody = await rawCopyCustody();
    return dependencies({
      getRecord: jest.fn().mockResolvedValue(unopenedCopyView()),
      reserveGeneration: typedMock<ReverifyLibraryRecordDependencies['reserveGeneration']>().mockResolvedValue({
        outcome: 'reserved',
        generation: 2,
        checkRunId: 'run-2',
        identity: { contentDigest: null, duplicateOfRecordId: null },
        custody,
      }),
      recoverInRequest: typedMock<
        NonNullable<ReverifyLibraryRecordDependencies['recoverInRequest']>
      >().mockResolvedValue({
        acquisition: { mode: 'stored-copy' },
        encrypted: true,
        contentKind: ExternalContentKind.CREDENTIAL,
        decryptionKeyUnused: false,
        contentDigest: 'zOpenedDigest',
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue },
      }),
      finaliseGeneration:
        typedMock<ReverifyLibraryRecordDependencies['finaliseGeneration']>().mockResolvedValue(finalised),
    });
  }

  it('removes the retired object once, from the instance and bucket the retired tuple names', async () => {
    // Fails if the removal is skipped, repeated, aimed at the tenant's
    // current primary instance instead of the one the retired row named, or
    // run against the replacement's coordinates.
    const deps = await recoveryReplacingCustody({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
      retiredStorage: RETIRED,
    });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).resolves.toEqual({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
    });

    expect(mockResolveStorageService).toHaveBeenCalledTimes(1);
    expect(mockResolveStorageService).toHaveBeenCalledWith(TENANT_ID, RETIRED.storageServiceInstanceId);
    expect(mockStorageDelete).toHaveBeenCalledTimes(1);
    expect(mockStorageDelete).toHaveBeenCalledWith(RETIRED.storageExternalId, RETIRED.storageBucket);
    expect(logLines).toContainEqual({ level: 'info', message: 'Retired recovery copy removed' });
  });

  it('runs the removal only after the finalisation has returned', async () => {
    // The whole point of doing this outside the transaction: an object
    // deleted before the write that displaced it commits is deleted while the
    // row still points at it. Fails if the removal moves ahead of the
    // finalisation.
    const order: string[] = [];
    const deps = await recoveryReplacingCustody({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
      retiredStorage: RETIRED,
    });
    (deps.finaliseGeneration as jest.Mock).mockImplementation(async () => {
      order.push('finalise');
      return { outcome: 'created', generation: 2, checkRunId: 'run-2', retiredStorage: RETIRED };
    });
    mockStorageDelete.mockImplementation(async () => {
      order.push('remove');
    });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps);

    expect(order).toEqual(['finalise', 'remove']);
  });

  it('leaves the settled generation and response unchanged when the removal call throws unexpectedly', async () => {
    // A storage failure here is an operator's problem, not the caller's: the
    // replacement is already this record's copy. Fails if the failure
    // propagates, changes the answer, or is swallowed without a line naming
    // the object.
    const deps = await recoveryReplacingCustody({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
      retiredStorage: RETIRED,
    });
    mockRemoveStoredObject.mockRejectedValue(
      Object.assign(new Error(`storage refused while holding ${PLAINTEXT_SENTINEL}`), { name: 'StorageDeleteError' }),
    );

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).resolves.toEqual({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
    });

    expect(logLines).toContainEqual({
      level: 'warn',
      message: 'Retired recovery copy remains for operator-managed cleanup',
    });
    const rendered = renderedLogLines.join('');
    // The backstop has to be actionable: the location and the object id, the
    // reason the removal did not happen, and the error's class.
    expect(rendered).toContain(`"storageUri":"${RETIRED.storageUri}"`);
    expect(rendered).toContain(`"storageExternalId":"${RETIRED.storageExternalId}"`);
    expect(rendered).toContain(`"storageBucket":"${RETIRED.storageBucket}"`);
    expect(rendered).toContain('"removal":"storage_delete_failed"');
    expect(rendered).toContain('"errorName":"StorageDeleteError"');
    // Never the provider's own message (ADR-055 amendment A1).
    expect(rendered).not.toContain(PLAINTEXT_SENTINEL);
    expect(rendered).not.toContain(SUPPLIED_KEY);
  });

  it('removes nothing when the recovery replaced no copy', async () => {
    // Mode A against a record with no durable copy retires nothing, and a
    // finalisation that refused to attach what this request stored retires
    // nothing either. Both reach here with no retired tuple. Fails if the
    // removal is driven by the outcome rather than by that tuple.
    const deps = await recoveryReplacingCustody({ outcome: 'created', generation: 2, checkRunId: 'run-2' });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, SUPPLIED_KEY, deps)).resolves.toEqual({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
    });

    expect(mockResolveStorageService).not.toHaveBeenCalled();
    expect(mockStorageDelete).not.toHaveBeenCalled();
    expect(logLines.map((line) => line.message)).not.toContain('Retired recovery copy removed');
  });
});
