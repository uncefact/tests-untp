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
import { CredentialDocumentFetchError, type DocumentFetchFailure } from '@/lib/credentials/fetch-credential-document';
import { LibraryRecordShapeError, type NativeLibraryRecordView } from '@/lib/library/library-record-view';
import {
  DecryptionRequiredError,
  ReverifyBranchNotBuiltError,
  reverifyLibraryRecord,
  type ReverifyLibraryRecordDependencies,
} from './reverify-library-record';

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
    getRecord: jest.fn().mockResolvedValue(view()),
    fetchSource: jest.fn().mockResolvedValue({ bytes: SOURCE_BYTES, finalUrl: SOURCE_URL }),
    createGeneration: jest.fn().mockResolvedValue({ outcome: 'created', generation: 2, checkRunId: 'run-2' }),
    ...overrides,
  };
}

const enqueue = jest.fn(async () => undefined);
/** Readied only once the module has decided a generation will be created. */
const prepareEnqueue = jest.fn(async () => enqueue);

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

  it('uses the explicit unbuilt error for an external record without durable custody', async () => {
    // Fails if the re-fetch branch is implemented here ahead of #956's shared
    // recover-mode helper, instead of refusing until it exists.
    const deps = dependencies({ getRecord: jest.fn().mockResolvedValue(view({ external: { storageUri: null } })) });

    await expect(reverifyLibraryRecord(RECORD_ID, TENANT_ID, prepareEnqueue, deps)).rejects.toBeInstanceOf(
      ReverifyBranchNotBuiltError,
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
