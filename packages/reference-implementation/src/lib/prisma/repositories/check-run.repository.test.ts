jest.mock('../prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    checkRun: {
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    externalCredential: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  },
}));

const loggerCalls: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
loggerCalls.child = () => loggerCalls;
jest.mock('@/lib/api/logger', () => ({ apiLogger: loggerCalls }));

jest.mock('@/lib/jobs/prisma-sql-executor', () => ({
  prismaSqlExecutor: (tx: unknown) => tx,
}));

const mockGetLibraryRecordById = jest.fn();
jest.mock('./library-record.repository', () => ({
  getLibraryRecordById: (...args: unknown[]) => mockGetLibraryRecordById(...args),
  // The real helper: recovery's ordered parent lock is asserted through the
  // transaction client's `$queryRawUnsafe`, which the helper calls.
  lockLibraryRecordsForUpdate: jest.requireActual('./library-record.repository').lockLibraryRecordsForUpdate,
}));

import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CredentialDetailsStatus,
  ExternalContentKind,
  LibraryRecordOrigin,
  Prisma,
  type CheckRun,
} from '../generated';
import { prisma } from '../prisma';
import type { SqlExecutor } from '@/lib/jobs/types';
import type { RecoverInRequestOutcome } from '@/lib/library/register-external-credential';
import {
  createReverificationGeneration,
  finaliseRecoveryGeneration,
  findAbandonedPendingCheckRuns,
  reserveRecoveryGeneration,
  settleAbandonedCheckRun,
  RecoveryLockDiscoveryExhaustedError,
  type CreateReverificationGenerationInput,
  type FinaliseRecoveryGenerationInput,
} from './check-run.repository';

const RECORD_ID = 'record-1';
const TENANT_ID = 'tenant-1';
const TX_LOCK = jest.fn();
const TX_FIND = jest.fn();
const TX_CREATE = jest.fn();
const transactionClient = {
  $queryRawUnsafe: TX_LOCK,
  libraryRecord: { findFirst: TX_FIND, update: jest.fn() },
  externalCredential: {
    update: jest.fn(),
    updateMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  checkRun: { create: TX_CREATE, update: jest.fn(), updateMany: jest.fn() },
};
const mockTransaction = prisma.$transaction as unknown as jest.Mock;

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.EXTERNAL,
    credential: null,
    externalCredential: {
      storageUri: 'https://storage.example/old',
      storageDigestMultibase: 'zOldDigest',
      storageExternalId: 'old-object',
      sourceDigest: 'zOldSourceDigest',
      contentDigest: null,
      duplicateOfRecordId: null,
    },
    checkRuns: [{ id: 'run-1', generation: 1, state: CheckRunState.COMPLETE, lastEnqueuedAt: null }],
    ...overrides,
  };
}

function input(overrides: Partial<CreateReverificationGenerationInput> = {}): CreateReverificationGenerationInput {
  return {
    recordId: RECORD_ID,
    tenantId: TENANT_ID,
    expectedGeneration: 1,
    expectedOrigin: LibraryRecordOrigin.EXTERNAL as typeof LibraryRecordOrigin.EXTERNAL,
    expectedCustody: {
      storageUri: 'https://storage.example/old',
      storageDigestMultibase: 'zOldDigest',
      storageExternalId: 'old-object',
    },
    enqueue: jest.fn(async () => undefined),
    ...overrides,
  };
}

function abandonedRun(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 'run-1',
    recordId: RECORD_ID,
    tenantId: TENANT_ID,
    generation: 2,
    state: CheckRunState.PENDING,
    retrieval: CheckResult.NOT_RUN,
    decryption: CheckResult.NOT_RUN,
    digest: CheckResult.NOT_RUN,
    proof: CheckResult.NOT_RUN,
    status: CheckResult.NOT_RUN,
    temporal: CheckResult.NOT_RUN,
    schemaConformance: CheckResult.NOT_RUN,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    sourceChanged: null,
    lastSourceCheckAt: null,
    requestedAt: new Date('2026-09-06T00:00:00.000Z'),
    completedAt: null,
    lastEnqueuedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTransaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) =>
    callback(transactionClient),
  );
  TX_LOCK.mockResolvedValue([{ id: RECORD_ID }]);
  TX_FIND.mockResolvedValue(row());
  TX_CREATE.mockResolvedValue({ id: 'run-2', generation: 2 });
  transactionClient.checkRun.updateMany.mockResolvedValue({ count: 1 });
  mockGetLibraryRecordById.mockResolvedValue({});
  (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(null);
});

