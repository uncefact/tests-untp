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
    libraryRecord: { findFirst: jest.fn() },
  },
}));

/**
 * The reduced capture, for asserting which line was written and with which
 * fields. It cannot see a leak: a jest mock records the object it was handed
 * without rendering it, so `{ err: error }`, which pino would expand cause
 * chain and all, is indistinguishable here from a reduced `{ error }`.
 */
const loggerCalls: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
/** The same calls rendered by the real pino logger, for assertions about what a line CARRIES. */
const renderedLogLines: string[] = [];
loggerCalls.child = () => loggerCalls;
jest.mock('@/lib/api/logger', () => {
  const { createLogger } = jest.requireActual('@uncefact/untp-ri-services/logging');
  const rendering = createLogger({
    level: 'debug',
    destination: { write: (line: string) => renderedLogLines.push(line) },
  });
  const tee =
    (level: 'info' | 'warn' | 'error') =>
    (...args: unknown[]) => {
      (loggerCalls[level] as jest.Mock)(...args);
      (rendering as Record<string, (...a: unknown[]) => void>)[level](...args);
    };
  const logger: Record<string, unknown> = { info: tee('info'), warn: tee('warn'), error: tee('error') };
  logger.child = () => logger;
  return { apiLogger: logger };
});

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
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { ABANDONED_CUSTODY_UNKNOWN_MESSAGE, ABANDONED_RUN_MESSAGE } from '@/lib/library/reverify-messages';
import {
  createReverificationGeneration,
  finaliseRecoveryGeneration,
  findAbandonedPendingCheckRuns,
  reserveRecoveryGeneration,
  settleAbandonedCheckRun,
  RecoveryLockDiscoveryExhaustedError,
  type CreateReverificationGenerationInput,
  type FinaliseRecoveryGenerationInput,
  type FinaliseRecoveryGenerationResult,
} from './check-run.repository';

const RECORD_ID = 'record-1';
const TENANT_ID = 'tenant-1';
/** A supplier key, for the rendered-line assertions. No log line here may ever carry one. */
const KEY_SENTINEL = 'KEY-SENTINEL-3d91fa';
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

/**
 * Custody's key-presence half is projected by its own statement, so the key
 * envelope never enters a row object these transactions hold. Every raw-SQL
 * mock in this suite has to answer that statement as well as the locks, and
 * the assertions that count lock statements have to exclude it.
 */
function isKeyPresenceQuery(sql: string): boolean {
  return sql.includes('"decryptionKey" IS NOT NULL');
}
function isLibraryRecordLock(sql: string): boolean {
  return sql.includes('"LibraryRecord"') && !isKeyPresenceQuery(sql);
}
let keyPresence: { credential: boolean; external: boolean };

function row(overrides: Record<string, unknown> = {}) {
  const { externalCredential: externalOverride, ...recordOverrides } = overrides;
  const externalCredential =
    externalOverride === null
      ? null
      : {
          storageUri: 'https://storage.example/old',
          storageDigestMultibase: 'zOldDigest',
          storageExternalId: 'old-object',
          sourceDigest: 'zOldSourceDigest',
          contentDigest: null,
          duplicateOfRecordId: null,
          encrypted: false,
          contentKind: null,
          ...(externalOverride as Record<string, unknown> | undefined),
        };
  return {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.EXTERNAL,
    credential: null,
    externalCredential,
    checkRuns: [{ id: 'run-1', generation: 1, state: CheckRunState.COMPLETE, lastEnqueuedAt: null }],
    ...recordOverrides,
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
      decryptionKeyPresent: false,
      encrypted: false,
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
  renderedLogLines.length = 0;
  mockTransaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) =>
    callback(transactionClient),
  );
  keyPresence = { credential: false, external: false };
  TX_LOCK.mockImplementation(async (sql: string) => (isKeyPresenceQuery(sql) ? [keyPresence] : [{ id: RECORD_ID }]));
  TX_FIND.mockResolvedValue(row());
  TX_CREATE.mockResolvedValue({ id: 'run-2', generation: 2 });
  transactionClient.checkRun.updateMany.mockResolvedValue({ count: 1 });
  mockGetLibraryRecordById.mockResolvedValue({});
  (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(null);
  // The race resolver's own reads: a narrow origin select and the shared
  // key-presence projection, both on the global client.
  (prisma.libraryRecord.findFirst as unknown as jest.Mock).mockResolvedValue({
    origin: LibraryRecordOrigin.EXTERNAL,
  });
  // Two statements share the global client's raw query: the sweep's custody
  // projection and the race resolver's key-presence projection. The default
  // answers both as "no key held"; the sweep's own tests override it.
  (prisma.$queryRawUnsafe as unknown as jest.Mock).mockImplementation(async (sql: string) =>
    isKeyPresenceQuery(sql) ? [{ credential: false, external: false }] : [],
  );
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
            storageServiceInstanceId: true,
            storageExternalId: true,
            storageBucket: true,
            sourceDigest: true,
            contentDigest: true,
            duplicateOfRecordId: true,
            encrypted: true,
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
        credential: {
          storageUri: 'https://storage.example/native',
          digestMultibase: 'zNative',
          decryptionKey: null,
        },
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
          decryptionKeyPresent: false,
          encrypted: null,
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
    TX_LOCK.mockImplementation(async (sql: string) => (isKeyPresenceQuery(sql) ? [keyPresence] : []));

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
    (prisma.libraryRecord.findFirst as unknown as jest.Mock).mockResolvedValue(null);

    await expect(createReverificationGeneration(input())).resolves.toEqual({ outcome: 'missing' });
    expect(prisma.libraryRecord.findFirst).toHaveBeenCalledWith({
      where: { id: RECORD_ID, tenantId: TENANT_ID },
      select: { origin: true },
    });
  });
});

