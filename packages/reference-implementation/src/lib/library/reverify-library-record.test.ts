const logLines: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = [];

jest.mock('@/lib/api/logger', () => {
  const record =
    (level: 'info' | 'warn' | 'error') =>
    (...args: unknown[]) => {
      logLines.push({ level, message: String(args[args.length - 1]) });
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
jest.mock('@uncefact/untp-utils/resolvers', () => ({
  ...jest.requireActual('@uncefact/untp-utils/resolvers/errors'),
  resolveDocument: jest.fn(),
}));
jest.mock('@uncefact/untp-utils/node', () => ({
  ...jest.requireActual('@uncefact/untp-utils/node'),
  validatePublicUrl: jest.fn(),
}));

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
import { RecoveryLockDiscoveryExhaustedError } from '@/lib/prisma/repositories/check-run.repository';
import { EncryptionUnavailableError } from '@/lib/library/register-external-credential';
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
    }),
    finaliseGeneration: typedMock<ReverifyLibraryRecordDependencies['finaliseGeneration']>().mockResolvedValue({
      outcome: 'created',
      generation: 2,
      checkRunId: 'run-2',
    }),
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
  jest.clearAllMocks();
  prepareEnqueue.mockImplementation(async () => enqueue);
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
    // make progress without the key-bearing request form.
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
      expectedCustody: { storageUri: null, storageDigestMultibase: null, storageExternalId: null },
      expectedGeneration: 1,
    });
    expect(recoverInRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, sourceUrl: SOURCE_URL }),
      RECORD_ID,
      false,
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
      }),
      recoverInRequest,
    });

    await reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps);

    expect(recoverInRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, sourceUrl: SOURCE_URL }),
      RECORD_ID,
      false,
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
          message: preflightError.message,
          retryable: true,
        }),
      }),
    );
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
      sourceDigest: 'zQmDigest',
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
      sourceDigest: 'zQmDigest',
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
          message: exhaustedError.message,
          retryable: true,
        }),
      }),
    );
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
      sourceDigest: 'zQmDigest',
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
      sourceDigest: 'zQmNewSourceDigest',
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
        prepared: expect.objectContaining({ sourceDigest: 'zQmNewSourceDigest' }),
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
