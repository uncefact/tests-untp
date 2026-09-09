jest.mock('../prisma', () => ({
  prisma: {
    libraryRecord: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import { CheckResult, CheckRunState, CoreCredentialType, LibraryRecordOrigin, Prisma } from '../generated';
import { prisma } from '../prisma';
import {
  batchGetLibraryRecords,
  buildLibraryBatchGetQuery,
  buildLibraryListQuery,
  getLibraryRecordById,
  LibraryRecordWriteAnomalyError,
  listLibraryRecords,
  updateLibraryRecordAnnotations,
  type LibraryRecordAnnotationChanges,
} from './library-record.repository';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';

const mockGlobalFindFirst = prisma.libraryRecord.findFirst as unknown as jest.Mock;
const mockTransaction = prisma.$transaction as unknown as jest.Mock;
const mockUpdateMany = jest.fn();
const mockParentUpdate = jest.fn();
const mockQueryRawUnsafe = jest.fn();

/**
 * The client the transaction hands the callback is a different object from the
 * global one, as it is at runtime, so a read issued outside the transaction
 * (`prisma.libraryRecord.findFirst` in place of `tx.libraryRecord.findFirst`)
 * hits the global mock below and fails instead of quietly returning the row.
 */
const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockCheckRunFindMany = jest.fn();
const mockQueryRaw = jest.fn();
const transactionClient = {
  libraryRecord: { findFirst: mockFindFirst, findMany: mockFindMany, update: mockParentUpdate },
  checkRun: { findMany: mockCheckRunFindMany },
  externalCredential: { updateMany: mockUpdateMany },
  $queryRaw: mockQueryRaw,
  $queryRawUnsafe: mockQueryRawUnsafe,
};

// The perimeter this guards is the literal form only: excess property checking
// fires on a fresh object literal and not on a spread, which is how the route
// actually builds its changes, so a widened source spread into that object
// would still compile. The assertion on the `data` keys below is what holds
// the perimeter for the construction the route uses.
// @ts-expect-error custody fields must never be accepted as annotation changes.
const custodyChangeMustNotCompile: LibraryRecordAnnotationChanges = { storageUri: 'https://secret.example' };
void custodyChangeMustNotCompile;

const CHECK_RUN = {
  id: 'run-1',
  recordId: 'record-1',
  tenantId: 'tenant-1',
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
  requestedAt: new Date('2026-09-05T00:00:00.000Z'),
  completedAt: null,
  lastEnqueuedAt: null,
  sourceChanged: null,
  lastSourceCheckAt: null,
};

const CHECK_RUN_2 = { ...CHECK_RUN, id: 'run-2', recordId: 'record-2' };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'record-1',
    tenantId: 'tenant-1',
    origin: LibraryRecordOrigin.EXTERNAL,
    credential: null,
    externalCredential: { id: 'record-1', tenantId: 'tenant-1', origin: LibraryRecordOrigin.EXTERNAL },
    checkRuns: [CHECK_RUN],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindFirst.mockReset();
  mockFindMany.mockReset();
  mockCheckRunFindMany.mockReset();
  mockQueryRaw.mockReset();
  mockGlobalFindFirst.mockImplementation(() => {
    throw new Error('the record was read on the global client, outside the repeatable-read transaction');
  });
  mockQueryRawUnsafe.mockResolvedValue([{ id: 'record-1' }]);
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockParentUpdate.mockResolvedValue({});
  mockTransaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(transactionClient));
});

describe('getLibraryRecordById', () => {
  it('uses one repeatable-read transaction and one tenant-scoped query with both children and the newest run', async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(getLibraryRecordById('record-1', 'tenant-1')).resolves.toBeNull();

    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(mockGlobalFindFirst).not.toHaveBeenCalled();
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: 'record-1', tenantId: 'tenant-1' },
      include: {
        credential: true,
        externalCredential: true,
        checkRuns: {
          orderBy: { generation: 'desc' },
          take: 1,
        },
      },
    });
  });

  it('narrows a native row and admits no stored run for generation 1 synthesis', async () => {
    mockFindFirst.mockResolvedValue(
      row({
        origin: LibraryRecordOrigin.NATIVE,
        credential: { id: 'record-1', tenantId: 'tenant-1', origin: LibraryRecordOrigin.NATIVE },
        externalCredential: null,
        checkRuns: [],
      }),
    );

    await expect(getLibraryRecordById('record-1', 'tenant-1')).resolves.toMatchObject({
      origin: LibraryRecordOrigin.NATIVE,
      checkRun: null,
    });
  });

  it('rejects a stored native generation 1 and an external row with no run', async () => {
    mockFindFirst.mockResolvedValueOnce(
      row({
        origin: LibraryRecordOrigin.NATIVE,
        credential: { id: 'record-1', tenantId: 'tenant-1', origin: LibraryRecordOrigin.NATIVE },
        externalCredential: null,
        checkRuns: [{ ...CHECK_RUN, generation: 1 }],
      }),
    );
    await expect(getLibraryRecordById('record-1', 'tenant-1')).rejects.toThrow(LibraryRecordShapeError);

    mockFindFirst.mockResolvedValueOnce(row({ checkRuns: [] }));
    await expect(getLibraryRecordById('record-1', 'tenant-1')).rejects.toThrow(/has no check run/);
  });

  it('returns the tenant-scoped external view and newest run selected by the query', async () => {
    mockFindFirst.mockResolvedValue(row());

    await expect(getLibraryRecordById('record-1', 'tenant-1')).resolves.toMatchObject({
      origin: LibraryRecordOrigin.EXTERNAL,
      external: { id: 'record-1' },
      checkRun: { generation: 2 },
    });
  });
});