describe('finaliseRecoveryGeneration', () => {
  function finaliseInput(overrides: Partial<FinaliseRecoveryGenerationInput> = {}): FinaliseRecoveryGenerationInput {
    return {
      recordId: RECORD_ID,
      tenantId: TENANT_ID,
      checkRunId: 'run-2',
      generation: 2,
      expectedCustody: {
        storageUri: null,
        storageDigestMultibase: null,
        storageExternalId: null,
        decryptionKeyPresent: false,
        encrypted: false,
      },
      prepared: {
        acquisition: { mode: 'source-failed' },
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
      where: {
        id: 'run-2',
        recordId: RECORD_ID,
        generation: 2,
        tenantId: TENANT_ID,
        state: CheckRunState.PENDING,
        lastEnqueuedAt: null,
      },
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
      if (isKeyPresenceQuery(sql)) return [keyPresence];
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
      acquisition: { mode: 'source', sourceDigest: 'zObservedSourceDigest' },
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
    const libraryRecordLockCalls = TX_LOCK.mock.calls.filter(([sql]) => isLibraryRecordLock(sql as string));
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
      acquisition: { mode: 'source-failed' },
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
      where: {
        id: 'run-2',
        recordId: RECORD_ID,
        generation: 2,
        tenantId: TENANT_ID,
        state: CheckRunState.PENDING,
        lastEnqueuedAt: null,
      },
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
      acquisition: { mode: 'source', sourceDigest: 'zFetchedSourceDigest' },
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
      where: {
        id: 'run-2',
        recordId: RECORD_ID,
        generation: 2,
        tenantId: TENANT_ID,
        state: CheckRunState.PENDING,
        lastEnqueuedAt: null,
      },
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

  it('settles a corrupt envelope on an identity-holding row with its own DECRYPTION_FAILED, not the rejected-replacement default', async () => {
    // Mode A on a row that already holds a content identity: the re-fetched
    // source returned an AES envelope the supplied key could not open,
    // because the envelope itself is corrupt. `settleUnopened`'s identity-held
    // arm skipped the store and prepared DECRYPTION_FAILED with
    // `retryable: false`, and it classified the body it did reach as OPAQUE,
    // so this arrives at the rejected-replacement branch with a FAILED
    // prepared run and an identity still held under this lock.
    //
    // That branch takes the prepared failure in preference to
    // `rejectedReplacementFailure`, which maps `encrypted === true` to
    // DECRYPTION_REQUIRED with `retryable: true`. Both halves are
    // caller-visible, and the retryable flag is the one an integrator's retry
    // loop turns on: no key opens a corrupt envelope, so advertising the
    // attempt as retryable sends that loop round forever. Fails if the
    // preference is dropped and `rejectedReplacementFailure(prepared)` alone
    // decides the failure again.
    TX_FIND.mockResolvedValue(identityHoldingRow());
    const prepared = {
      acquisition: { mode: 'source', sourceDigest: 'zFetchedSourceDigest' },
      encrypted: true,
      contentKind: ExternalContentKind.OPAQUE,
      decryptionKeyUnused: false,
      storageSkipped: 'identity-held',
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.FAILED,
        checks: { retrieval: CheckResult.PASS, decryption: CheckResult.FAIL },
        failure: {
          code: CheckRunFailureCode.DECRYPTION_FAILED,
          message:
            'The fetched encrypted envelope is corrupted and cannot be decrypted; re-supplying the key will not help unless the source changes.',
          retryable: false,
        },
      },
    } as RecoverInRequestOutcome;

    const result = await finaliseRecoveryGeneration(finaliseInput({ prepared }));

    expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
    expect(transactionClient.checkRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-2',
        recordId: RECORD_ID,
        generation: 2,
        tenantId: TENANT_ID,
        state: CheckRunState.PENDING,
        lastEnqueuedAt: null,
      },
      data: expect.objectContaining({
        state: CheckRunState.FAILED,
        failureCode: CheckRunFailureCode.DECRYPTION_FAILED,
        failureMessage:
          'The fetched encrypted envelope is corrupted and cannot be decrypted; re-supplying the key will not help unless the source changes.',
        failureRetryable: false,
      }),
    });
    // The branch's whole contract: the record keeps the identity, custody and
    // details it already had.
    expect(transactionClient.externalCredential.update).not.toHaveBeenCalled();
    expect(transactionClient.libraryRecord.update).not.toHaveBeenCalled();
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
      if (isKeyPresenceQuery(sql)) return [keyPresence];
      if (sql.includes('"LibraryRecord"')) return [{ id: RECORD_ID }];
      if (sql.includes('"CheckRun"')) return []; // the claim itself finds nothing
      return [];
    });
    const prepared = {
      encrypted: false,
      contentKind: ExternalContentKind.OPAQUE,
      decryptionKeyUnused: false,
      acquisition: { mode: 'source', sourceDigest: 'zFetchedSourceDigest' },
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

  it('reports superseded and writes nothing when custody moved under the reservation, orphan-logging the prepared copy', async () => {
    // The other half of the same fence. The atomic claim above answers
    // "is this exact reservation still mine?"; this comparison answers "is
    // the record still the one I reserved against?". A lock-discovery
    // restart and a deadlock retry both re-enter this transaction with the
    // run still `PENDING` and unqueued, so the claim succeeds and only the
    // custody comparison can catch a copy another writer replaced in the
    // meantime. Fails if the comparison is dropped from the fence: this
    // attempt would then settle the run and write its own copy over the one
    // that writer committed.
    const replaced = row({
      externalCredential: {
        storageUri: 'https://storage.example/replaced',
        storageDigestMultibase: 'zReplacedDigest',
        storageExternalId: 'replaced-object',
      },
      checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
    });
    TX_FIND.mockResolvedValue(replaced);
    const prepared = {
      encrypted: false,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      acquisition: { mode: 'source', sourceDigest: 'zFetchedSourceDigest' },
      contentDigest: 'zOpenedContentDigest',
      storage: { uri: 'https://storage.example/late-copy', externalId: 'late-1', bucket: 'private' },
      details: { status: CredentialDetailsStatus.EXTRACTED },
      checkRun: { state: CheckRunState.PENDING, checks: { retrieval: CheckResult.PASS } },
    } as unknown as RecoverInRequestOutcome;

    // The reservation observed a no-copy record; the row above now holds one.
    const enqueue = jest.fn(async () => undefined);
    const result = await finaliseRecoveryGeneration(finaliseInput({ prepared, enqueue }));

    expect(result).toEqual({ outcome: 'superseded', generation: 2 });
    expect(transactionClient.externalCredential.update).not.toHaveBeenCalled();
    expect(transactionClient.libraryRecord.update).not.toHaveBeenCalled();
    expect(transactionClient.checkRun.updateMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: RECORD_ID,
        tenantId: TENANT_ID,
        reason: 'superseded',
        storageUri: 'https://storage.example/late-copy',
        storageExternalId: 'late-1',
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
      isKeyPresenceQuery(sql)
        ? [keyPresence]
        : isLibraryRecordLock(sql)
          ? [{ id: RECORD_ID }, { id: 'advisory-1' }]
          : [{ id: 'run-2' }],
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
      acquisition: { mode: 'source', sourceDigest: 'zNewSourceDigest' },
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
      if (isKeyPresenceQuery(sql)) return [keyPresence];
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
      acquisition: { mode: 'source', sourceDigest: 'zObservedSourceDigest' },
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
      if (isKeyPresenceQuery(sql)) return [keyPresence];
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
      acquisition: { mode: 'source', sourceDigest: 'zObservedSourceDigest' },
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
      if (isKeyPresenceQuery(sql)) return [keyPresence];
      if (sql.includes('"LibraryRecord"')) {
        const ids = (Array.isArray(args[0]) ? args[0] : [args[0]]) as string[];
        return ids.filter((id) => id === RECORD_ID).map((id) => ({ id }));
      }
      if (sql.includes('"CheckRun"')) return [{ id: 'run-2' }];
      return [];
    });

    const prepared = {
      acquisition: { mode: 'source', sourceDigest: 'zObservedSourceDigest' },
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
      if (isKeyPresenceQuery(sql)) return [keyPresence];
      if (sql.includes('"LibraryRecord"')) {
        const ids = (Array.isArray(args[0]) ? args[0] : [args[0]]) as string[];
        return ids.filter((id) => confirmedParents.has(id)).map((id) => ({ id }));
      }
      if (sql.includes('"CheckRun"')) return [{ id: 'run-2' }];
      return [];
    });
    transactionClient.externalCredential.update.mockResolvedValue({});

    const prepared = {
      acquisition: { mode: 'source', sourceDigest: 'zObservedSourceDigest' },
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
      acquisition: { mode: 'source', sourceDigest: 'zFetchedSourceDigest' },
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
      if (isKeyPresenceQuery(sql)) return [keyPresence];
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
      acquisition: { mode: 'source', sourceDigest: 'zObservedSourceDigest' },
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

  describe('the reconcileIdentity gate', () => {
    // The gate changed from "a body was observed" to "an opened credential
    // was observed". Both directions are pinned, because the change is
    // behaviour-preserving only for the states reachable today and nothing
    // else records which way it should go.
    const openedNonCredential = {
      acquisition: { mode: 'source' as const, sourceDigest: 'zObservedSourceDigest' },
      encrypted: false,
      contentKind: ExternalContentKind.JSON_OBJECT,
      decryptionKeyUnused: false,
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
    } as RecoverInRequestOutcome;

    it('does not reconcile identity for an observed body that is not a credential', () => {
      // A non-credential body has no identity to reconcile. Reconciling it
      // would relinquish the row's digest to a body that carries none.
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

      return finaliseRecoveryGeneration(finaliseInput({ prepared: openedNonCredential })).then(() => {
        // `updateMany` on the external child is reconciliation's own
        // relinquish write; nothing else in this branch uses it.
        expect(transactionClient.externalCredential.updateMany).not.toHaveBeenCalled();
      });
    });

    it('does reconcile identity for an observed credential', async () => {
      // The other way round, so the gate cannot be inverted without a
      // failure. This row holds a digest the opened credential replaces, so
      // reconciliation must relinquish it.
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
      transactionClient.externalCredential.updateMany.mockResolvedValue({ count: 1 });
      transactionClient.externalCredential.findFirst.mockResolvedValue(null);

      await finaliseRecoveryGeneration(
        finaliseInput({
          prepared: {
            ...openedNonCredential,
            contentKind: ExternalContentKind.CREDENTIAL,
            contentDigest: 'zNewContentDigest',
          } as RecoverInRequestOutcome,
        }),
      );

      expect(transactionClient.externalCredential.updateMany).toHaveBeenCalled();
    });
  });

  /**
   * The stored-copy acquisition modes. Every fixture here states
   * `acquisition: { mode: 'stored-copy' }`, which is what mode B produces,
   * and an `expectedCustody` that carries the raw copy's coordinates, which
   * is what its reservation returned.
   */
  describe('a stored-copy acquisition', () => {
    const RAW_CUSTODY = {
      storageUri: 'https://storage.example/raw',
      storageDigestMultibase: 'zRawDigest',
      storageExternalId: 'raw-1',
      decryptionKeyPresent: false,
      encrypted: true,
    };

    /**
     * `retiredStorage` lives on the `created` arm alone, so reading it needs
     * the narrowing the type asks for. Each caller pins the outcome too, so
     * an absence here can never be an absence caused by the wrong arm.
     */
    function retiredStorageOf(result: FinaliseRecoveryGenerationResult) {
      return result.outcome === 'created' ? result.retiredStorage : undefined;
    }

    function rawRow(overrides: Record<string, unknown> = {}) {
      return row({
        externalCredential: {
          storageUri: RAW_CUSTODY.storageUri,
          storageDigestMultibase: RAW_CUSTODY.storageDigestMultibase,
          storageServiceInstanceId: 'si-1',
          storageExternalId: RAW_CUSTODY.storageExternalId,
          storageBucket: 'private',
          sourceDigest: 'zOldSourceDigest',
          contentDigest: null,
          duplicateOfRecordId: null,
          encrypted: true,
          ...overrides,
        },
        checkRuns: [{ id: 'run-2', generation: 2, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      });
    }

    it('settles a wrong key with its own code and checks, writing no content, freshness or custody column', async () => {
      // Without the terminal branch this outcome reaches
      // `rejectedReplacementFailure`, which maps `encrypted === true` to
      // DECRYPTION_REQUIRED and would rewrite a wrong key as a missing one.
      // Fails if the branch is removed, or if it stops writing the attempt's
      // own failure and checks.
      TX_FIND.mockResolvedValue(rawRow({ contentDigest: 'zHeldContentDigest' }));
      const prepared = {
        acquisition: { mode: 'stored-copy' },
        encrypted: true,
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: {
          state: CheckRunState.FAILED,
          checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS, decryption: CheckResult.FAIL },
          failure: {
            code: CheckRunFailureCode.DECRYPTION_FAILED,
            message: 'the supplied key did not open it',
            retryable: true,
          },
        },
      } as RecoverInRequestOutcome;

      const result = await finaliseRecoveryGeneration(finaliseInput({ prepared, expectedCustody: RAW_CUSTODY }));

      expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
      expect(transactionClient.checkRun.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'run-2', recordId: RECORD_ID, generation: 2, tenantId: TENANT_ID }),
        data: expect.objectContaining({
          state: CheckRunState.FAILED,
          retrieval: CheckResult.PASS,
          digest: CheckResult.PASS,
          decryption: CheckResult.FAIL,
          failureCode: CheckRunFailureCode.DECRYPTION_FAILED,
          failureRetryable: true,
          sourceChanged: null,
          lastSourceCheckAt: null,
        }),
      });
      // No custody, identity or descriptive write of any kind.
      expect(transactionClient.externalCredential.update).not.toHaveBeenCalled();
      expect(transactionClient.externalCredential.updateMany).not.toHaveBeenCalled();
      expect(transactionClient.libraryRecord.update).not.toHaveBeenCalled();
    });

    it('settles a failed stored read the same way, with every check not run', async () => {
      // The unobserved arm of the same branch: nothing arrived at all, so
      // the generation states that and touches nothing else.
      TX_FIND.mockResolvedValue(rawRow());
      const prepared = {
        acquisition: { mode: 'stored-copy' },
        encrypted: null,
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: {
          state: CheckRunState.FAILED,
          checks: {},
          failure: {
            code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
            message: 'the copy could not be read back',
            retryable: true,
          },
        },
      } as RecoverInRequestOutcome;

      await finaliseRecoveryGeneration(finaliseInput({ prepared, expectedCustody: RAW_CUSTODY }));

      expect(transactionClient.checkRun.updateMany).toHaveBeenCalledWith({
        where: expect.anything(),
        data: expect.objectContaining({
          state: CheckRunState.FAILED,
          retrieval: CheckResult.NOT_RUN,
          digest: CheckResult.NOT_RUN,
          decryption: CheckResult.NOT_RUN,
          failureCode: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        }),
      });
      expect(transactionClient.externalCredential.update).not.toHaveBeenCalled();
    });

    it('takes the same terminal path from the identity-held sub-branch', async () => {
      // The store was skipped in-request because the reservation held an
      // identity, and that identity has since been cleared. A source-mode
      // outcome settles the moved-identity failure there; a stored-copy one
      // must still settle its own, because no source was ever read. Fails if
      // the sub-branch is dropped and a wrong key is reported as an identity
      // race with a freshness stamp.
      TX_FIND.mockResolvedValue(rawRow());
      const prepared = {
        acquisition: { mode: 'stored-copy' },
        encrypted: true,
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        storageSkipped: 'identity-held',
        checkRun: {
          state: CheckRunState.FAILED,
          checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS, decryption: CheckResult.FAIL },
          failure: {
            code: CheckRunFailureCode.DECRYPTION_FAILED,
            message: 'the supplied key did not open it',
            retryable: true,
          },
        },
      } as RecoverInRequestOutcome;

      await finaliseRecoveryGeneration(finaliseInput({ prepared, expectedCustody: RAW_CUSTODY }));

      expect(transactionClient.checkRun.updateMany).toHaveBeenCalledWith({
        where: expect.anything(),
        data: expect.objectContaining({
          failureCode: CheckRunFailureCode.DECRYPTION_FAILED,
          sourceChanged: null,
          lastSourceCheckAt: null,
        }),
      });
    });

    it('writes content but no source provenance when the copy opens, splitting the two observations', async () => {
      // The split is important here. `contentObserved` is true (a body was classified) while
      // `sourceObserved` is false (no supplier was read), so identity,
      // `encrypted` and `contentKind` are written and `sourceDigest`,
      // `sourceChanged` and `lastSourceCheckAt` are not. Collapsing the two
      // back together breaks one half or the other.
      TX_FIND.mockResolvedValue(rawRow());
      // No other record in the tenant holds this digest, so the row acquires
      // it canonically and the write under test is the whole identity write.
      TX_LOCK.mockImplementation(async (sql: string) => {
        if (isKeyPresenceQuery(sql)) return [keyPresence];
        if (isLibraryRecordLock(sql)) return [{ id: RECORD_ID }];
        if (sql.includes('"CheckRun"')) return [{ id: 'run-2' }];
        return [];
      });
      const prepared = {
        acquisition: { mode: 'stored-copy' },
        encrypted: true,
        contentKind: ExternalContentKind.CREDENTIAL,
        decryptionKeyUnused: false,
        contentDigest: 'zOpenedDigest',
        storage: {
          uri: 'https://storage.example/new',
          digestMultibase: 'zNewDigest',
          serviceInstanceId: 'si-1',
          externalId: 'new-1',
          bucket: 'private',
        },
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
      } as RecoverInRequestOutcome;

      await finaliseRecoveryGeneration(finaliseInput({ prepared, expectedCustody: RAW_CUSTODY }));

      const externalWrite = transactionClient.externalCredential.update.mock.calls.at(-1)?.[0] as {
        data: Record<string, unknown>;
      };
      expect(externalWrite.data).toMatchObject({
        encrypted: true,
        contentKind: ExternalContentKind.CREDENTIAL,
        contentDigest: 'zOpenedDigest',
      });
      expect(externalWrite.data).not.toHaveProperty('sourceDigest');
      expect(transactionClient.checkRun.updateMany).toHaveBeenCalledWith({
        where: expect.anything(),
        data: expect.objectContaining({ sourceChanged: null, lastSourceCheckAt: null }),
      });
    });

    it('persists a sticky decryptionKeyUnused and never writes it back to false', async () => {
      // The flag says a key was once supplied and not needed. Fails if the
      // finaliser starts writing the flag unconditionally, which would clear
      // it on every later generation that did not carry one.
      TX_FIND.mockResolvedValue(rawRow());
      const base = {
        acquisition: { mode: 'stored-copy' },
        encrypted: false,
        contentKind: ExternalContentKind.CREDENTIAL,
        contentDigest: 'zOpenedDigest',
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
      };

      await finaliseRecoveryGeneration(
        finaliseInput({
          prepared: { ...base, decryptionKeyUnused: true } as RecoverInRequestOutcome,
          expectedCustody: RAW_CUSTODY,
        }),
      );
      expect(
        (transactionClient.externalCredential.update.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data,
      ).toMatchObject({ decryptionKeyUnused: true });

      transactionClient.externalCredential.update.mockClear();
      await finaliseRecoveryGeneration(
        finaliseInput({
          prepared: { ...base, decryptionKeyUnused: false } as RecoverInRequestOutcome,
          expectedCustody: RAW_CUSTODY,
        }),
      );
      expect(
        (transactionClient.externalCredential.update.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data,
      ).not.toHaveProperty('decryptionKeyUnused');
    });

    /**
     * The sticky flag survives the two branches that settle a failure and
     * deliberately change nothing else about the record. Both returned before
     * the finalisation's external-row write, so the fact that this caller
     * supplied a key nothing needed was simply discarded and the record
     * projection never warned about it. The flag has to outlive the attempt
     * that earned it: a later keyed opening does not make the earlier
     * unnecessary key any less true.
     *
     * Each case asserts the write is that one column and nothing else,
     * because these branches exist precisely to leave custody, identity and
     * details alone. `credential-record-projection.test.ts` covers what the
     * column then projects as.
     */
    it('writes the sticky decryptionKeyUnused, and only it, from the rejected-replacement branch', async () => {
      TX_FIND.mockResolvedValue(rawRow({ contentDigest: 'zHeldContentDigest' }));
      const prepared = {
        acquisition: { mode: 'stored-copy' },
        encrypted: false,
        contentKind: ExternalContentKind.JSON_OBJECT,
        decryptionKeyUnused: true,
        details: { status: CredentialDetailsStatus.EXTRACTION_FAILED },
        checkRun: {
          state: CheckRunState.FAILED,
          checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS },
          failure: { code: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL, message: 'not a credential', retryable: true },
        },
      } as RecoverInRequestOutcome;

      const result = await finaliseRecoveryGeneration(finaliseInput({ prepared, expectedCustody: RAW_CUSTODY }));

      expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
      expect(transactionClient.externalCredential.update).toHaveBeenCalledTimes(1);
      expect(transactionClient.externalCredential.update).toHaveBeenCalledWith({
        where: {
          id_tenantId_origin: { id: RECORD_ID, tenantId: TENANT_ID, origin: LibraryRecordOrigin.EXTERNAL },
        },
        data: { decryptionKeyUnused: true },
      });
      // Custody, identity and details are the branch's whole contract.
      expect(transactionClient.libraryRecord.update).not.toHaveBeenCalled();
      expect(transactionClient.checkRun.updateMany).toHaveBeenCalledWith({
        where: expect.anything(),
        data: expect.objectContaining({
          state: CheckRunState.FAILED,
          failureCode: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL,
        }),
      });
    });

    it('writes the sticky decryptionKeyUnused, and only it, from the identity-cleared branch', async () => {
      // The store was skipped in-request for an identity the row no longer
      // holds, so this settles its own moved-identity failure. The unused key
      // is still a fact about this attempt.
      TX_FIND.mockResolvedValue(rawRow({ contentDigest: null, duplicateOfRecordId: null }));
      const prepared = {
        acquisition: { mode: 'source', sourceDigest: 'zFetchedSourceDigest' },
        encrypted: true,
        contentKind: ExternalContentKind.OPAQUE,
        decryptionKeyUnused: true,
        storageSkipped: 'identity-held',
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: {
          state: CheckRunState.FAILED,
          checks: { retrieval: CheckResult.PASS },
          failure: {
            code: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL,
            message: 'irrelevant: never consumed',
            retryable: true,
          },
        },
      } as RecoverInRequestOutcome;

      const result = await finaliseRecoveryGeneration(finaliseInput({ prepared, expectedCustody: RAW_CUSTODY }));

      expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
      expect(transactionClient.externalCredential.update).toHaveBeenCalledTimes(1);
      expect(transactionClient.externalCredential.update).toHaveBeenCalledWith({
        where: {
          id_tenantId_origin: { id: RECORD_ID, tenantId: TENANT_ID, origin: LibraryRecordOrigin.EXTERNAL },
        },
        data: { decryptionKeyUnused: true },
      });
      expect(transactionClient.libraryRecord.update).not.toHaveBeenCalled();
      expect(transactionClient.checkRun.updateMany).toHaveBeenCalledWith({
        where: expect.anything(),
        data: expect.objectContaining({
          state: CheckRunState.FAILED,
          failureCode: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
        }),
      });
    });

    it('keeps the stored-copy sub-branch on its own failure code while still writing the sticky flag', async () => {
      // Mode B opened the record's own durable copy to something that is not
      // a credential, with a key that turned out not to be needed, and the
      // identity the in-request skip was protecting was cleared before this
      // lock was taken. The sibling arm settles a moved-identity failure
      // whose message names a source being fetched; this attempt read no
      // source at all, so it keeps the failure its own acquisition decided
      // and stamps no freshness pair. The unused key is a fact about the
      // attempt either way, so the same one-column write still happens.
      TX_FIND.mockResolvedValue(rawRow({ contentDigest: null, duplicateOfRecordId: null }));
      const prepared = {
        acquisition: { mode: 'stored-copy' },
        encrypted: true,
        contentKind: ExternalContentKind.JSON_OBJECT,
        decryptionKeyUnused: true,
        storageSkipped: 'identity-held',
        details: { status: CredentialDetailsStatus.EXTRACTION_FAILED },
        checkRun: {
          state: CheckRunState.FAILED,
          checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS, decryption: CheckResult.PASS },
          failure: {
            code: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL,
            message:
              "The record's durable copy opened to something that is not the credential this record already holds. No source was read; the copy is unchanged.",
            retryable: true,
          },
        },
      } as RecoverInRequestOutcome;

      const result = await finaliseRecoveryGeneration(finaliseInput({ prepared, expectedCustody: RAW_CUSTODY }));

      expect(result).toEqual({ outcome: 'created', generation: 2, checkRunId: 'run-2' });
      expect(transactionClient.externalCredential.update).toHaveBeenCalledTimes(1);
      expect(transactionClient.externalCredential.update).toHaveBeenCalledWith({
        where: {
          id_tenantId_origin: { id: RECORD_ID, tenantId: TENANT_ID, origin: LibraryRecordOrigin.EXTERNAL },
        },
        data: { decryptionKeyUnused: true },
      });
      expect(transactionClient.libraryRecord.update).not.toHaveBeenCalled();
      expect(transactionClient.checkRun.updateMany).toHaveBeenCalledWith({
        where: expect.anything(),
        data: expect.objectContaining({
          state: CheckRunState.FAILED,
          failureCode: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL,
          failureRetryable: true,
          sourceChanged: null,
          lastSourceCheckAt: null,
        }),
      });
    });

    it('reports the retired copy only from the branch that actually replaced custody', async () => {
      // The rejected-replacement branch also reaches a 'created' outcome with
      // a prepared copy, and there the record KEEPS its raw copy. The caller
      // DELETES whatever this reports, so naming a live copy here destroys
      // the record's only copy.
      TX_FIND.mockResolvedValue(rawRow());
      const replacing = {
        acquisition: { mode: 'stored-copy' },
        encrypted: false,
        contentKind: ExternalContentKind.CREDENTIAL,
        decryptionKeyUnused: false,
        contentDigest: 'zOpenedDigest',
        storage: {
          uri: 'https://storage.example/new',
          digestMultibase: 'zNewDigest',
          serviceInstanceId: 'si-1',
          externalId: 'new-1',
          bucket: 'private',
        },
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
      } as RecoverInRequestOutcome;

      const replaced = await finaliseRecoveryGeneration(
        finaliseInput({ prepared: replacing, expectedCustody: RAW_CUSTODY }),
      );

      // Every coordinate the removal needs, read from the row this
      // transaction locked: the reservation's own snapshot carries neither
      // the bucket nor the service instance.
      expect(replaced.outcome).toBe('created');
      expect(retiredStorageOf(replaced)).toEqual({
        storageUri: RAW_CUSTODY.storageUri,
        storageServiceInstanceId: 'si-1',
        storageExternalId: RAW_CUSTODY.storageExternalId,
        storageBucket: 'private',
      });

      // Now the rejected-replacement branch: a non-credential body on an
      // identity-holding row, which stores a copy and then does not attach it.
      (loggerCalls.info as jest.Mock).mockClear();
      TX_FIND.mockResolvedValue(rawRow({ contentDigest: 'zHeldContentDigest' }));
      const rejected = {
        acquisition: { mode: 'stored-copy' },
        encrypted: false,
        contentKind: ExternalContentKind.JSON_OBJECT,
        decryptionKeyUnused: false,
        storage: {
          uri: 'https://storage.example/rejected',
          digestMultibase: 'zRejectedDigest',
          serviceInstanceId: 'si-1',
          externalId: 'rejected-1',
          bucket: 'private',
        },
        details: { status: CredentialDetailsStatus.EXTRACTION_FAILED },
        checkRun: {
          state: CheckRunState.FAILED,
          checks: { retrieval: CheckResult.PASS },
          failure: { code: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL, message: 'not a credential', retryable: true },
        },
      } as RecoverInRequestOutcome;

      const kept = await finaliseRecoveryGeneration(
        finaliseInput({ prepared: rejected, expectedCustody: RAW_CUSTODY }),
      );

      // The outcome is pinned as well as the absence: `undefined` is also
      // what a superseded finalisation reports, and this branch has to reach
      // 'created' for the absence to mean what the case says.
      expect(kept.outcome).toBe('created');
      expect(retiredStorageOf(kept)).toBeUndefined();
      expect(loggerCalls.error).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'rejected-replacement', storageUri: 'https://storage.example/rejected' }),
        'Prepared recovery copy is orphaned and needs operator cleanup',
      );
    });

    it('retires nothing when the replacement names the object it displaced', async () => {
      // The caller DELETES what this reports, so a replacement that landed on
      // the same object id and bucket must retire nothing: reporting it would
      // delete the copy the row now points at. The UNCEFACT adapter mints a
      // fresh object id per store, so this guards the contract rather than an
      // observed case. Fails if the identity comparison is dropped.
      TX_FIND.mockResolvedValue(rawRow());
      const sameObject = {
        acquisition: { mode: 'stored-copy' },
        encrypted: false,
        contentKind: ExternalContentKind.CREDENTIAL,
        decryptionKeyUnused: false,
        contentDigest: 'zOpenedDigest',
        storage: {
          uri: 'https://storage.example/raw-rewritten',
          digestMultibase: 'zNewDigest',
          serviceInstanceId: 'si-1',
          externalId: RAW_CUSTODY.storageExternalId,
          bucket: 'private',
        },
        details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
        checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
      } as RecoverInRequestOutcome;

      const result = await finaliseRecoveryGeneration(
        finaliseInput({ prepared: sameObject, expectedCustody: RAW_CUSTODY }),
      );

      // The replacement itself still happened; only the retirement is withheld.
      expect(result.outcome).toBe('created');
      expect(retiredStorageOf(result)).toBeUndefined();
    });

    it('does not render the raw cause chain on the finalisation race line either', async () => {
      // This is a second site. Reached after the acquisition has already run with
      // the supplier's key in scope, so the same rule applies here as on the
      // reservation's own race line. Fails if `err: error` returns.
      const chained = Object.assign(new Error('pending index'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        clientVersion: '6.19.2',
        meta: { target: 'CheckRun_recordId_generation_key' },
        cause: new Error(`the finalisation held ${KEY_SENTINEL}`),
      });
      mockTransaction.mockRejectedValue(chained);
      (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
        abandonedRun({ state: CheckRunState.COMPLETE, generation: 4 }),
      );

      await finaliseRecoveryGeneration(finaliseInput({ expectedCustody: RAW_CUSTODY }));

      const rendered = renderedLogLines.join('');
      expect(rendered).toContain('Recovery finalisation insert lost a unique race');
      expect(rendered).not.toContain(KEY_SENTINEL);
    });

    it('proves the rendered capture would show a sentinel if a line carried one', () => {
      // Without this, both assertions above would also pass against a capture
      // that rendered nothing at all.
      const { createLogger } = jest.requireActual('@uncefact/untp-ri-services/logging') as {
        createLogger: (config: Record<string, unknown>) => { warn: (...a: unknown[]) => void };
      };
      createLogger({
        level: 'debug',
        destination: { write: (line: string) => renderedLogLines.push(line) },
      }).warn({ leakCheck: KEY_SENTINEL }, 'deliberate sentinel write');

      expect(renderedLogLines.join('')).toContain(KEY_SENTINEL);
    });

    it('does not report a retired copy from a deadlock-retried attempt whose retry replaced nothing', async () => {
      // `withDeadlockRetry` re-runs the whole transaction callback
      // once, and the previous attempt's writes roll back with it. The first
      // attempt here finds no content identity, replaces custody and sets the
      // retirement; a concurrent writer then gives the row an identity, so
      // the retry takes the rejected-replacement branch, keeps the record's
      // LIVE copy and still returns 'created'. Without resetting the
      // retirement inside the callback, the result names that live copy, and
      // the caller deletes what the result names.
      //
      // Fails if `retired = undefined` moves back outside the callback.
      const deadlock = Object.assign(new Error('deadlock detected'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2034',
        clientVersion: '6.19.2',
      });
      let attempt = 0;
      mockTransaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) => {
        attempt += 1;
        if (attempt === 1) {
          // No identity yet: the callback runs the replacing branch, sets the
          // retirement, and then the transaction deadlocks and rolls back.
          TX_FIND.mockResolvedValue(rawRow());
          await callback(transactionClient);
          throw deadlock;
        }
        // A concurrent writer gave the row an identity between the attempts.
        TX_FIND.mockResolvedValue(rawRow({ contentDigest: 'zHeldContentDigest' }));
        return callback(transactionClient);
      });
      const nonCredential = {
        acquisition: { mode: 'stored-copy' },
        encrypted: false,
        contentKind: ExternalContentKind.JSON_OBJECT,
        decryptionKeyUnused: false,
        storage: {
          uri: 'https://storage.example/new',
          digestMultibase: 'zNewDigest',
          serviceInstanceId: 'si-1',
          externalId: 'new-1',
          bucket: 'private',
        },
        details: { status: CredentialDetailsStatus.EXTRACTION_FAILED },
        checkRun: {
          state: CheckRunState.FAILED,
          checks: { retrieval: CheckResult.PASS },
          failure: { code: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL, message: 'not a credential', retryable: true },
        },
      } as RecoverInRequestOutcome;

      const retried = await finaliseRecoveryGeneration(
        finaliseInput({ prepared: nonCredential, expectedCustody: RAW_CUSTODY }),
      );

      expect(attempt).toBe(2);
      expect(retried.outcome).toBe('created');
      expect(retiredStorageOf(retried)).toBeUndefined();
    });
  });
});

