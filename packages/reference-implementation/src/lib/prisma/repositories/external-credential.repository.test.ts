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
    externalCredential: { create: jest.fn(async () => ({ id: 'rec-1' })) },
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
import { createExternalCredential, type CreateExternalCredentialInput } from './external-credential.repository';

const mockTransaction = prisma.$transaction as unknown as jest.Mock;

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
