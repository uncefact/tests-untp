/**
 * The transaction budget and what runs inside it. The rest of this
 * repository's behaviour is covered against a real database in
 * `__tests__/integration/library-register.integration.test.ts`; these two
 * guarantees are invisible there, because Prisma's options do not surface in
 * the rows a query reads back.
 */

jest.mock('@/lib/jobs/prisma-sql-executor', () => ({ prismaSqlExecutor: () => 'sql-executor' }));

jest.mock('../prisma', () => {
  const tx = {
    libraryRecord: { create: jest.fn(async () => ({ id: 'rec-1' })) },
    externalCredential: {
      create: jest.fn(async () => ({ id: 'rec-1' })),
      findFirst: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    checkRun: { create: jest.fn(async () => ({ id: 'run-1', generation: 1 })) },
    idempotencyKey: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prismaMock = {
    ...tx,
    $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
  };
  return { prisma: prismaMock };
});

import { CheckRunState, CoreCredentialType, CredentialDetailsStatus } from '../generated';
import { prisma } from '../prisma';
import {
  ContentDigestNotHeldError,
  ContentDigestPromotionRacedError,
  CONTENT_DIGEST_UNIQUE_INDEX,
  createExternalCredential,
  DuplicateCredentialError,
  findExternalByContentDigest,
  promoteExternalCredentialDigest,
  type CreateExternalCredentialInput,
} from './external-credential.repository';

const mockTransaction = prisma.$transaction as unknown as jest.Mock;
const mockExternalFindFirst = (prisma as unknown as { externalCredential: { findFirst: jest.Mock } }).externalCredential
  .findFirst;
const mockExternalUpdateMany = (prisma as unknown as { externalCredential: { updateMany: jest.Mock } })
  .externalCredential.updateMany;

function contentDigestConflict(target: unknown = CONTENT_DIGEST_UNIQUE_INDEX): Error {
  const error = new Error('Unique constraint failed') as Error & {
    name: string;
    code: string;
    clientVersion: string;
    meta: { target: unknown };
  };
  error.name = 'PrismaClientKnownRequestError';
  error.code = 'P2002';
  error.clientVersion = '6.19.2';
  error.meta = { target };
  return error;
}

function input(overrides: Partial<CreateExternalCredentialInput> = {}): CreateExternalCredentialInput {
  return {
    tenantId: 'tenant-1',
    sourceUrl: 'https://supplier.example/a',
    annotations: { displayName: 'Supplier DPP', declaredCredentialType: CoreCredentialType.DPP },
    details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
    checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue: jest.fn(async () => undefined) },
    ...overrides,
  } as CreateExternalCredentialInput;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTransaction.mockImplementation(async (cb: (client: unknown) => unknown) => cb(prisma));
  mockExternalFindFirst.mockResolvedValue(null);
  mockExternalUpdateMany.mockResolvedValue({ count: 1 });
});

describe('createExternalCredential transaction budget', () => {
  it('opens the transaction with an explicit wait and timeout rather than Prisma defaults', async () => {
    // The transaction holds the job enqueue, a second round trip to the same
    // database, so the 5 s default can expire after the durable copy is
    // already stored. Fails if the options object is dropped or either value
    // is lowered back to a default.
    await createExternalCredential(input());

    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5_000, timeout: 15_000 });
  });

  it('runs the pending run enqueue inside that transaction, through the transaction executor', async () => {
    // The record and its job commit together or not at all. Fails if the
    // enqueue moves outside the callback, or is handed a client that is not
    // the transaction's.
    const enqueue = jest.fn(async () => undefined);
    let enqueuedDuringTransaction = false;
    mockTransaction.mockImplementation(async (cb: (client: unknown) => unknown) => {
      const result = await cb(prisma);
      enqueuedDuringTransaction = enqueue.mock.calls.length === 1;
      return result;
    });

    await createExternalCredential(input({ checkRun: { state: CheckRunState.PENDING, checks: {}, enqueue } }));

    expect(enqueuedDuringTransaction).toBe(true);
    expect(enqueue).toHaveBeenCalledWith('sql-executor', {
      tenantId: 'tenant-1',
      recordId: 'rec-1',
      generation: 1,
      checkRunId: 'run-1',
    });
  });

  it('enqueues nothing for a run that already failed', async () => {
    // A failed run has no job to wait on. Fails if the enqueue branch stops
    // being conditional on the state.
    await createExternalCredential(
      input({
        checkRun: {
          state: CheckRunState.FAILED,
          checks: {},
          failure: { code: 'RETRIEVAL_FAILED', message: 'no', retryable: true },
        } as CreateExternalCredentialInput['checkRun'],
      }),
    );

    const checkRunCreate = (prisma as unknown as { checkRun: { create: jest.Mock } }).checkRun.create;
    expect(checkRunCreate.mock.calls[0][0].data.lastEnqueuedAt).toBeUndefined();
    expect(checkRunCreate.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
  });
});