describe('listLibraryRecords', () => {
  it('selects ids and hydrates them in the same repeatable-read transaction, preserving SQL order', async () => {
    mockQueryRaw.mockResolvedValue([
      { id: 'record-2', newestRunId: 'run-2', total: BigInt(2) },
      { id: 'record-1', newestRunId: 'run-1', total: BigInt(2) },
    ]);
    mockFindMany.mockResolvedValue([row({ id: 'record-1' }), row({ id: 'record-2' })]);
    mockCheckRunFindMany.mockResolvedValue([CHECK_RUN, CHECK_RUN_2]);

    const result = await listLibraryRecords({ tenantId: 'tenant-1', limit: 2, offset: 0 });

    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 2_000,
      timeout: 5_000,
    });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', id: { in: ['record-2', 'record-1'] } },
      include: { credential: true, externalCredential: true },
    });
    expect(mockCheckRunFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['run-2', 'run-1'] }, tenantId: 'tenant-1' },
    });
    expect(result).toMatchObject({ total: 2, data: [{ record: { id: 'record-2' } }, { record: { id: 'record-1' } }] });
  });

  it('keeps a native null run distinct from a selected run that cannot be hydrated', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ id: 'record-1', newestRunId: null, total: BigInt(1) }]);
    mockFindMany.mockResolvedValueOnce([
      row({
        origin: LibraryRecordOrigin.NATIVE,
        credential: { id: 'record-1', tenantId: 'tenant-1', origin: LibraryRecordOrigin.NATIVE },
        externalCredential: null,
      }),
    ]);
    mockCheckRunFindMany.mockResolvedValueOnce([]);

    await expect(listLibraryRecords({ tenantId: 'tenant-1' })).resolves.toMatchObject({
      data: [{ origin: LibraryRecordOrigin.NATIVE, checkRun: null }],
      total: 1,
    });
    expect(mockCheckRunFindMany).not.toHaveBeenCalled();

    mockQueryRaw.mockResolvedValueOnce([{ id: 'record-1', newestRunId: 'run-missing', total: BigInt(1) }]);
    mockFindMany.mockResolvedValueOnce([row()]);
    mockCheckRunFindMany.mockResolvedValueOnce([]);

    await expect(listLibraryRecords({ tenantId: 'tenant-1' })).rejects.toThrow(
      'was selected with a newest check run that could not be hydrated',
    );
  });

  it('rejects a stored native generation 1 through list hydration', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'record-1', newestRunId: 'run-1', total: BigInt(1) }]);
    mockFindMany.mockResolvedValue([
      row({
        origin: LibraryRecordOrigin.NATIVE,
        credential: { id: 'record-1', tenantId: 'tenant-1', origin: LibraryRecordOrigin.NATIVE },
        externalCredential: null,
      }),
    ]);
    mockCheckRunFindMany.mockResolvedValue([{ ...CHECK_RUN, generation: 1 }]);

    await expect(listLibraryRecords({ tenantId: 'tenant-1' })).rejects.toThrow(
      'is NATIVE but has a stored generation 1 check run',
    );
  });

  it('rejects an external record with no selected run through list hydration', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'record-1', newestRunId: null, total: BigInt(1) }]);
    mockFindMany.mockResolvedValue([row()]);

    await expect(listLibraryRecords({ tenantId: 'tenant-1' })).rejects.toThrow('is EXTERNAL but has no check run');
    expect(mockCheckRunFindMany).not.toHaveBeenCalled();
  });

  it('rejects a native record whose selected run cannot be hydrated', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'record-1', newestRunId: 'run-missing', total: BigInt(1) }]);
    mockFindMany.mockResolvedValue([
      row({
        origin: LibraryRecordOrigin.NATIVE,
        credential: { id: 'record-1', tenantId: 'tenant-1', origin: LibraryRecordOrigin.NATIVE },
        externalCredential: null,
      }),
    ]);
    mockCheckRunFindMany.mockResolvedValue([]);

    await expect(listLibraryRecords({ tenantId: 'tenant-1' })).rejects.toThrow(
      'was selected with a newest check run that could not be hydrated',
    );
  });

  it('uses the same three client operations for one and fifty selected records', async () => {
    const selectedOne = [{ id: 'record-1', newestRunId: 'run-1', total: BigInt(1) }];
    const selectedFifty = Array.from({ length: 50 }, (_, index) => ({
      id: `record-${index + 1}`,
      newestRunId: `run-${index + 1}`,
      total: BigInt(50),
    }));
    const recordsOne = [row()];
    const recordsFifty = selectedFifty.map(({ id }) =>
      row({
        id,
        credential: null,
        externalCredential: { id, tenantId: 'tenant-1', origin: LibraryRecordOrigin.EXTERNAL },
      }),
    );
    const runsOne = [CHECK_RUN];
    const runsFifty = selectedFifty.map(({ id, newestRunId }) => ({ ...CHECK_RUN, id: newestRunId, recordId: id }));

    mockQueryRaw.mockResolvedValueOnce(selectedOne).mockResolvedValueOnce(selectedFifty);
    mockFindMany.mockResolvedValueOnce(recordsOne).mockResolvedValueOnce(recordsFifty);
    mockCheckRunFindMany.mockResolvedValueOnce(runsOne).mockResolvedValueOnce(runsFifty);

    await listLibraryRecords({ tenantId: 'tenant-1', limit: 1 });
    const countsAtOne = {
      query: mockQueryRaw.mock.calls.length,
      records: mockFindMany.mock.calls.length,
      runs: mockCheckRunFindMany.mock.calls.length,
    };

    const resultAtFifty = await listLibraryRecords({ tenantId: 'tenant-1', limit: 50 });
    const countsAtFifty = {
      query: mockQueryRaw.mock.calls.length - countsAtOne.query,
      records: mockFindMany.mock.calls.length - countsAtOne.records,
      runs: mockCheckRunFindMany.mock.calls.length - countsAtOne.runs,
    };

    expect(countsAtOne).toEqual({ query: 1, records: 1, runs: 1 });
    expect(countsAtFifty).toEqual(countsAtOne);
    expect(resultAtFifty.data.map(({ record }) => record.id)).toEqual(selectedFifty.map(({ id }) => id));
  });

  it('uses two client operations for a native page with no selected runs', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'record-1', newestRunId: null, total: BigInt(1) }]);
    mockFindMany.mockResolvedValue([
      row({
        origin: LibraryRecordOrigin.NATIVE,
        credential: { id: 'record-1', tenantId: 'tenant-1', origin: LibraryRecordOrigin.NATIVE },
        externalCredential: null,
      }),
    ]);

    await expect(listLibraryRecords({ tenantId: 'tenant-1' })).resolves.toMatchObject({
      data: [{ origin: LibraryRecordOrigin.NATIVE, checkRun: null }],
      total: 1,
    });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockCheckRunFindMany).not.toHaveBeenCalled();
  });

  it('keeps an anchored total when the page is empty, including beyond the end', async () => {
    mockQueryRaw.mockResolvedValue([{ id: null, newestRunId: null, total: BigInt(7) }]);

    await expect(listLibraryRecords({ tenantId: 'tenant-1', limit: 20, offset: 20 })).resolves.toEqual({
      data: [],
      total: 7,
    });
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('fails rather than silently dropping an id that disappeared before hydration', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'record-1', newestRunId: 'run-1', total: BigInt(1) }]);
    mockFindMany.mockResolvedValue([]);
    mockCheckRunFindMany.mockResolvedValue([CHECK_RUN]);

    await expect(listLibraryRecords({ tenantId: 'tenant-1' })).rejects.toThrow(
      'was selected but could not be hydrated',
    );
  });

  it('attaches tenant and query context when the transaction reaches Prisma timeout', async () => {
    const timeout = Object.assign(new Error('Transaction already closed'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2028',
      clientVersion: '6.19.2',
    });
    mockTransaction.mockRejectedValue(timeout);

    await expect(listLibraryRecords({ tenantId: 'tenant-1' })).rejects.toBe(timeout);

    expect(timeout).toHaveProperty('context', { query: 'library-list', tenantId: 'tenant-1' });
  });
});