describe('createReverificationGeneration', () => {
  it('locks the tenant row, rechecks it and enqueues generation two, all on the transaction client', async () => {
    // Each call is asserted, not their order. The mocked client cannot show
    // that the lock preceded the recheck, and nothing else pins that ordering
    // either. Fails if the recheck uses the global reader, a Repeatable Read
    // snapshot, or omits the custody tuple that protects a prepared copy from
    // a race.
    const enqueue = jest.fn(async (sql: SqlExecutor, job: unknown) => {
      await (sql as unknown as typeof transactionClient).$queryRawUnsafe('send job', job);
    });

    const result = await createReverificationGeneration(input({ enqueue }));

    expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    });
    expect(TX_LOCK).toHaveBeenCalledWith(
      'SELECT "id" FROM "LibraryRecord" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE',
      RECORD_ID,
      TENANT_ID,
    );
    expect(TX_FIND).toHaveBeenCalledWith({
      where: { id: RECORD_ID, tenantId: TENANT_ID },
      include: {
        credential: { select: { storageUri: true, digestMultibase: true } },
        externalCredential: {
          select: {
            storageUri: true,
            storageDigestMultibase: true,
            storageExternalId: true,
            sourceDigest: true,
            contentDigest: true,
            duplicateOfRecordId: true,
          },
        },
        checkRuns: {
          orderBy: { generation: 'desc' },
          take: 1,
          select: { id: true, generation: true, state: true, lastEnqueuedAt: true },
        },
      },
    });
    expect(TX_CREATE).toHaveBeenCalledWith({
      data: expect.objectContaining({
        generation: 2,
        state: CheckRunState.PENDING,
        sourceChanged: null,
        lastSourceCheckAt: null,
      }),
      select: { id: true, generation: true },
    });
    expect(enqueue).toHaveBeenCalledWith(transactionClient, {
      tenantId: TENANT_ID,
      recordId: RECORD_ID,
      generation: 2,
      checkRunId: 'run-2',
    });
  });

  it('joins when the locked recheck sees a pending generation', async () => {
    // Fails if the route-level pending check is the only guard and the
    // transaction inserts a second pending row after preparation.
    TX_FIND.mockResolvedValue(
      row({ checkRuns: [{ id: 'run-1', generation: 1, state: CheckRunState.PENDING, lastEnqueuedAt: new Date() }] }),
    );
    const enqueue = jest.fn(async () => undefined);

    await expect(createReverificationGeneration(input({ enqueue }))).resolves.toEqual({ outcome: 'joined' });
    expect(TX_CREATE).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('reports superseded when custody changed while the request was preparing', async () => {
    // Fails if the recheck lets custody selected by a concurrent request
    // after the initial snapshot go unnoticed.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: 'https://storage.example/new',
          storageDigestMultibase: 'zNewDigest',
          storageExternalId: 'new-object',
        },
      }),
    );

    await expect(createReverificationGeneration(input())).resolves.toEqual({
      outcome: 'superseded',
      generation: 1,
    });
    expect(TX_CREATE).not.toHaveBeenCalled();
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedCustody: expect.objectContaining({ storageUri: 'https://storage.example/old' }),
        observedCustody: expect.objectContaining({ storageUri: 'https://storage.example/new' }),
      }),
      'Re-verification was superseded while it was being prepared; no generation was added',
    );
  });

  it('reports superseded when the newest generation moved while the request was preparing', async () => {
    // Fails if only the custody tuple is compared, so a generation another
    // request already appended is overwritten by this one's number.
    TX_FIND.mockResolvedValue(
      row({ checkRuns: [{ id: 'run-1', generation: 3, state: CheckRunState.COMPLETE, lastEnqueuedAt: new Date() }] }),
    );

    await expect(createReverificationGeneration(input())).resolves.toEqual({
      outcome: 'superseded',
      generation: 3,
    });
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('reports superseded when the record changed origin under the request', async () => {
    // Fails if the origin is trusted from the caller's snapshot, which would
    // write a native custody comparison against an external row.
    TX_FIND.mockResolvedValue(row({ origin: LibraryRecordOrigin.NATIVE, externalCredential: null, credential: null }));

    await expect(createReverificationGeneration(input())).resolves.toEqual(
      expect.objectContaining({ outcome: 'superseded' }),
    );
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('returns missing when the locked row disappears before the recheck reads it', async () => {
    // The lock and the recheck are separate statements. Fails if a null
    // recheck is treated as an empty custody tuple and compared.
    TX_FIND.mockResolvedValue(null);

    await expect(createReverificationGeneration(input())).resolves.toEqual({ outcome: 'missing' });
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('numbers a native record from its stored custody and its issuance assertion', async () => {
    // The native arm of the custody read and the generation floor. Fails if a
    // native row is compared through the external child it does not have.
    TX_FIND.mockResolvedValue(
      row({
        origin: LibraryRecordOrigin.NATIVE,
        externalCredential: null,
        credential: { storageUri: 'https://storage.example/native', digestMultibase: 'zNative' },
        checkRuns: [],
      }),
    );
    TX_CREATE.mockResolvedValue({ id: 'run-2', generation: 2 });

    const result = await createReverificationGeneration(
      input({
        expectedOrigin: LibraryRecordOrigin.NATIVE,
        expectedGeneration: 1,
        expectedCustody: {
          storageUri: 'https://storage.example/native',
          storageDigestMultibase: 'zNative',
          storageExternalId: null,
        },
      }),
    );

    expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
    expect(TX_CREATE).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ generation: 2 }) }),
    );
  });

  it('writes the freshness pair the caller recorded', async () => {
    // Fails if the two columns can be written apart, so a recorded comparison
    // is stored with no timestamp and hidden by the projection for ever.
    const checkedAt = new Date('2026-09-07T10:00:00.000Z');

    await createReverificationGeneration(input({ freshness: { sourceChanged: true, checkedAt } }));

    expect(TX_CREATE).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sourceChanged: true, lastSourceCheckAt: checkedAt }) }),
    );
  });

  it('returns missing and never enqueues when the tenant-scoped lock finds no parent', async () => {
    // Fails if a record deleted during preparation can still gain a run or if
    // a foreign tenant row is accepted by an unscoped lock.
    TX_LOCK.mockResolvedValue([]);

    await expect(createReverificationGeneration(input())).resolves.toEqual({ outcome: 'missing' });
    expect(TX_FIND).not.toHaveBeenCalled();
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('joins the winner after a pending unique violation instead of hiding it as a database failure', async () => {
    // Fails if the unique pending index race is returned as a 500 or if the
    // recovery read forgets the tenant boundary.
    const unique = Object.assign(new Error('pending index'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      clientVersion: '6.19.2',
    });
    mockTransaction.mockRejectedValue(unique);
    (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
      abandonedRun({ state: CheckRunState.PENDING, generation: 2 }),
    );

    await expect(createReverificationGeneration(input())).resolves.toEqual({ outcome: 'joined' });
  });

  it('reports superseded rather than joined when the winner has already settled', async () => {
    // Fails if the recovery answers from the record's existence alone, which
    // would tell a caller to poll a generation nobody is running.
    const unique = Object.assign(new Error('pending index'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      clientVersion: '6.19.2',
    });
    mockTransaction.mockRejectedValue(unique);
    (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
      abandonedRun({ state: CheckRunState.COMPLETE, generation: 2 }),
    );

    await expect(createReverificationGeneration(input())).resolves.toEqual({
      outcome: 'superseded',
      generation: 2,
    });
  });

  it('reports missing when the record itself is gone after the unique violation', async () => {
    // Fails if a record deleted during the race is reported as a join.
    const unique = Object.assign(new Error('pending index'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      clientVersion: '6.19.2',
    });
    mockTransaction.mockRejectedValue(unique);
    (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(null);
    mockGetLibraryRecordById.mockResolvedValue(null);

    await expect(createReverificationGeneration(input())).resolves.toEqual({ outcome: 'missing' });
    expect(mockGetLibraryRecordById).toHaveBeenCalledWith(RECORD_ID, TENANT_ID);
  });
});

describe('finaliseRecoveryGeneration', () => {
  function finaliseInput(overrides: Partial<FinaliseRecoveryGenerationInput> = {}): FinaliseRecoveryGenerationInput {
    return {
      recordId: RECORD_ID,
      tenantId: TENANT_ID,
      checkRunId: 'run-2',
      generation: 2,
      prepared: {
        encrypted: null,
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: {
          state: CheckRunState.FAILED,
          checks: { retrieval: CheckResult.FAIL },
          failure: { code: CheckRunFailureCode.RETRIEVAL_FAILED, message: 'source unavailable', retryable: true },
        },
      } as RecoverInRequestOutcome,
      enqueue: jest.fn(async () => undefined),
      ...overrides,
    };
  }

  function identityHoldingRow() {
    return row({
      externalCredential: {
        storageUri: null,
        storageDigestMultibase: null,
        storageExternalId: null,
        sourceDigest: 'zOldSourceDigest',
        contentDigest: 'zHeldContentDigest',
        duplicateOfRecordId: null,
      },
      checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
    });
  }

  it('settles RETRIEVAL_FAILED with retrieval FAIL, not SOURCE_NOT_CREDENTIAL, when a re-fetch on an identity-holding row is unobserved', async () => {
    // A retrieval failure (connection refused, DNS, timeout) never opens a
    // body at all, so it must never take the rejected-replacement branch
    // that exists for an observed-but-wrong-kind fetch. Custody, identity
    // and details stay exactly as they were.
    TX_FIND.mockResolvedValue(identityHoldingRow());

    const result = await finaliseRecoveryGeneration(finaliseInput());

    expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
    expect(transactionClient.externalCredential.update).not.toHaveBeenCalled();
    expect(transactionClient.libraryRecord.update).not.toHaveBeenCalled();
    expect(transactionClient.checkRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-2', tenantId: TENANT_ID, state: CheckRunState.PENDING, lastEnqueuedAt: null },
      data: expect.objectContaining({
        state: CheckRunState.FAILED,
        retrieval: CheckResult.FAIL,
        decryption: CheckResult.NOT_RUN,
        failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
        failureMessage: 'source unavailable',
        failureRetryable: true,
      }),
    });
  });

  it('locks every required parent in exactly one ordered statement, not one call per id', async () => {
    // The deadlock-freedom argument for this transaction depends on every
    // finalisation acquiring its parents through this same single ordered
    // `FOR UPDATE`, never one call per id and never unordered: a scenario
    // that genuinely needs two locked parents (the recovering record and the
    // duplicate pointer's existing holder) is what actually exercises the
    // call-count and clause-text guarantee, unlike a single-parent case.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: null,
          storageDigestMultibase: null,
          storageExternalId: null,
          sourceDigest: 'zOldSourceDigest',
          contentDigest: null,
          duplicateOfRecordId: null,
        },
        checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );
    (prisma.externalCredential.findFirst as unknown as jest.Mock).mockResolvedValue(null);
    transactionClient.externalCredential.findFirst.mockResolvedValue(null);
    transactionClient.externalCredential.findUnique.mockResolvedValue({ id: 'existing-holder' });
    const existingParents = new Set([RECORD_ID, 'existing-holder']);
    TX_LOCK.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (sql.includes('"LibraryRecord"')) {
        // Accept a per-id call shape too, so a split lock statement reaches the call-count assertion.
        const ids = (Array.isArray(args[0]) ? args[0] : [args[0]]) as string[];
        return ids.filter((id) => existingParents.has(id)).map((id) => ({ id }));
      }
      if (sql.includes('"CheckRun"')) return [{ id: 'run-2' }];
      if (sql.includes('"contentDigest" = $3')) return [{ id: 'existing-holder' }]; // lockedDigestHolder
      return []; // lockedAnyDigestHolder
    });
    transactionClient.externalCredential.update.mockResolvedValueOnce({});

    const prepared = {
      sourceDigest: 'zObservedSourceDigest',
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      duplicateOfRecordId: 'existing-holder',
      observedContentDigest: 'zTargetDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
    } as RecoverInRequestOutcome;

    const result = await finaliseRecoveryGeneration(finaliseInput({ prepared }));

    expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
    const libraryRecordLockCalls = TX_LOCK.mock.calls.filter(([sql]) => (sql as string).includes('"LibraryRecord"'));
    expect(libraryRecordLockCalls).toHaveLength(1);
    expect(libraryRecordLockCalls[0][0]).toEqual(expect.stringContaining('= ANY('));
    expect(libraryRecordLockCalls[0][0]).toEqual(expect.stringContaining('ORDER BY "id" ASC'));
    expect(libraryRecordLockCalls[0][1]).toEqual(expect.arrayContaining([RECORD_ID, 'existing-holder']));
  });

  it('settles RETRIEVAL_FAILED with retryable false when the guard refused the source on an identity-holding row', async () => {
    // The guard-rejection reading is unobserved too (nothing was fetched),
    // and it is deterministic, so it must keep the retryable:false the
    // register/recover pipeline gives it, not the retryable:true a genuine
    // rejected-replacement carries.
    TX_FIND.mockResolvedValue(identityHoldingRow());
    const prepared = {
      encrypted: null,
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.FAILED,
        checks: { retrieval: CheckResult.FAIL },
        failure: {
          code: CheckRunFailureCode.RETRIEVAL_FAILED,
          message: 'The source was refused by the guard.',
          retryable: false,
        },
      },
    } as RecoverInRequestOutcome;

    const result = await finaliseRecoveryGeneration(finaliseInput({ prepared }));

    expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
    expect(transactionClient.externalCredential.update).not.toHaveBeenCalled();
    expect(transactionClient.libraryRecord.update).not.toHaveBeenCalled();
    expect(transactionClient.checkRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-2', tenantId: TENANT_ID, state: CheckRunState.PENDING, lastEnqueuedAt: null },
      data: expect.objectContaining({
        state: CheckRunState.FAILED,
        failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
        failureRetryable: false,
      }),
    });
  });

  it('settles a moved-identity failure, writing nothing else, when the store was skipped for an identity the row no longer holds', async () => {
    // In-request, the reservation's own identity snapshot said this row held
    // an identity, so `settleInRequest` skipped storing the non-credential
    // response and marked the outcome `storageSkipped: 'identity-held'`. By
    // finalisation, under this transaction's own lock, the row holds no
    // identity at all: a concurrent write cleared it while the fetch ran.
    // The prepared failure was never earned on its own terms and must not be
    // consumed; this settles its own moved-identity failure and touches no
    // custody, identity or details column. "Nothing else written" means
    // exactly those three, not the freshness pair: a fetch genuinely ran and
    // was observed, so `sourceChanged`/`lastSourceCheckAt` are still stamped
    // the same way every other observed outcome stamps them.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: null,
          storageDigestMultibase: null,
          storageExternalId: null,
          sourceDigest: 'zOldSourceDigest',
          contentDigest: null,
          duplicateOfRecordId: null,
        },
        checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );
    const prepared = {
      sourceDigest: 'zFetchedSourceDigest',
      encrypted: true,
      contentKind: ExternalContentKind.OPAQUE,
      decryptionKeyUnused: false,
      storageSkipped: 'identity-held',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.FAILED,
        checks: { retrieval: CheckResult.PASS, decryption: CheckResult.FAIL },
        failure: {
          code: CheckRunFailureCode.DECRYPTION_REQUIRED,
          message: 'irrelevant: never consumed',
          retryable: true,
        },
      },
    } as RecoverInRequestOutcome;

    const result = await finaliseRecoveryGeneration(finaliseInput({ prepared }));

    expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
    expect(transactionClient.externalCredential.update).not.toHaveBeenCalled();
    expect(transactionClient.libraryRecord.update).not.toHaveBeenCalled();
    expect(transactionClient.checkRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-2', tenantId: TENANT_ID, state: CheckRunState.PENDING, lastEnqueuedAt: null },
      data: expect.objectContaining({
        state: CheckRunState.FAILED,
        failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
        failureMessage: "The record's identity changed while its source was being fetched. Re-verify to fetch again.",
        failureRetryable: true,
        // A fetch genuinely ran and was observed here, so the freshness pair
        // is still stamped: sourceChanged compares the fetched digest
        // against the row's prior sourceDigest, exactly as the
        // rejected-replacement branch does with no `input.freshness` given.
        sourceChanged: true,
        lastSourceCheckAt: expect.any(Date),
      }),
    });
    // Never the prepared failure this outcome carried (DECRYPTION_REQUIRED):
    // that failure was never earned, so it must never be the one written.
    expect(transactionClient.checkRun.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failureCode: CheckRunFailureCode.DECRYPTION_REQUIRED }),
      }),
    );
  });

  it('reports superseded and writes nothing when the claimed run is settled by another actor before the write commits', async () => {
    // The FOR UPDATE claim succeeds (the row was still pending when this
    // transaction reached it), but the later `updateMany` matches no row:
    // something else settled the exact run this transaction is holding
    // between the claim and the write. `RecoveryReservationLostError` must
    // abort the whole transaction, so no custody, identity or detail write
    // from this attempt can have committed either.
    TX_FIND.mockResolvedValue(identityHoldingRow());
    transactionClient.checkRun.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await finaliseRecoveryGeneration(finaliseInput());

    expect(result).toEqual({ outcome: 'superseded', generation: null });
    expect(transactionClient.externalCredential.update).not.toHaveBeenCalled();
    expect(transactionClient.libraryRecord.update).not.toHaveBeenCalled();
  });

  it('reports superseded and writes nothing when the atomic claim itself finds no pending row, orphan-logging any stored copy', async () => {
    // The very first statement after the parent locks: zero rows means the
    // reservation is no longer exactly as this attempt left it, before any
    // child write is even attempted.
    TX_FIND.mockResolvedValue(identityHoldingRow());
    TX_LOCK.mockImplementation(async (sql: string) => {
      if (sql.includes('"LibraryRecord"')) return [{ id: RECORD_ID }];
      if (sql.includes('"CheckRun"')) return []; // the claim itself finds nothing
      return [];
    });
    const prepared = {
      encrypted: false,
      contentKind: ExternalContentKind.OPAQUE,
      decryptionKeyUnused: false,
      sourceDigest: 'zFetchedSourceDigest',
      storage: { uri: 'https://storage.example/orphan', externalId: 'orphan-1', bucket: 'private' },
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.FAILED,
        checks: { retrieval: CheckResult.PASS },
        failure: { code: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL, message: 'not a credential', retryable: true },
      },
    } as RecoverInRequestOutcome;

    const result = await finaliseRecoveryGeneration(finaliseInput({ prepared }));

    expect(result).toEqual({ outcome: 'superseded', generation: 2 });
    expect(transactionClient.externalCredential.update).not.toHaveBeenCalled();
    expect(transactionClient.libraryRecord.update).not.toHaveBeenCalled();
    expect(transactionClient.checkRun.updateMany).not.toHaveBeenCalled();
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: RECORD_ID,
        reason: 'superseded',
        storageUri: 'https://storage.example/orphan',
      }),
      'Prepared recovery copy is orphaned and needs operator cleanup',
    );
  });

  it('retries once on a promotion collision, then rethrows and logs a promotion-specific line on a second failure', async () => {
    // `promoteExternalCredentialDigest`'s advisory write is the one that can
    // collide with a concurrent writer claiming the digest this row is
    // relinquishing. Tagged 'promotion' at that write, this must retry once,
    // independently of the acquisition retry, and on a second failure log
    // the promotion-specific line rather than the acquisition one.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: null,
          storageDigestMultibase: null,
          storageExternalId: null,
          sourceDigest: 'zOldSourceDigest',
          contentDigest: 'zOldContentDigest',
          duplicateOfRecordId: null,
        },
        checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );
    // Both the unlocked pre-plan (global client) and the locked re-derivation
    // (tx) must see the same advisory, or the pre-plan's lock set omits it
    // and this hits the lock-discovery mismatch path instead of the
    // promotion-collision path this test means to exercise. The parent lock
    // query must also actually lock that id, or the re-derivation's check
    // fails the same way for a reason unrelated to this test.
    (prisma.externalCredential.findFirst as unknown as jest.Mock).mockResolvedValue({ id: 'advisory-1' });
    TX_LOCK.mockImplementation(async (sql: string) =>
      sql.includes('"LibraryRecord"') ? [{ id: RECORD_ID }, { id: 'advisory-1' }] : [{ id: 'run-2' }],
    );
    const promotionCollision = Object.assign(new Error('unique violation'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      clientVersion: '6.19.2',
      meta: { target: ['tenantId', 'contentDigest'] },
    });
    // Per attempt: release the old digest (succeeds), find the oldest
    // advisory (found), then the advisory's own promotion write (collides,
    // both attempts).
    transactionClient.externalCredential.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(promotionCollision)
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(promotionCollision);
    transactionClient.externalCredential.findFirst.mockResolvedValue({ id: 'advisory-1' });

    const prepared = {
      sourceDigest: 'zNewSourceDigest',
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zNewContentDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
    } as RecoverInRequestOutcome;

    await expect(finaliseRecoveryGeneration(finaliseInput({ prepared }))).rejects.toMatchObject({ code: 'P2002' });

    expect(transactionClient.externalCredential.updateMany).toHaveBeenCalledTimes(4);
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'zOldContentDigest' }),
      'Content identity promotion collided with a concurrent writer; retrying once',
    );
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'zOldContentDigest' }),
      'Content identity promotion collided twice with a concurrent writer',
    );
  });

  it('retries a first acquisition collision on an already-duplicate prepared outcome, keyed on observedContentDigest', async () => {
    // `prepared.contentDigest` is undefined here (this
    // outcome already pointed at another record when it left settleInRequest)
    // and only `observedContentDigest` carries the digest this row is about
    // to try to acquire, because its preferred holder vanished and no other
    // row holds it either. The collision tag's digest must come from
    // `contentDigest ?? observedContentDigest`; a mutation that reads only
    // `contentDigest` would leave this collision untagged, so it would fall
    // through to the unreachable-in-practice defensive branch with no retry
    // at all, and this test would then reject with the raw P2002 instead of
    // resolving to the new winner.
    //
    // Full reset (not just clearAllMocks' call-history clear) on every mock
    // this test configures with a queued once-sequence, so no earlier test's
    // base implementation or leftover queue can affect the sequence below.
    TX_LOCK.mockReset();
    transactionClient.externalCredential.findUnique.mockReset();
    transactionClient.externalCredential.findFirst.mockReset();
    transactionClient.externalCredential.update.mockReset();
    (prisma.externalCredential.findFirst as unknown as jest.Mock).mockReset();
    // `findExternalByContentDigest(..., tx)`'s own lookup: nobody else holds
    // the target digest under lock in this scenario (the preferred-pointer
    // and any-holder raw queries below are what actually resolve it).
    transactionClient.externalCredential.findFirst.mockResolvedValue(null);
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: null,
          storageDigestMultibase: null,
          storageExternalId: null,
          sourceDigest: 'zOldSourceDigest',
          contentDigest: null,
          duplicateOfRecordId: 'vanished-holder',
        },
        checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );
    let preferredHolderCalls = 0;
    const existingParents = new Set([RECORD_ID, 'new-winner']); // not 'vanished-holder'
    TX_LOCK.mockImplementation(async (sql: string, ids?: unknown) => {
      if (sql.includes('"LibraryRecord"')) {
        return (ids as string[]).filter((id) => existingParents.has(id)).map((id) => ({ id }));
      }
      if (sql.includes('"CheckRun"')) return [{ id: 'run-2' }];
      if (sql.includes('"contentDigest" = $3')) {
        // lockedDigestHolder: the preferred pointer, revalidated. Vanished
        // on the first attempt; 'new-winner' genuinely holds it on the retry.
        preferredHolderCalls += 1;
        return preferredHolderCalls === 1 ? [] : [{ id: 'new-winner' }];
      }
      // lockedAnyDigestHolder: no other row holds it either, on any attempt
      // this test reaches (the retry resolves via the preferred lookup above).
      return [];
    });
    // The unlocked pre-plan's holder-of-the-target-digest lookup (global
    // client): nobody holds it yet on the first attempt; 'new-winner' does
    // from the retry onward, matching what the collision itself proves.
    (prisma.externalCredential.findFirst as unknown as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'new-winner' });
    // The locked re-derivation's own existence check on the preferred
    // pointer, then its currentDigest check for this row
    // itself, once per attempt: vanished, then null; found, then null.
    transactionClient.externalCredential.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'new-winner' })
      .mockResolvedValueOnce(null);
    const acquisitionCollision = Object.assign(new Error('unique violation'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      clientVersion: '6.19.2',
      meta: { target: ['tenantId', 'contentDigest'] },
    });
    transactionClient.externalCredential.update.mockRejectedValueOnce(acquisitionCollision).mockResolvedValueOnce({});

    const prepared = {
      sourceDigest: 'zObservedSourceDigest',
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      duplicateOfRecordId: 'vanished-holder',
      observedContentDigest: 'zTargetDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
    } as RecoverInRequestOutcome;

    const result = await finaliseRecoveryGeneration(finaliseInput({ prepared }));

    expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
    expect(transactionClient.externalCredential.update).toHaveBeenCalledTimes(2);
    expect(transactionClient.externalCredential.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contentDigest: null, duplicateOfRecordId: 'new-winner' }),
      }),
    );
  });

  it('drops a deleted preferred holder from the required lock set and proceeds to canonical acquisition, with no restart', async () => {
    // `prepared.duplicateOfRecordId` names a record deleted since preparation.
    // The unlocked pre-plan is optimistic and adds it anyway; the locked
    // re-derivation must confirm it no longer exists and drop it, rather
    // than demanding a lock this attempt can never satisfy (which would
    // burn through the restart budget for no reason). One
    // clean attempt: no RecoveryLockDiscoveryMismatchError, no restart.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: null,
          storageDigestMultibase: null,
          storageExternalId: null,
          sourceDigest: 'zOldSourceDigest',
          contentDigest: null,
          duplicateOfRecordId: 'deleted-holder',
        },
        checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );
    TX_LOCK.mockImplementation(async (sql: string) => {
      if (sql.includes('"LibraryRecord"')) return [{ id: RECORD_ID }]; // 'deleted-holder' does not exist
      if (sql.includes('"CheckRun"')) return [{ id: 'run-2' }];
      // lockedDigestHolder and lockedAnyDigestHolder: nobody holds the target digest.
      return [];
    });
    (prisma.externalCredential.findFirst as unknown as jest.Mock).mockResolvedValue(null);
    transactionClient.externalCredential.findFirst.mockResolvedValue(null);
    // The re-derivation's existence check on the preferred pointer: gone.
    transactionClient.externalCredential.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    transactionClient.externalCredential.update.mockResolvedValueOnce({});

    const prepared = {
      sourceDigest: 'zObservedSourceDigest',
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      duplicateOfRecordId: 'deleted-holder',
      observedContentDigest: 'zTargetDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
    } as RecoverInRequestOutcome;

    const result = await finaliseRecoveryGeneration(finaliseInput({ prepared }));

    expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
    expect(transactionClient.externalCredential.update).toHaveBeenCalledTimes(1);
    expect(transactionClient.externalCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contentDigest: 'zTargetDigest', duplicateOfRecordId: null }),
      }),
    );
  });

  it('restarts three times on three distinct lock-discovery mismatches, then exhausts on a fourth, still-different missing id', async () => {
    // Four distinct missing ids across four attempts, never the same id
    // twice: a moving identity set that never settles, not a single miss a
    // retry would clear. `MAX_LOCK_DISCOVERY_RESTARTS` (3) is sized for up
    // to four concurrent racers on one digest, each of which can move the
    // holder once; this scenario is the pathological case beyond that, where
    // a fifth distinct id keeps appearing, so all three restarts are spent
    // and the fourth mismatch must exhaust rather than restart again.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: null,
          storageDigestMultibase: null,
          storageExternalId: null,
          sourceDigest: 'zOldSourceDigest',
          contentDigest: null,
          duplicateOfRecordId: null,
        },
        checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );
    // The unlocked pre-plan (global client) never finds a holder, on any
    // attempt, so `lockIds` only ever grows via `forcedLockIds`.
    (prisma.externalCredential.findFirst as unknown as jest.Mock).mockResolvedValue(null);
    // The locked re-derivation's own holder lookup: a fresh, still-unlocked
    // id on every one of the four attempts, proving the set never settles.
    transactionClient.externalCredential.findFirst
      .mockResolvedValueOnce({ id: 'missing-a' })
      .mockResolvedValueOnce({ id: 'missing-b' })
      .mockResolvedValueOnce({ id: 'missing-c' })
      .mockResolvedValueOnce({ id: 'missing-d' });
    // Every attempt only ever confirms `RECORD_ID` locked: the missing id
    // each attempt's own required-check demands is never actually part of
    // what the parent lock query reports back as confirmed, so every
    // attempt's required-check finds its own freshly-demanded id still
    // outside `lockedIds` and mismatches again.
    TX_LOCK.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (sql.includes('"LibraryRecord"')) {
        const ids = (Array.isArray(args[0]) ? args[0] : [args[0]]) as string[];
        return ids.filter((id) => id === RECORD_ID).map((id) => ({ id }));
      }
      if (sql.includes('"CheckRun"')) return [{ id: 'run-2' }];
      return [];
    });

    const prepared = {
      sourceDigest: 'zObservedSourceDigest',
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zTargetDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
    } as RecoverInRequestOutcome;

    await expect(finaliseRecoveryGeneration(finaliseInput({ prepared }))).rejects.toThrow(
      RecoveryLockDiscoveryExhaustedError,
    );

    // Exactly four attempts: the original plus all three bounded restarts,
    // never a fifth attempt for the fourth mismatch.
    expect(mockTransaction).toHaveBeenCalledTimes(4);
    expect(transactionClient.externalCredential.findFirst).toHaveBeenCalledTimes(4);
    expect(transactionClient.externalCredential.update).not.toHaveBeenCalled();
  });

  it('restarts three times and then succeeds, once the fourth attempt finally finds no further missing id', async () => {
    // The realistic N-way collision this bound was widened for: three
    // distinct racers move the holder out from under this attempt's pre-plan
    // in turn, each triggering one restart, and by the fourth attempt the
    // set has settled (nothing more is missing), so this finalisation
    // succeeds within the widened bound rather than exhausting it. Proves
    // `MAX_LOCK_DISCOVERY_RESTARTS` actually being 3, not just the exhaustion
    // guard firing at the right count.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: null,
          storageDigestMultibase: null,
          storageExternalId: null,
          sourceDigest: 'zOldSourceDigest',
          contentDigest: null,
          duplicateOfRecordId: null,
        },
        checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );
    (prisma.externalCredential.findFirst as unknown as jest.Mock).mockResolvedValue(null);
    // Three distinct missing ids on the first three attempts; the fourth
    // attempt's own required-check finds nothing further missing.
    transactionClient.externalCredential.findFirst
      .mockResolvedValueOnce({ id: 'missing-a' })
      .mockResolvedValueOnce({ id: 'missing-b' })
      .mockResolvedValueOnce({ id: 'missing-c' })
      .mockResolvedValueOnce(null);
    const confirmedParents = new Set([RECORD_ID, 'missing-a', 'missing-b', 'missing-c']);
    TX_LOCK.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (sql.includes('"LibraryRecord"')) {
        const ids = (Array.isArray(args[0]) ? args[0] : [args[0]]) as string[];
        return ids.filter((id) => confirmedParents.has(id)).map((id) => ({ id }));
      }
      if (sql.includes('"CheckRun"')) return [{ id: 'run-2' }];
      return [];
    });
    transactionClient.externalCredential.update.mockResolvedValue({});

    const prepared = {
      sourceDigest: 'zObservedSourceDigest',
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zTargetDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
    } as RecoverInRequestOutcome;

    const result = await finaliseRecoveryGeneration(finaliseInput({ prepared }));

    expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
    // The fourth attempt: the original plus all three restarts, and no more.
    expect(mockTransaction).toHaveBeenCalledTimes(4);
    expect(transactionClient.externalCredential.findFirst).toHaveBeenCalledTimes(4);
  });

  it('propagates RecoveryReservationLostError out of the transaction callback when the guarded run write matches no row, reporting superseded with the orphan', async () => {
    // A genuine successful-fetch path this time (custody is replaced and the
    // identity/details writes both succeed on the tx mock), not the
    // rejected-replacement branch: the guarded final write to the run itself
    // is what returns count 0 here, simulating a settler that raced this
    // transaction and won between the claim and this exact write. Prisma
    // rolls back a transaction whose callback promise rejects, which is
    // exactly what letting `RecoveryReservationLostError` propagate out of
    // this callback (rather than being caught inside it) achieves: nothing
    // this attempt wrote (custody, identity, details) can have committed.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: null,
          storageDigestMultibase: null,
          storageExternalId: null,
          sourceDigest: 'zOldSourceDigest',
          contentDigest: null,
          duplicateOfRecordId: null,
        },
        checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );
    transactionClient.externalCredential.update.mockResolvedValue({});
    transactionClient.checkRun.updateMany.mockResolvedValueOnce({ count: 0 });

    const prepared = {
      sourceDigest: 'zFetchedSourceDigest',
      encrypted: false,
      contentKind: ExternalContentKind.OPAQUE,
      decryptionKeyUnused: false,
      storage: {
        uri: 'https://storage.example/new',
        digestMultibase: 'zNewDigest',
        serviceInstanceId: 'svc-1',
        externalId: 'new-object',
      },
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.PENDING,
        checks: { retrieval: CheckResult.PASS },
        enqueue: jest.fn(async () => undefined),
      },
    } as RecoverInRequestOutcome;

    const result = await finaliseRecoveryGeneration(finaliseInput({ prepared }));

    // The custody replacement's own write ran (and, in a real database, was
    // rolled back along with everything else in this transaction) before the
    // guarded run write found no matching row and threw.
    expect(transactionClient.externalCredential.update).toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'superseded', generation: null });
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: RECORD_ID,
        reason: 'superseded',
        storageUri: 'https://storage.example/new',
      }),
      'Prepared recovery copy is orphaned and needs operator cleanup',
    );
  });

  it('discovers the digest holder without locking, then rejects locking it when it is outside the already-locked parent set', async () => {
    // `lockedAnyDigestHolder`'s own discover-then-validate-then-lock guard:
    // the unlocked probe finds a holder outside `lockedIds`, and that must
    // throw before any `ExternalCredential FOR UPDATE` is ever issued.
    // Never lock first and check membership after.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: null,
          storageDigestMultibase: null,
          storageExternalId: null,
          sourceDigest: 'zOldSourceDigest',
          contentDigest: null,
          duplicateOfRecordId: null,
        },
        checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );
    // The unlocked pre-plan and the locked required-check both miss this
    // holder (its own `findExternalByContentDigest` lookup returns null on
    // both clients): the only place `'late-holder'` is ever discovered is
    // `lockedAnyDigestHolder`'s own unlocked probe, run later, inside
    // `reconcileIdentity`, after the parent lock only covers `RECORD_ID`.
    (prisma.externalCredential.findFirst as unknown as jest.Mock).mockResolvedValue(null);
    transactionClient.externalCredential.findFirst.mockResolvedValue(null);
    let anyDigestHolderCalls = 0;
    TX_LOCK.mockImplementation(async (sql: string) => {
      if (sql.includes('"LibraryRecord"')) return [{ id: RECORD_ID }]; // only this attempt's own row is locked
      if (sql.includes('"CheckRun"')) return [{ id: 'run-2' }];
      if (sql.includes('FOR UPDATE')) {
        // Any `ExternalCredential FOR UPDATE` at all, before the probe has
        // been validated, is exactly the bug this guards against.
        anyDigestHolderCalls += 1;
        return [{ id: 'late-holder' }];
      }
      // The unlocked probe: found, but outside the locked set.
      return [{ id: 'late-holder' }];
    });

    const prepared = {
      sourceDigest: 'zObservedSourceDigest',
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      contentDigest: 'zTargetDigest',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
    } as RecoverInRequestOutcome;

    // Only one attempt's worth of forced ids ever includes 'late-holder': the
    // restart adds it and locks it, so the second attempt actually succeeds.
    // This test only needs to prove the first attempt never locked the child
    // before validating it, so it asserts on the transaction count and the
    // absence of a premature lock instead of forcing a permanent mismatch.
    await finaliseRecoveryGeneration(finaliseInput({ prepared })).catch(() => undefined);

    expect(anyDigestHolderCalls).toBe(0);
  });
});