describe('external content identity', () => {
  it('looks up a digest by tenant and excludes the current record for recovery', async () => {
    mockExternalFindFirst.mockResolvedValueOnce({ id: 'winner-1' });

    await expect(findExternalByContentDigest('tenant-1', 'zDigest', 'current-1')).resolves.toBe('winner-1');
    expect(mockExternalFindFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', contentDigest: 'zDigest', id: { not: 'current-1' } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
  });

  it('maps only the named content-digest collision to the existing tenant record', async () => {
    const conflict = contentDigestConflict();
    mockTransaction.mockRejectedValueOnce(conflict);
    mockExternalFindFirst.mockResolvedValueOnce({ id: 'winner-1' });

    await expect(createExternalCredential(input({ contentDigest: 'zDigest' }))).rejects.toEqual(
      expect.objectContaining({
        name: 'DuplicateCredentialError',
        existingRecordId: 'winner-1',
      } satisfies Partial<DuplicateCredentialError>),
    );
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockExternalFindFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', contentDigest: 'zDigest' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
  });

  it('retries once when the first winner vanished, then returns the prepared record', async () => {
    const conflict = contentDigestConflict();
    mockTransaction
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (cb: (client: unknown) => unknown) => cb(prisma));
    mockExternalFindFirst.mockResolvedValueOnce(null);

    await expect(createExternalCredential(input({ contentDigest: 'zDigest' }))).resolves.toMatchObject({
      record: { id: 'rec-1' },
    });
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(mockExternalFindFirst).toHaveBeenCalledTimes(1);
  });

  it('looks up once after the second collision and never invents an id', async () => {
    const conflict = contentDigestConflict();
    mockTransaction.mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict);
    mockExternalFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'third-winner' });

    await expect(createExternalCredential(input({ contentDigest: 'zDigest' }))).rejects.toMatchObject({
      name: 'DuplicateCredentialError',
      existingRecordId: 'third-winner',
    });
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(mockExternalFindFirst).toHaveBeenCalledTimes(2);
  });

  it('lets a second collision with no holder fail as the database error, with no third attempt', async () => {
    // The owner's ruling for the vanished winner. After two collisions and
    // two empty lookups the caller gets the sanitised 500 the raw error maps
    // to. Fails if a third persist is attempted or an id is invented.
    const conflict = contentDigestConflict();
    mockTransaction.mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict);
    mockExternalFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(createExternalCredential(input({ contentDigest: 'zDigest' }))).rejects.toBe(conflict);
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(mockExternalFindFirst).toHaveBeenCalledTimes(2);
  });

  it('rethrows a unique collision on another constraint instead of calling it a duplicate credential', async () => {
    const conflict = contentDigestConflict('ExternalCredential_id_tenantId_origin_key');
    mockTransaction.mockRejectedValueOnce(conflict);

    await expect(createExternalCredential(input({ contentDigest: 'zDigest' }))).rejects.toBe(conflict);
    expect(mockExternalFindFirst).not.toHaveBeenCalled();
  });

  it('promotes the oldest advisory row while retaining the tenant boundary', async () => {
    // This client returns a count of 1 from every updateMany, so `repointed`
    // here is the mock's default and says nothing about how many sibling rows
    // there were. The case below is the one that pins the repoint, and the
    // integration suite has the real counts.
    mockExternalFindFirst.mockResolvedValueOnce({ id: 'advisory-1' });

    await expect(
      promoteExternalCredentialDigest(prisma as never, {
        tenantId: 'tenant-1',
        recordId: 'canonical-1',
        contentDigest: 'zDigest',
      }),
    ).resolves.toEqual({ outcome: 'promoted', recordId: 'advisory-1', repointed: 1 });
    expect(mockExternalFindFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', duplicateOfRecordId: 'canonical-1', contentDigest: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    expect(mockExternalUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'canonical-1', tenantId: 'tenant-1', contentDigest: 'zDigest' },
      data: { contentDigest: null },
    });
    expect(mockExternalUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'advisory-1',
        tenantId: 'tenant-1',
        duplicateOfRecordId: 'canonical-1',
        contentDigest: null,
      },
      data: { contentDigest: 'zDigest', duplicateOfRecordId: null },
    });
  });

  it('moves the remaining advisory rows of the former owner onto the promoted row', async () => {
    // Left pointing at the former owner, a second advisory row loses its
    // pointer when that owner is deleted and would take an unrelated digest
    // if the owner were later given one. Fails if the repoint is dropped.
    mockExternalFindFirst.mockResolvedValueOnce({ id: 'advisory-1' });
    mockExternalUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });

    await expect(
      promoteExternalCredentialDigest(prisma as never, {
        tenantId: 'tenant-1',
        recordId: 'canonical-1',
        contentDigest: 'zDigest',
      }),
    ).resolves.toEqual({ outcome: 'promoted', recordId: 'advisory-1', repointed: 2 });
    expect(mockExternalUpdateMany).toHaveBeenNthCalledWith(3, {
      where: { tenantId: 'tenant-1', duplicateOfRecordId: 'canonical-1', contentDigest: null },
      data: { duplicateOfRecordId: 'advisory-1' },
    });
  });

  it('releases the digest and reports no advisory row when none is waiting', async () => {
    // The ordinary relinquish. Fails if the canonical release stops running
    // when there is nothing to hand the digest to, which would leave the
    // record holding an identity it has given up.
    mockExternalFindFirst.mockResolvedValueOnce(null);

    await expect(
      promoteExternalCredentialDigest(prisma as never, {
        tenantId: 'tenant-1',
        recordId: 'canonical-1',
        contentDigest: 'zDigest',
      }),
    ).resolves.toEqual({ outcome: 'none' });
    expect(mockExternalUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockExternalUpdateMany).toHaveBeenCalledWith({
      where: { id: 'canonical-1', tenantId: 'tenant-1', contentDigest: 'zDigest' },
      data: { contentDigest: null },
    });
  });

  it('throws when the record does not hold the digest it is said to be relinquishing', async () => {
    mockExternalUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      promoteExternalCredentialDigest(prisma as never, {
        tenantId: 'tenant-1',
        recordId: 'canonical-1',
        contentDigest: 'zDigest',
      }),
    ).rejects.toBeInstanceOf(ContentDigestNotHeldError);
    expect(mockExternalFindFirst).not.toHaveBeenCalled();
  });

  it('throws when the advisory row changed before it could take the digest', async () => {
    // Returning here would commit the release with nobody holding the
    // identity, and every later registration of that content would be let
    // through. Fails if the promoting count stops being checked.
    mockExternalFindFirst.mockResolvedValueOnce({ id: 'advisory-1' });
    mockExternalUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await expect(
      promoteExternalCredentialDigest(prisma as never, {
        tenantId: 'tenant-1',
        recordId: 'canonical-1',
        contentDigest: 'zDigest',
      }),
    ).rejects.toBeInstanceOf(ContentDigestPromotionRacedError);
    // The throw comes before the repoint, so no other advisory row is moved
    // onto a row that never took the identity.
    expect(mockExternalUpdateMany).toHaveBeenCalledTimes(2);
  });
});