describe('buildLibraryListQuery', () => {
  it('keeps caller values bound while emitting the type, encryption and status branches', () => {
    const issuer = "Acme' OR 1=1 --";
    const query = buildLibraryListQuery({
      tenantId: 'tenant-1',
      type: [CoreCredentialType.DPP, CoreCredentialType.DFR],
      origin: 'external',
      organisationId: 'org-1',
      facilityId: 'facility-1',
      productId: 'product-1',
      issuer,
      encrypted: false,
      status: 'verified',
      issuedFrom: new Date('2026-01-01T00:00:00.000Z'),
      issuedTo: new Date('2026-01-31T23:59:59.999Z'),
      sort: 'issuedAt:desc',
      limit: 10,
      offset: 3,
    });
    const rendered = query as unknown as { sql: string; values: unknown[] };

    expect(rendered.sql).toContain('ANY');
    expect(rendered.sql).toContain('"CoreCredentialType"[]');
    expect(rendered.sql).toContain('(c."decryptionKey" IS NOT NULL)');
    expect(rendered.sql).toContain('e."encrypted"');
    expect(rendered.sql).toContain('"CheckRunState"');
    expect(rendered.sql.trimEnd()).toMatch(/ORDER BY page\."ordinal"$/);
    expect(rendered.sql).toContain('::timestamp(3)');
    expect(rendered.sql).not.toContain(issuer);
    expect(rendered.values).toContain(issuer);
    expect(rendered.values).toContain('2026-01-01T00:00:00.000');
    expect(rendered.values).toContain('2026-01-31T23:59:59.999');
    expect(rendered.values).not.toContain(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('uses a native-only mask when deriving a native status filter', () => {
    const query = buildLibraryListQuery({ tenantId: 'tenant-1', status: 'not_conformant' });
    const rendered = (query as unknown as { sql: string }).sql;

    const nativeStart = rendered.indexOf('r."origin" =');
    const externalStart = rendered.indexOf('r."origin" =', nativeStart + 1);
    const nativeBranch = rendered.slice(nativeStart, externalStart);

    // Fails if worker-only acquisition or custody failures are allowed to
    // affect the native public summary after projection masks them.
    expect(nativeBranch).toContain('n."proof"');
    expect(nativeBranch).toContain('n."status"');
    expect(nativeBranch).toContain('n."temporal"');
    expect(nativeBranch).toContain('n."schemaConformance"');
    expect(nativeBranch).not.toContain('n."retrieval"');
    expect(nativeBranch).not.toContain('n."decryption"');
    expect(nativeBranch).not.toContain('n."digest"');
  });
});

describe('updateLibraryRecordAnnotations', () => {
  it('locks the parent first, conditionally updates only supplied annotations, touches the parent, and returns the in-transaction view', async () => {
    mockFindFirst
      .mockResolvedValueOnce(row({ externalCredential: { ...row().externalCredential, annotationVersion: 1 } }))
      .mockResolvedValueOnce(
        row({
          externalCredential: {
            ...row().externalCredential,
            annotationVersion: 2,
            displayName: 'Corrected label',
          },
        }),
      );

    const changes = { displayName: 'Corrected label' };
    const result = await updateLibraryRecordAnnotations({
      recordId: 'record-1',
      tenantId: 'tenant-1',
      expectedVersion: 1,
      changes,
    });

    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    });
    expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
      'SELECT "id" FROM "LibraryRecord" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE',
      'record-1',
      'tenant-1',
    );
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'record-1',
        tenantId: 'tenant-1',
        origin: LibraryRecordOrigin.EXTERNAL,
        annotationVersion: 1,
      },
      data: {
        displayName: 'Corrected label',
        annotationVersion: { increment: 1 },
        updatedAt: expect.any(Date),
      },
    });
    expect(mockParentUpdate).toHaveBeenCalledWith({
      where: {
        id_tenantId_origin: {
          id: 'record-1',
          tenantId: 'tenant-1',
          origin: LibraryRecordOrigin.EXTERNAL,
        },
      },
      data: { updatedAt: expect.any(Date) },
    });
    expect((result as { outcome: 'updated'; view: { external: { annotationVersion: number } } }).outcome).toBe(
      'updated',
    );
    expect(
      (result as { outcome: 'updated'; view: { external: { annotationVersion: number } } }).view.external
        .annotationVersion,
    ).toBe(2);
    expect(mockFindFirst).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a vanished record', [], { outcome: 'missing' }],
    [
      'a native record',
      [
        row({
          origin: LibraryRecordOrigin.NATIVE,
          credential: { id: 'record-1', tenantId: 'tenant-1', origin: LibraryRecordOrigin.NATIVE },
          externalCredential: null,
          checkRuns: [],
        }),
      ],
      { outcome: 'native' },
    ],
  ])('does not write for %s', async (_name, lockedRows, expected) => {
    mockQueryRawUnsafe.mockResolvedValue(lockedRows.length === 0 ? [] : [{ id: 'record-1' }]);
    if (lockedRows.length > 0) mockFindFirst.mockResolvedValue(lockedRows[0]);

    await expect(
      updateLibraryRecordAnnotations({
        recordId: 'record-1',
        tenantId: 'tenant-1',
        expectedVersion: 1,
        changes: { notes: null },
      }),
    ).resolves.toEqual(expected);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockParentUpdate).not.toHaveBeenCalled();
  });

  it('returns a conflict without writing when the locked version is stale', async () => {
    mockFindFirst.mockResolvedValue(row({ externalCredential: { ...row().externalCredential, annotationVersion: 2 } }));

    await expect(
      updateLibraryRecordAnnotations({
        recordId: 'record-1',
        tenantId: 'tenant-1',
        expectedVersion: 1,
        changes: { notes: 'must not write' },
      }),
    ).resolves.toEqual({ outcome: 'version_conflict', currentVersion: 2 });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockParentUpdate).not.toHaveBeenCalled();
  });

  it('treats a native post-write read as a rolled-back write anomaly rather than returning it as updated', async () => {
    mockFindFirst
      .mockResolvedValueOnce(row({ externalCredential: { ...row().externalCredential, annotationVersion: 1 } }))
      .mockResolvedValueOnce(
        row({
          origin: LibraryRecordOrigin.NATIVE,
          credential: { id: 'record-1', tenantId: 'tenant-1', origin: LibraryRecordOrigin.NATIVE },
          externalCredential: null,
          checkRuns: [],
        }),
      );

    // The `updated` outcome is typed as an external view, so the origin is
    // proved here rather than re-checked by every caller. A record that was
    // updated as EXTERNAL and read back as NATIVE is a broken invariant, and
    // the throw rolls the transaction back instead of publishing the mixture.
    // The class and the detail are both asserted, because all three write
    // anomalies share one class and only the message separates them.
    const rejection = expect(
      updateLibraryRecordAnnotations({
        recordId: 'record-1',
        tenantId: 'tenant-1',
        expectedVersion: 1,
        changes: { notes: 'written but not answerable' },
      }),
    ).rejects;
    await rejection.toThrow(LibraryRecordWriteAnomalyError);
    await rejection.toThrow(/read back as NATIVE/);
  });

  // The same broken shape either side of the write is two different findings.
  // Before the write it is committed corruption this transaction only
  // discovered, and the route owes the caller its "could not be read" line.
  // After the write it is this transaction's own invariant failing on the row
  // it has just written, so it becomes a write anomaly and rolls back.
  it('reports a stored shape met before the write as a shape error, attempting no write', async () => {
    mockFindFirst.mockResolvedValue(row({ checkRuns: [] }));

    const rejection = expect(
      updateLibraryRecordAnnotations({
        recordId: 'record-1',
        tenantId: 'tenant-1',
        expectedVersion: 1,
        changes: { notes: 'must not write' },
      }),
    ).rejects;
    await rejection.toThrow(LibraryRecordShapeError);
    await rejection.toThrow(/is EXTERNAL but has no check run/);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockParentUpdate).not.toHaveBeenCalled();
  });

  it('converts a stored shape met by the post-write read-back into a rolled-back write anomaly', async () => {
    mockFindFirst
      .mockResolvedValueOnce(row({ externalCredential: { ...row().externalCredential, annotationVersion: 1 } }))
      .mockResolvedValueOnce(row({ checkRuns: [] }));

    const rejection = expect(
      updateLibraryRecordAnnotations({
        recordId: 'record-1',
        tenantId: 'tenant-1',
        expectedVersion: 1,
        changes: { notes: 'written but not readable' },
      }),
    ).rejects;
    await rejection.toThrow(LibraryRecordWriteAnomalyError);
    // The original detail rides across, so the log still names what was wrong
    // with the row and not merely that something was.
    await rejection.toThrow(/is EXTERNAL but has no check run/);
    await rejection.not.toThrow(LibraryRecordShapeError);
  });

  it('treats a zero conditional-update count as a rolled-back write anomaly', async () => {
    mockFindFirst.mockResolvedValue(row({ externalCredential: { ...row().externalCredential, annotationVersion: 1 } }));
    mockUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      updateLibraryRecordAnnotations({
        recordId: 'record-1',
        tenantId: 'tenant-1',
        expectedVersion: 1,
        changes: { notes: 'unexpected count' },
      }),
    ).rejects.toThrow(LibraryRecordWriteAnomalyError);
    expect(mockParentUpdate).not.toHaveBeenCalled();
  });
});

