jest.mock('../prisma', () => ({
  prisma: {
    libraryRecord: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import { CheckResult, CheckRunState, LibraryRecordOrigin, Prisma } from '../generated';
import { prisma } from '../prisma';
import { getLibraryRecordById } from './library-record.repository';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';

const mockGlobalFindFirst = prisma.libraryRecord.findFirst as unknown as jest.Mock;
const mockTransaction = prisma.$transaction as unknown as jest.Mock;

/**
 * The client the transaction hands the callback is a different object from the
 * global one, as it is at runtime, so a read issued outside the transaction
 * (`prisma.libraryRecord.findFirst` in place of `tx.libraryRecord.findFirst`)
 * hits the global mock below and fails instead of quietly returning the row.
 */
const mockFindFirst = jest.fn();
const transactionClient = { libraryRecord: { findFirst: mockFindFirst } };

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
};

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
  mockGlobalFindFirst.mockImplementation(() => {
    throw new Error('the record was read on the global client, outside the repeatable-read transaction');
  });
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