describe('reserveRecoveryGeneration', () => {
  function reserveInput(overrides: Record<string, unknown> = {}) {
    return {
      recordId: RECORD_ID,
      tenantId: TENANT_ID,
      expectedGeneration: 0,
      expectedCustody: {
        storageUri: null,
        storageDigestMultibase: null,
        storageExternalId: null,
        decryptionKeyPresent: false,
        encrypted: false,
      },
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
      custody: {
        storageUri: null,
        storageDigestMultibase: null,
        storageExternalId: null,
        decryptionKeyPresent: false,
        encrypted: false,
      },
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
      custody: {
        storageUri: null,
        storageDigestMultibase: null,
        storageExternalId: null,
        decryptionKeyPresent: false,
        encrypted: false,
      },
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
          encrypted: true,
        },
        checkRuns: [],
      }),
    );

    await expect(reserveRecoveryGeneration(reserveInput())).resolves.toEqual({ outcome: 'superseded', generation: 0 });
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('returns missing when the tenant-scoped lock finds no parent', async () => {
    // Fails if the reservation can lock a record by id alone and then recover
    // another tenant's row.
    TX_LOCK.mockImplementation(async (sql: string) => (isKeyPresenceQuery(sql) ? [keyPresence] : []));

    await expect(reserveRecoveryGeneration(reserveInput())).resolves.toEqual({ outcome: 'missing' });
    expect(TX_LOCK).toHaveBeenCalledWith(
      'SELECT "id" FROM "LibraryRecord" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE',
      RECORD_ID,
      TENANT_ID,
    );
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

  it('answers conflict, never joined, when a key-bearing request meets a pending generation under the lock', async () => {
    // A joined key-bearing request would be told 202 while its key was
    // dropped on the floor. Fails if the pending branch stops honouring
    // keyBearing, or if the flag stops reaching the locked decision.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: 'https://storage.example/raw',
          storageDigestMultibase: 'zRaw',
          storageExternalId: 'raw-1',
          sourceDigest: null,
          contentDigest: null,
          duplicateOfRecordId: null,
          encrypted: true,
        },
        checkRuns: [{ id: 'run-9', generation: 3, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );

    await expect(reserveRecoveryGeneration(reserveInput({ keyBearing: true }))).resolves.toEqual({
      outcome: 'conflict',
      reason: 'pending',
      generation: 3,
    });
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('answers not-applicable, not conflict, when the copy is protected AND a generation is pending', async () => {
    // The published precedence puts rule 4 (a key against an already
    // protected copy, 400) ahead of rule 5 (a key against a pending
    // generation, 409), and this is the only state where both apply. Fails if
    // the pending test runs first, which answers 409 and sends the caller to
    // wait for a settlement that will not make their key usable.
    keyPresence = { credential: false, external: true };
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: 'https://storage.example/protected',
          storageDigestMultibase: 'zProtected',
          storageExternalId: 'protected-1',
          sourceDigest: null,
          contentDigest: null,
          duplicateOfRecordId: null,
          encrypted: true,
        },
        checkRuns: [{ id: 'run-9', generation: 3, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );

    await expect(reserveRecoveryGeneration(reserveInput({ keyBearing: true }))).resolves.toEqual({
      outcome: 'not-applicable',
    });
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('still joins a bodyless request whose record is protected and pending', async () => {
    // The control: reordering the two key-bearing tests must not change what
    // a bodyless request in the same state is told.
    keyPresence = { credential: false, external: true };
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: 'https://storage.example/protected',
          storageDigestMultibase: 'zProtected',
          storageExternalId: 'protected-1',
          sourceDigest: null,
          contentDigest: null,
          duplicateOfRecordId: null,
          encrypted: true,
        },
        checkRuns: [{ id: 'run-9', generation: 3, state: CheckRunState.PENDING, lastEnqueuedAt: null }],
      }),
    );

    await expect(reserveRecoveryGeneration(reserveInput())).resolves.toEqual({ outcome: 'joined' });
  });

  it('answers not-applicable when the copy became receiver-protected between the read and the lock', async () => {
    // Rule 4 under the lock. Fails if applicability is judged from the
    // caller's pre-lock read, which would let a key be spent on a record this
    // service can already open.
    keyPresence = { credential: false, external: true };
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: 'https://storage.example/protected',
          storageDigestMultibase: 'zProtected',
          storageExternalId: 'protected-1',
          sourceDigest: null,
          contentDigest: null,
          duplicateOfRecordId: null,
          encrypted: true,
        },
        checkRuns: [],
      }),
    );

    await expect(reserveRecoveryGeneration(reserveInput({ keyBearing: true }))).resolves.toEqual({
      outcome: 'not-applicable',
    });
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('reads key presence by projection rather than selecting the key envelope', async () => {
    // The custody fence compares key PRESENCE. Fails if the envelope is put
    // back into the row object this transaction holds, which is how it would
    // reach a log line from here.
    await reserveRecoveryGeneration(reserveInput());

    const presenceCalls = TX_LOCK.mock.calls.filter(([sql]) => isKeyPresenceQuery(sql as string));
    expect(presenceCalls).toHaveLength(1);
    expect(presenceCalls[0][0]).toEqual(expect.stringContaining('IS NOT NULL'));
    expect(presenceCalls[0].slice(1)).toEqual([RECORD_ID, TENANT_ID]);
    const include = (TX_FIND.mock.calls[0][0] as { include: Record<string, { select: Record<string, boolean> }> })
      .include;
    expect(include.credential.select).not.toHaveProperty('decryptionKey');
    expect(include.externalCredential.select).not.toHaveProperty('decryptionKey');
  });

  it('throws the shape error under the lock for a stored copy that is neither encrypted nor keyed', async () => {
    // Re-checked under the lock, before any mode is chosen, an unkeyed
    // plaintext copy can never be handed to the stored-copy path. Fails if
    // the check only runs on the caller's pre-lock read.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: 'https://storage.example/plain',
          storageDigestMultibase: 'zPlain',
          storageExternalId: 'plain-1',
          sourceDigest: null,
          contentDigest: null,
          duplicateOfRecordId: null,
          encrypted: false,
        },
        checkRuns: [],
      }),
    );

    await expect(reserveRecoveryGeneration(reserveInput({ keyBearing: true }))).rejects.toBeInstanceOf(
      LibraryRecordShapeError,
    );
    expect(TX_CREATE).not.toHaveBeenCalled();
  });

  it('reserves the next generation from the locked state when a key-bearing request finds one already advanced', async () => {
    // Owner ruling 2. A generation that completed between the caller's read
    // and this lock must not answer `superseded` for a key-bearing request:
    // that would acknowledge the key without consuming it. Fails if the
    // generation and custody comparison is applied to a key-bearing request.
    TX_FIND.mockResolvedValue(
      row({
        externalCredential: {
          storageUri: 'https://storage.example/raw',
          storageDigestMultibase: 'zRaw',
          storageExternalId: 'raw-1',
          sourceDigest: null,
          contentDigest: null,
          duplicateOfRecordId: null,
          encrypted: true,
        },
        checkRuns: [{ id: 'run-7', generation: 4, state: CheckRunState.COMPLETE, lastEnqueuedAt: null }],
      }),
    );
    TX_CREATE.mockResolvedValue({ id: 'run-8', generation: 5 });

    await expect(reserveRecoveryGeneration(reserveInput({ keyBearing: true, expectedGeneration: 2 }))).resolves.toEqual(
      {
        outcome: 'reserved',
        generation: 5,
        checkRunId: 'run-8',
        identity: { contentDigest: null, duplicateOfRecordId: null },
        custody: {
          storageUri: 'https://storage.example/raw',
          storageDigestMultibase: 'zRaw',
          storageExternalId: 'raw-1',
          decryptionKeyPresent: false,
          encrypted: true,
        },
      },
    );
  });

  describe('the unique-race fallback', () => {
    // The three race cases are covered here. The reservation re-enters its locked decision once
    // on a unique-index loss; a second loss falls through to the resolver,
    // which reads the winner without a lock and must still answer a
    // key-bearing request in terms that never drop its key.
    const unique = Object.assign(new Error('pending index'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      clientVersion: '6.19.2',
    });

    /** Answers the resolver's key-presence projection for this record. */
    function resolverHoldsKey(held: boolean): void {
      (prisma.$queryRawUnsafe as unknown as jest.Mock).mockImplementation(async (sql: string) =>
        isKeyPresenceQuery(sql) ? [{ credential: false, external: held }] : [],
      );
    }

    it('re-enters the locked decision exactly once before falling back to the resolver', async () => {
      // Fails if the re-entry is removed (one transaction), or if it is
      // unbounded (more than two).
      mockTransaction.mockRejectedValue(unique);
      (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
        abandonedRun({ state: CheckRunState.PENDING }),
      );

      await expect(reserveRecoveryGeneration(reserveInput({ keyBearing: true }))).resolves.toEqual({
        outcome: 'conflict',
        reason: 'pending',
        generation: 2,
      });
      expect(mockTransaction).toHaveBeenCalledTimes(2);
    });

    it('answers conflict for a key-bearing loser whose winner is still pending', async () => {
      mockTransaction.mockRejectedValue(unique);
      (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
        abandonedRun({ state: CheckRunState.PENDING }),
      );

      await expect(reserveRecoveryGeneration(reserveInput({ keyBearing: true }))).resolves.toEqual({
        outcome: 'conflict',
        reason: 'pending',
        generation: 2,
      });
    });

    it('answers not-applicable for a key-bearing loser whose winner protected the copy', async () => {
      // 400, not 409: rule 4 says a key is not applicable to this record at
      // all now, so telling the caller to wait and try again would be wrong.
      mockTransaction.mockRejectedValue(unique);
      (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
        abandonedRun({ state: CheckRunState.COMPLETE }),
      );
      resolverHoldsKey(true);

      await expect(reserveRecoveryGeneration(reserveInput({ keyBearing: true }))).resolves.toEqual({
        outcome: 'not-applicable',
      });
    });

    it('answers not-applicable, not conflict, for a key-bearing loser whose winner is pending on a protected copy', async () => {
      // The resolver applies the same precedence as the locked reservation
      // applies: a key that can never be used here is a permanent refusal and
      // outranks a temporary one. Fails if the pending test runs first.
      mockTransaction.mockRejectedValue(unique);
      (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
        abandonedRun({ state: CheckRunState.PENDING }),
      );
      resolverHoldsKey(true);

      await expect(reserveRecoveryGeneration(reserveInput({ keyBearing: true }))).resolves.toEqual({
        outcome: 'not-applicable',
      });
    });

    it('answers conflict, not superseded, for a key-bearing loser whose winner settled and left the record eligible', async () => {
      // `superseded` here is answered 202 with the winner's envelope, which a
      // caller cannot tell apart from their own key having been applied,
      // while the key was in fact never consumed. Fails if this arm reverts.
      //
      // `race-lost` rather than `pending`: nothing is running, so the caller
      // is told their key was not used rather than to wait.
      mockTransaction.mockRejectedValue(unique);
      (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
        abandonedRun({ state: CheckRunState.COMPLETE, generation: 4 }),
      );
      resolverHoldsKey(false);

      await expect(reserveRecoveryGeneration(reserveInput({ keyBearing: true }))).resolves.toEqual({
        outcome: 'conflict',
        reason: 'race-lost',
        generation: 4,
      });
    });

    it('reads key presence by projection in the resolver too, never through the record detail view', async () => {
      // PD6. Every other custody read in this module projects
      // `IS NOT NULL` in SQL so the key envelope never enters a row object it
      // holds, and `REVERIFICATION_ROW_INCLUDE` says so. This path used to
      // load the whole detail view. Fails if it goes back to it.
      mockTransaction.mockRejectedValue(unique);
      (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
        abandonedRun({ state: CheckRunState.COMPLETE, generation: 4 }),
      );
      resolverHoldsKey(false);

      await reserveRecoveryGeneration(reserveInput({ keyBearing: true }));

      expect(mockGetLibraryRecordById).not.toHaveBeenCalled();
      const presenceCalls = (prisma.$queryRawUnsafe as unknown as jest.Mock).mock.calls.filter(([sql]) =>
        isKeyPresenceQuery(sql as string),
      );
      expect(presenceCalls).toHaveLength(1);
      expect(presenceCalls[0].slice(1)).toEqual([RECORD_ID, TENANT_ID]);
      expect((prisma.libraryRecord.findFirst as unknown as jest.Mock).mock.calls[0][0]).toEqual({
        where: { id: RECORD_ID, tenantId: TENANT_ID },
        select: { origin: true },
      });
    });

    it('does not render the raw cause chain on the reservation race line', async () => {
      // This line is on the key-bearing path, and pino expands an `err`
      // binding through its whole cause chain. Fails if `err: error` returns.
      const chained = Object.assign(new Error('pending index'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        clientVersion: '6.19.2',
        cause: new Error(`the write held ${KEY_SENTINEL}`),
      });
      mockTransaction.mockRejectedValue(chained);
      (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
        abandonedRun({ state: CheckRunState.COMPLETE, generation: 4 }),
      );
      resolverHoldsKey(false);

      await reserveRecoveryGeneration(reserveInput({ keyBearing: true }));

      const rendered = renderedLogLines.join('');
      expect(rendered).toContain('Recovery reservation insert lost a unique race');
      expect(rendered).not.toContain(KEY_SENTINEL);
    });

    it('still reports superseded for a bodyless loser whose winner settled', async () => {
      // The bodyless side is unchanged: nothing was consumed, and a 202 with
      // the current envelope is the truthful answer.
      mockTransaction.mockRejectedValue(unique);
      (prisma.checkRun.findFirst as unknown as jest.Mock).mockResolvedValue(
        abandonedRun({ state: CheckRunState.COMPLETE, generation: 4 }),
      );

      await expect(reserveRecoveryGeneration(reserveInput())).resolves.toEqual({
        outcome: 'superseded',
        generation: 4,
      });
    });
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

  describe('resume guidance chosen from the record custody', () => {
    // An abandoned key-bearing recovery leaves a record a plain
    // re-verify cannot take forward, because a bodyless request against an
    // unopened copy is refused DECRYPTION_REQUIRED before any acquisition.
    // Every other record has no key to resend and must get the generic
    // message instead.
    const cutoff = new Date('2026-09-06T23:30:00.000Z');

    function custodyRow(overrides: Record<string, unknown>) {
      return [
        {
          origin: LibraryRecordOrigin.EXTERNAL,
          storageUri: null,
          encrypted: null,
          decryptionKeyPresent: false,
          ...overrides,
        },
      ];
    }

    function settledMessage(): string {
      const updateMany = prisma.checkRun.updateMany as unknown as jest.Mock;
      return (updateMany.mock.calls[0][0] as { data: { failureMessage: string } }).data.failureMessage;
    }

    beforeEach(() => {
      (prisma.checkRun.updateMany as unknown as jest.Mock).mockResolvedValue({ count: 1 });
    });

    it('tells the caller to resend the key when the record still holds an unopened encrypted copy', async () => {
      (prisma.$queryRawUnsafe as unknown as jest.Mock).mockResolvedValue(
        custodyRow({ storageUri: 'https://storage.example/raw', encrypted: true, decryptionKeyPresent: false }),
      );

      await expect(settleAbandonedCheckRun(abandonedRun(), cutoff)).resolves.toEqual({ outcome: 'applied' });

      expect(settledMessage()).toBe(
        'The verification job did not report a result within the expected window. This record still holds an unopened encrypted copy, so resend the key as sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.',
      );
    });

    it('gives an already receiver-protected external copy the generic message', async () => {
      // This service holds the key already, so there is nothing for the
      // caller to resend. Fails if the predicate drops the key-presence half.
      (prisma.$queryRawUnsafe as unknown as jest.Mock).mockResolvedValue(
        custodyRow({ storageUri: 'https://storage.example/protected', encrypted: true, decryptionKeyPresent: true }),
      );

      await settleAbandonedCheckRun(abandonedRun(), cutoff);

      expect(settledMessage()).toBe(
        'The verification job did not report a result within the expected window. Re-verify to run it again.',
      );
    });

    it('gives a native record the generic message', async () => {
      // A native copy was issued here and its key is this service's own.
      // Fails if the origin is dropped from the predicate.
      (prisma.$queryRawUnsafe as unknown as jest.Mock).mockResolvedValue([
        {
          origin: LibraryRecordOrigin.NATIVE,
          storageUri: 'https://storage.example/native',
          encrypted: null,
          decryptionKeyPresent: false,
        },
      ]);

      await settleAbandonedCheckRun(abandonedRun(), cutoff);

      expect(settledMessage()).toBe(
        'The verification job did not report a result within the expected window. Re-verify to run it again.',
      );
    });

    it('gives an external record with no durable copy the generic message', async () => {
      // A no-copy record re-fetches its source on a bodyless re-verify, so
      // that advice is correct as it stands.
      (prisma.$queryRawUnsafe as unknown as jest.Mock).mockResolvedValue(
        custodyRow({ storageUri: null, encrypted: true, decryptionKeyPresent: false }),
      );

      await settleAbandonedCheckRun(abandonedRun(), cutoff);

      expect(settledMessage()).toBe(
        'The verification job did not report a result within the expected window. Re-verify to run it again.',
      );
    });

    it('never selects the key envelope, only its IS NOT NULL projection', async () => {
      // The whole point of reading custody here is one boolean. Fails if the
      // key column is selected into this row object.
      (prisma.$queryRawUnsafe as unknown as jest.Mock).mockResolvedValue(custodyRow({}));

      await settleAbandonedCheckRun(abandonedRun(), cutoff);

      const sql = (prisma.$queryRawUnsafe as unknown as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('"decryptionKey" IS NOT NULL');
      expect(sql).not.toMatch(/SELECT[\s\S]*e\."decryptionKey"\s+AS/);
    });

    it('names both moves, not the generic message, when the custody read itself fails', async () => {
      // Guidance is advice beside a settlement that has to happen, so a
      // failed read of the parent is not a reason to leave a run PENDING for
      // ever. What the settlement cannot do is guess: the generic message
      // misdirects exactly the unopened-copy record this feature exists for,
      // and the resend message misdirects every native and protected one.
      // Fails if either specific message is used on a read that established
      // neither.
      (prisma.$queryRawUnsafe as unknown as jest.Mock).mockRejectedValue(new Error('connection reset'));

      await expect(settleAbandonedCheckRun(abandonedRun(), cutoff)).resolves.toEqual({ outcome: 'applied' });

      expect(settledMessage()).toBe(ABANDONED_CUSTODY_UNKNOWN_MESSAGE);
      // Both moves, named: re-verify, and resend the key if the copy is still
      // unopened.
      expect(settledMessage()).toContain('Re-verify to run it again');
      expect(settledMessage()).toContain('resend the key as sourceEncryption.decryptionKey');
      expect(settledMessage()).not.toBe(ABANDONED_RUN_MESSAGE);
      expect(loggerCalls.warn).toHaveBeenCalledWith(
        expect.objectContaining({ recordId: RECORD_ID, error: { name: 'Error', message: 'connection reset' } }),
        "An abandoned run's custody could not be read; settling it with resume guidance that names both moves",
      );
    });
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