describe('batchGetLibraryRecords', () => {
  it('selects the tenant ids with a bound array and hydrates in requested order', async () => {
    const requestedIds = ['record-2', 'record-1'];
    mockQueryRaw.mockResolvedValue([
      { id: 'record-1', newestRunId: 'run-1' },
      { id: 'record-2', newestRunId: 'run-2' },
    ]);
    mockFindMany.mockResolvedValue([row({ id: 'record-1' }), row({ id: 'record-2' })]);
    mockCheckRunFindMany.mockResolvedValue([CHECK_RUN, CHECK_RUN_2]);

    const result = await batchGetLibraryRecords({ tenantId: 'tenant-1', ids: requestedIds });

    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 2_000,
      timeout: 5_000,
    });
    expect(mockGlobalFindFirst).not.toHaveBeenCalled();
    expect(mockQueryRaw).toHaveBeenCalledWith(expect.anything());
    const query = mockQueryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(query.sql).toContain('ANY');
    expect(query.sql).toContain('text[]');
    expect(query.sql).not.toContain('record-1');
    expect(query.values).toContain('tenant-1');
    expect(query.values).toEqual(['tenant-1', requestedIds]);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', id: { in: requestedIds } },
      include: { credential: true, externalCredential: true },
    });
    expect(result.map(({ record }) => record.id)).toEqual(requestedIds);
  });

  it('returns no rows without opening a transaction for an empty id set', async () => {
    await expect(batchGetLibraryRecords({ tenantId: 'tenant-1', ids: [] })).resolves.toEqual([]);

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('deduplicates duplicate ids before selecting and hydrating one record', async () => {
    const requestedIds = ['record-1', 'record-1'];
    mockQueryRaw.mockResolvedValue([{ id: 'record-1', newestRunId: 'run-1' }]);
    mockFindMany.mockResolvedValue([row()]);
    mockCheckRunFindMany.mockResolvedValue([CHECK_RUN]);

    await expect(batchGetLibraryRecords({ tenantId: 'tenant-1', ids: requestedIds })).resolves.toHaveLength(1);

    const query = mockQueryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(query.values).toEqual(['tenant-1', ['record-1']]);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1', id: { in: ['record-1'] } } }),
    );
  });

  it('drops a NUL-bearing id before binding the SQL parameter', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'record-1', newestRunId: 'run-1' }]);
    mockFindMany.mockResolvedValue([row()]);
    mockCheckRunFindMany.mockResolvedValue([CHECK_RUN]);

    await expect(
      batchGetLibraryRecords({ tenantId: 'tenant-1', ids: ['record-1\0bad', 'record-1'] }),
    ).resolves.toHaveLength(1);

    const query = mockQueryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(query.values).toEqual(['tenant-1', ['record-1']]);
  });

  it('returns no rows without opening a transaction for an all-NUL set', async () => {
    await expect(
      batchGetLibraryRecords({ tenantId: 'tenant-1', ids: ['record-1\0bad', 'record-1\0bad'] }),
    ).resolves.toEqual([]);

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('omits ids absent from the tenant-scoped selection', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'record-2', newestRunId: 'run-2' }]);
    mockFindMany.mockResolvedValue([row({ id: 'record-2' })]);
    mockCheckRunFindMany.mockResolvedValue([CHECK_RUN_2]);

    const result = await batchGetLibraryRecords({
      tenantId: 'tenant-1',
      ids: ['record-missing', 'record-2', 'record-foreign'],
    });

    expect(result.map(({ record }) => record.id)).toEqual(['record-2']);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['record-2'] },
        }),
      }),
    );
  });

  it('keeps a native record with no run while hydrating an external run', async () => {
    mockQueryRaw.mockResolvedValue([
      { id: 'record-native', newestRunId: null },
      { id: 'record-1', newestRunId: 'run-1' },
    ]);
    mockFindMany.mockResolvedValue([
      row({
        id: 'record-native',
        origin: LibraryRecordOrigin.NATIVE,
        credential: { id: 'record-native', tenantId: 'tenant-1', origin: LibraryRecordOrigin.NATIVE },
        externalCredential: null,
        checkRuns: [],
      }),
      row({ id: 'record-1' }),
    ]);
    mockCheckRunFindMany.mockResolvedValue([CHECK_RUN]);

    await expect(
      batchGetLibraryRecords({ tenantId: 'tenant-1', ids: ['record-native', 'record-1'] }),
    ).resolves.toMatchObject({
      0: { origin: LibraryRecordOrigin.NATIVE, checkRun: null },
      1: { origin: LibraryRecordOrigin.EXTERNAL, checkRun: CHECK_RUN },
    });
  });

  it('rejects a native generation 1 run selected by the batch query', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'record-native', newestRunId: 'run-1' }]);
    mockFindMany.mockResolvedValue([
      row({
        id: 'record-native',
        origin: LibraryRecordOrigin.NATIVE,
        credential: { id: 'record-native', tenantId: 'tenant-1', origin: LibraryRecordOrigin.NATIVE },
        externalCredential: null,
      }),
    ]);
    mockCheckRunFindMany.mockResolvedValue([{ ...CHECK_RUN, recordId: 'record-native', generation: 1 }]);

    await expect(batchGetLibraryRecords({ tenantId: 'tenant-1', ids: ['record-native'] })).rejects.toThrow(
      'is NATIVE but has a stored generation 1 check run',
    );
  });

  it('fails when a selected external record has no loadable run', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'record-1', newestRunId: null }]);
    mockFindMany.mockResolvedValue([row({ id: 'record-1' })]);

    await expect(batchGetLibraryRecords({ tenantId: 'tenant-1', ids: ['record-1'] })).rejects.toThrow(
      'is EXTERNAL but has no check run',
    );
  });

  it('fails when a selected record has a non-null run id that cannot be loaded', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'record-1', newestRunId: 'run-missing' }]);
    mockFindMany.mockResolvedValue([row({ id: 'record-1' })]);
    mockCheckRunFindMany.mockResolvedValue([]);

    await expect(batchGetLibraryRecords({ tenantId: 'tenant-1', ids: ['record-1'] })).rejects.toThrow(
      'was selected with a newest check run that could not be hydrated',
    );
  });

  it('fails when a selected record disappears before hydration', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'record-1', newestRunId: 'run-1' }]);
    mockFindMany.mockResolvedValue([]);
    mockCheckRunFindMany.mockResolvedValue([CHECK_RUN]);

    await expect(batchGetLibraryRecords({ tenantId: 'tenant-1', ids: ['record-1'] })).rejects.toThrow(
      'was selected but could not be hydrated',
    );
  });

  it('attaches batch query context when the transaction reaches Prisma timeout', async () => {
    const timeout = Object.assign(new Error('Transaction already closed'), { code: 'P2028' });
    mockTransaction.mockRejectedValue(timeout);

    await expect(batchGetLibraryRecords({ tenantId: 'tenant-1', ids: ['record-1'] })).rejects.toBe(timeout);

    expect(timeout).toHaveProperty('context', { query: 'library-batch-get', tenantId: 'tenant-1' });
  });
});