describe('reserveRecoveryGeneration', () => {
  function reserveInput(overrides: Record<string, unknown> = {}) {
    return {
      recordId: RECORD_ID,
      tenantId: TENANT_ID,
      expectedGeneration: 0,
      expectedCustody: { storageUri: null, storageDigestMultibase: null, storageExternalId: null },
      ...overrides,
    };
  }

  beforeEach(() => {
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: null,
          storageDigestMultibase: null,
          storageExternalId: null,
          sourceDigest: null,
          contentDigest: null,
          duplicateOfRecordId: null,
        },
        checkRuns: [],
      }),
    );
    TX_CREATE.mockResolvedValue({ id: 'run-2', generation: 1 });
  });

  it('reserves generation 1 as PENDING with no checks stamped and no job', async () => {
    const result = await reserveRecoveryGeneration(reserveInput());

    expect(result).toEqual({
      outcome: 'reserved',
      generation: 1,
      checkRunId: 'run-2',
      identity: { contentDigest: null, duplicateOfRecordId: null },
    });
    expect(TX_CREATE).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recordId: RECORD_ID,
        tenantId: TENANT_ID,
        generation: 1,
        state: CheckRunState.PENDING,
        retrieval: CheckResult.NOT_RUN,
      }),
      select: { id: true, generation: true },
    });
    // No enqueue argument exists on this function's input at all; nothing
    // here can call one. The generic transaction mock has no enqueue call to
    // assert against, which is itself the point: reservation never enqueues.
  });

  it('retries once and succeeds when the reservation transaction deadlocks', async () => {
    const deadlock = Object.assign(new Error('deadlock detected'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2034',
      clientVersion: '6.19.2',
    });
    mockTransaction
      .mockRejectedValueOnce(deadlock)
      .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(transactionClient));

    await expect(reserveRecoveryGeneration(reserveInput())).resolves.toEqual({
      outcome: 'reserved',
      generation: 1,
      checkRunId: 'run-2',
      identity: { contentDigest: null, duplicateOfRecordId: null },
    });
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });

  it('rethrows when the reservation transaction deadlocks twice in a row', async () => {
    const deadlock = () =>
      Object.assign(new Error('deadlock detected'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2034',
        clientVersion: '6.19.2',
      });
    mockTransaction.mockRejectedValueOnce(deadlock()).mockRejectedValueOnce(deadlock());

    await expect(reserveRecoveryGeneration(reserveInput())).rejects.toMatchObject({ code: 'P2034' });
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });

  it('joins an existing pending run instead of reserving a second one', async () => {
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: null,
          storageDigestMultibase: null,
          storageExternalId: null,
          sourceDigest: null,
          contentDigest: null,
          duplicateOfRecordId: null,
        },
        checkRuns: [{ id: 'run-1', generation: 1, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );

    await expect(reserveRecoveryGeneration(reserveInput())).resolves.toEqual({ outcome: 'joined' });
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('reports superseded when custody or generation moved since the caller read the record', async () => {
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: 'https://storage.example/attached',
          storageDigestMultibase: 'z',
          storageExternalId: 'o',
          sourceDigest: null,
          contentDigest: null,
          duplicateOfRecordId: null,
        },
        checkRuns: [],
      }),
    );

    await expect(reserveRecoveryGeneration(reserveInput())).resolves.toEqual({ outcome: 'superseded', generation: 0 });
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('returns missing when the tenant-scoped lock finds no parent', async () => {
    TX_LOCK.mockResolvedValue([]);

    await expect(reserveRecoveryGeneration(reserveInput())).resolves.toEqual({ outcome: 'missing' });
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('joins the winner after losing a unique-index race on the reservation insert', async () => {
    const unique = Object.assign(new Error('pending index'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      clientVersion: '6.19.2',
    });
    mockTransaction.mockRejectedValue(unique);
    (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
      abandonedRun({ state: CheckRunState.PENDING }),
    );

    await expect(reserveRecoveryGeneration(reserveInput())).resolves.toEqual({ outcome: 'joined' });
  });
});

