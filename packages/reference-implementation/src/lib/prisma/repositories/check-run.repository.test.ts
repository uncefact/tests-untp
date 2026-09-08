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
}));

import { CheckResult, CheckRunState, LibraryRecordOrigin, Prisma, type CheckRun } from '../generated';
import { prisma } from '../prisma';
import type { SqlExecutor } from '@/lib/jobs/types';
import {
  createReverificationGeneration,
  findAbandonedPendingCheckRuns,
  settleAbandonedCheckRun,
  type CreateReverificationGenerationInput,
} from './check-run.repository';

const RECORD_ID = 'record-1';
const TENANT_ID = 'tenant-1';
const TX_LOCK = jest.fn();
const TX_FIND = jest.fn();
const TX_CREATE = jest.fn();
const transactionClient = {
  $queryRawUnsafe: TX_LOCK,
  libraryRecord: { findFirst: TX_FIND },
  checkRun: { create: TX_CREATE },
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
    },
    checkRuns: [{ generation: 1, state: CheckRunState.COMPLETE }],
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
    // The select is asserted exactly, so putting the key envelope back into
    // the compared tuple flips this test. The runs carry no tenant filter,
    // matching the record reader: the composite foreign key already pins them
    // to the parent's tenant, and a filter could only narrow the newest
    // generation away and serve an older one as current.
    expect(TX_FIND).toHaveBeenCalledWith({
      where: { id: RECORD_ID, tenantId: TENANT_ID },
      include: {
        credential: { select: { storageUri: true, digestMultibase: true } },
        externalCredential: {
          select: { storageUri: true, storageDigestMultibase: true, storageExternalId: true },
        },
        checkRuns: {
          orderBy: { generation: 'desc' },
          take: 1,
          select: { generation: true, state: true },
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
    TX_FIND.mockResolvedValue(row({ checkRuns: [{ generation: 1, state: CheckRunState.PENDING }] }));
    const enqueue = jest.fn(async () => undefined);

    await expect(createReverificationGeneration(input({ enqueue }))).resolves.toEqual({ outcome: 'joined' });
    expect(TX_CREATE).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('reports superseded when custody changed while the request was preparing', async () => {
    // Fails if a fresh prepared copy can overwrite custody selected by a
    // concurrent request after the initial snapshot.
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
    // An operator triaging a request that did no work needs both tuples.
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
    TX_FIND.mockResolvedValue(row({ checkRuns: [{ generation: 3, state: CheckRunState.COMPLETE }] }));

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
      expect.objectContaining({
        data: expect.objectContaining({ sourceChanged: true, lastSourceCheckAt: checkedAt }),
      }),
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
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: RECORD_ID, tenantId: TENANT_ID }),
      'Re-verification insert lost a unique race; reading the winner',
    );
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

    // The row carries results the sweep did not produce. Fails if the settle
    // writes a fresh all-NOT_RUN set over them, which an all-NOT_RUN fixture
    // could not tell apart from preserving them.
    await expect(
      settleAbandonedCheckRun(abandonedRun({ retrieval: CheckResult.PASS, digest: CheckResult.PASS })),
    ).resolves.toEqual({ outcome: 'applied' });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', tenantId: TENANT_ID, state: CheckRunState.PENDING },
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
});