describe('buildLibraryBatchGetQuery', () => {
  it('binds the tenant and request id array instead of interpolating id text', () => {
    const ids = ["record-1' OR 1=1 --", 'record-2'];
    const query = buildLibraryBatchGetQuery('tenant-1', ids) as unknown as { sql: string; values: unknown[] };

    expect(query.sql).toContain('WHERE r."tenantId" = ');
    expect(query.sql).toContain('r."id" = ANY');
    expect(query.sql).not.toContain(ids[0]);
    expect(query.values).toEqual(['tenant-1', ids]);
  });

  // The lateral join is what makes one row per record carry that record's
  // newest check run: without the ORDER BY the LIMIT would pick an arbitrary
  // generation. The run's composite key already ties it to its record's
  // tenant, so the join's tenant predicate is defence in depth that keeps the
  // read explicitly tenant-keyed; the assertion pins that it stays.
  it('selects the newest check run per record through a tenant-scoped lateral join', () => {
    const query = buildLibraryBatchGetQuery('tenant-1', ['record-1']) as unknown as { sql: string };

    expect(query.sql).toContain('LEFT JOIN LATERAL');
    expect(query.sql).toContain('n."tenantId" = r."tenantId"');
    expect(query.sql).toContain('ORDER BY n."generation" DESC');
    expect(query.sql).toContain('LIMIT 1');
  });
});