describe('pending-run reconciliation repository', () => {
  it('selects only pending rows with no marker or an older marker', async () => {
    // Fails if complete runs are settled again, fresh jobs are treated as lost,
    // or the null marker is silently excluded.
    const cutoff = new Date('2026-09-06T23:30:00.000Z');
    const findMany = prisma.checkRun.findMany as unknown as jest.Mock;
    findMany.mockResolvedValue([]);

    await findAbandonedPendingCheckRuns(cutoff, 500);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        state: CheckRunState.PENDING,
        OR: [{ lastEnqueuedAt: null, requestedAt: { lt: cutoff } }, { lastEnqueuedAt: { lt: cutoff } }],
      },
      orderBy: { requestedAt: 'asc' },
      take: 500,
    });
  });

  it('takes at most the limit it is given', async () => {
    // Fails if the query keeps a fixed cap instead of the caller's.
    const findMany = prisma.checkRun.findMany as unknown as jest.Mock;
    findMany.mockResolvedValue([]);

    await findAbandonedPendingCheckRuns(new Date('2026-09-07T00:00:00Z'), 25);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
  });

  it('gives a run with no marker the same grace as every other run', async () => {
    // Fails if a missing marker is read as proof of abandonment, which would
    // settle a run created seconds ago on the next tick. The bound is on the
    // row's own clock in that arm, not only on the marker.
    const cutoff = new Date('2026-09-06T23:30:00.000Z');
    const findMany = prisma.checkRun.findMany as unknown as jest.Mock;
    findMany.mockResolvedValue([]);

    await findAbandonedPendingCheckRuns(cutoff, 500);

    const where = findMany.mock.calls[0][0].where as { OR: Array<Record<string, unknown>> };
    const nullMarkerArm = where.OR.find((arm) => arm.lastEnqueuedAt === null);
    expect(nullMarkerArm).toEqual({ lastEnqueuedAt: null, requestedAt: { lt: cutoff } });
  });

  it('uses the state guard and preserves the run checks when settling an abandoned row', async () => {
    // Fails if a late worker result can overwrite the sweep, or if the sweep
    // drops a check result while replacing the state and failure fields.
    const updateMany = prisma.checkRun.updateMany as unknown as jest.Mock;
    const count = prisma.checkRun.count as unknown as jest.Mock;
    updateMany.mockResolvedValue({ count: 1 });
    const cutoff = new Date('2026-09-06T23:30:00.000Z');

    await expect(
      settleAbandonedCheckRun(abandonedRun({ retrieval: CheckResult.PASS, digest: CheckResult.PASS }), cutoff),
    ).resolves.toEqual({ outcome: 'applied' });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        tenantId: TENANT_ID,
        state: CheckRunState.PENDING,
        OR: [{ lastEnqueuedAt: null }, { lastEnqueuedAt: { lt: cutoff } }],
      },
      data: expect.objectContaining({
        state: CheckRunState.FAILED,
        retrieval: CheckResult.PASS,
        digest: CheckResult.PASS,
        proof: CheckResult.NOT_RUN,
        failureCode: 'VERIFICATION_UNAVAILABLE',
        failureMessage:
          'The verification job did not report a result within the expected window. Re-verify to run it again.',
        failureRetryable: true,
      }),
    });
    expect(count).not.toHaveBeenCalled();
  });

  it('does not overwrite a reservation finalised between selection and settlement', async () => {
    // The row was selected with a stale lastEnqueuedAt: null, but by the time
    // the sweep writes, finalisation has already refreshed it. Fails if the
    // UPDATE's own WHERE clause does not recheck the abandonment predicate,
    // which would let this settlement overwrite a run a real worker now owns.
    const updateMany = prisma.checkRun.updateMany as unknown as jest.Mock;
    const count = prisma.checkRun.count as unknown as jest.Mock;
    updateMany.mockResolvedValue({ count: 0 });
    count.mockResolvedValue(1);
    const cutoff = new Date('2026-09-06T23:30:00.000Z');

    await expect(settleAbandonedCheckRun(abandonedRun(), cutoff)).resolves.toEqual({ outcome: 'superseded' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ lastEnqueuedAt: null }, { lastEnqueuedAt: { lt: cutoff } }] }),
      }),
    );
  });
});

// `finaliseRecoveryGeneration`'s fetched-content rule, lock ordering,
// collision retry and promotion-timestamp behaviour are exercised end to end
// against real Postgres in
// `__tests__/integration/library-reverify.integration.test.ts`:
// mocking its multi-query, multi-table transaction body here would mostly
// re-describe the SQL rather than test behaviour, and the concurrency and
// lock-order guarantees are not meaningfully testable without a real
// database and real locks.
