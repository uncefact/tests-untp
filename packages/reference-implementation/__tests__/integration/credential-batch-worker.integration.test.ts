jest.mock('@/lib/api/logger');

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ValidationError } from '../../src/lib/api/validation';
import { StorageStoreError } from '@uncefact/untp-ri-services';
import { CredentialBatchItemState, CredentialBatchState, LibraryRecordOrigin } from '../../src/lib/prisma/generated';
import {
  claimBatchAttempt,
  cancelCredentialBatch,
  claimNextBatchItem,
  createCredentialBatch,
  getCredentialBatchById,
  markItemIssued,
  type BatchSubmissionResult,
} from '../../src/lib/prisma/repositories/credential-batch.repository';
import {
  credentialBatchIssueHandler,
  defaultCredentialBatchIssueDependencies,
  registerCredentialBatchIssue,
} from '../../src/lib/credentials/issue-batch-job';
import {
  credentialBatchReconciliationHandler,
  defaultCredentialBatchReconciliationDependencies,
} from '../../src/lib/credentials/reconcile-batches-job';
import { CREDENTIAL_BATCH_ISSUE_JOB } from '../../src/lib/jobs/queue-names';
import { PgBossJobQueue } from '../../src/lib/jobs/pg-boss-job-queue';
import type { JobContext, JobQueue } from '../../src/lib/jobs/types';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { barrier } from './rig/locks';

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.BATCH_RETENTION_DAYS = '1';
process.env.WORKER_JOB_TIMEOUT_SECONDS = '30';

const prisma = createRigClient();
const loggerCalls = jest.requireMock('@/lib/api/logger').appLogger as Record<string, jest.Mock>;
const ITEM = (index: number) => ({
  credentialPayload: { issuer: { id: 'did:web:issuer.example' }, index },
  credentialType: 'DigitalProductPassport',
  version: '0.6.0',
});

function context(expireSeconds = 30, signal: AbortSignal = new AbortController().signal): JobContext {
  return {
    jobId: 'worker-job',
    attempt: 1,
    isFinalAttempt: false,
    expireSeconds,
    signal,
  };
}

function batchId(result: BatchSubmissionResult): string {
  if (result.outcome !== 'created') throw new Error('Expected a new batch');
  return result.batchId;
}

const noOpQueue = { enqueueWithin: async () => undefined } as unknown as JobQueue;
const ACTIVE_JOB = 'integration.credential-batch-active-job';

describe('credential batch worker and reconciliation', () => {
  const queue = new PgBossJobQueue({
    connectionString: process.env.RI_DATABASE_URL as string,
    onError: (error) => {
      throw error;
    },
  });
  const idleQueue = new PgBossJobQueue({ connectionString: process.env.RI_DATABASE_URL as string });
  const activeQueue = new PgBossJobQueue({ connectionString: process.env.RI_DATABASE_URL as string });
  let issueGate: (() => Promise<void>) | undefined;
  let issuedNumber = 0;
  let issueCalls: unknown[] = [];
  let activeJobRun: { fetched: () => void; completed: Promise<void> } | undefined;

  async function clearJobs(): Promise<void> {
    await prisma.$executeRawUnsafe(
      'DELETE FROM pgboss.job WHERE name IN ($1, $2)',
      CREDENTIAL_BATCH_ISSUE_JOB,
      ACTIVE_JOB,
    );
  }

  async function fakeIssue({
    tenantId,
    body,
    onDispatch,
  }: {
    tenantId: string;
    body: typeof ITEM extends (index: number) => infer T ? T : never;
    onDispatch?: () => void;
  }): Promise<{
    status: 201;
    body: { credentialId: string };
  }> {
    issueCalls.push(body);
    const request = body as ReturnType<typeof ITEM>;
    if (
      request.credentialPayload &&
      typeof request.credentialPayload === 'object' &&
      'refuse' in request.credentialPayload
    ) {
      throw new ValidationError('item refused by the verifier double');
    }
    onDispatch?.();
    const credentialId = `worker-credential-${issuedNumber++}`;
    await prisma.libraryRecord.create({
      data: {
        id: credentialId,
        tenantId,
        origin: LibraryRecordOrigin.NATIVE,
        credentialType: request.credentialType,
        credential: {
          create: {
            storageUri: `https://storage.example/${credentialId}`,
            digestMultibase: `z${credentialId}`,
          },
        },
      },
    });
    return { status: 201, body: { credentialId } };
  }

  beforeAll(async () => {
    const deps = defaultCredentialBatchIssueDependencies(queue);
    deps.issue = async (input) => {
      await issueGate?.();
      return fakeIssue(input as never);
    };
    registerCredentialBatchIssue(queue, deps, 1);
    activeQueue.register(ACTIVE_JOB, async () => {
      const run = activeJobRun;
      if (run === undefined) throw new Error('active-job test handler was not armed');
      run.fetched();
      await run.completed;
    });
    await queue.start();
    await queue.declareQueue(CREDENTIAL_BATCH_ISSUE_JOB);
    await idleQueue.start();
    await idleQueue.declareQueue(CREDENTIAL_BATCH_ISSUE_JOB);
    await activeQueue.start();
    await activeQueue.declareQueue(ACTIVE_JOB);
  });

  beforeEach(async () => {
    // Stop the polling worker before truncating, then drain the queue rows. A
    // continuation the previous test committed can already be fetched and mid-write
    // when cleanup runs, and deleting waiting rows does not wait for that handler,
    // so the truncate deadlocks against it (40P01). A graceful stop does wait.
    await queue.stop();
    await activeQueue.stop();
    await clearJobs();
    await truncateApplicationTables(prisma);
    await prisma.tenant.create({ data: { id: 'tenant-1', name: 'Tenant One' } });
    issuedNumber = 0;
    issueCalls = [];
    issueGate = undefined;
    await queue.start();
    await activeQueue.start();
  });

  afterEach(async () => {
    await queue.stop();
    await activeQueue.stop();
    await clearJobs();
  });

  afterAll(async () => {
    await queue.stop();
    await idleQueue.stop();
    await activeQueue.stop();
    await truncateApplicationTables(prisma);
    await prisma.$disconnect();
  });

  async function submit(
    key: string,
    items: readonly Record<string, unknown>[],
    selectedQueue: JobQueue = idleQueue,
  ): Promise<string> {
    return batchId(
      await createCredentialBatch({
        tenantId: 'tenant-1',
        idempotencyKey: key,
        bodyDigest: key,
        items,
        queue: selectedQueue,
      }),
    );
  }

  async function waitForBatch(
    batch: string,
    state: CredentialBatchState,
  ): Promise<NonNullable<Awaited<ReturnType<typeof getCredentialBatchById>>>> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const current = await getCredentialBatchById(batch, 'tenant-1');
      if (current?.state === state) return current;
      if (Date.now() >= deadline) throw new Error(`Batch ${batch} did not reach ${state}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async function jobsFor(id: string) {
    return prisma.$queryRaw<Array<{ id: string; state: string }>>`
      SELECT id::text, state::text FROM pgboss.job
      WHERE name = ${CREDENTIAL_BATCH_ISSUE_JOB} AND data->>'batchId' = ${id}
    `;
  }

  async function waitForCompletedJobs(id: string, count: number) {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const jobs = await jobsFor(id);
      if (jobs.length === count && jobs.every((job) => job.state === 'completed')) return jobs;
      if (Date.now() >= deadline) throw new Error(`Batch ${id} jobs did not complete`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it('cancels four queued items while the real queue finishes only the held first item', async () => {
    const entered = barrier();
    const finish = barrier();
    issueGate = async () => {
      entered.release();
      await finish.promise;
    };
    let id!: string;
    try {
      id = await submit(
        'worker-cancel-five',
        Array.from({ length: 5 }, (_, index) => ITEM(index)),
      );
      await entered.promise;
      await prisma.$transaction((tx) => cancelCredentialBatch(tx, { batchId: id, tenantId: 'tenant-1' }));
      expect(await getCredentialBatchById(id, 'tenant-1')).toMatchObject({
        state: 'RUNNING',
        queuedCount: 0,
        processingCount: 1,
        cancelledCount: 4,
        items: [
          expect.objectContaining({ state: 'PROCESSING' }),
          ...Array.from({ length: 4 }, () => expect.objectContaining({ state: 'CANCELLED' })),
        ],
      });
    } finally {
      finish.release();
    }
    const settled = await waitForBatch(id, CredentialBatchState.CANCELLED);
    expect(settled).toMatchObject({
      issuedCount: 1,
      cancelledCount: 4,
      queuedCount: 0,
      processingCount: 0,
      items: [
        expect.objectContaining({ state: 'ISSUED', credentialId: 'worker-credential-0' }),
        ...Array.from({ length: 4 }, () => expect.objectContaining({ state: 'CANCELLED' })),
      ],
    });
    await waitForCompletedJobs(id, 1);
    await idleQueue.enqueue(CREDENTIAL_BATCH_ISSUE_JOB, { batchId: id, tenantId: 'tenant-1' });
    const afterDuplicate = await waitForCompletedJobs(id, 2);
    await credentialBatchReconciliationHandler(defaultCredentialBatchReconciliationDependencies(idleQueue))(
      {} as never,
      context(),
    );
    expect(await jobsFor(id)).toEqual(afterDuplicate);
    expect(await getCredentialBatchById(id, 'tenant-1')).toEqual(settled);
    expect(issueCalls).toHaveLength(1);
    expect(await prisma.libraryRecord.count()).toBe(1);
  });

  it('cancels a pre-dispatch fault without recreating queued work or a continuation', async () => {
    await queue.stop();
    const id = await submit('cancel-before-dispatch', [ITEM(0), ITEM(1)], noOpQueue);
    const deps = defaultCredentialBatchIssueDependencies(idleQueue);
    deps.issue = async () => {
      await prisma.$transaction((tx) => cancelCredentialBatch(tx, { batchId: id, tenantId: 'tenant-1' }));
      throw new Error('pre-dispatch unavailable');
    };
    await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());
    expect(await getCredentialBatchById(id, 'tenant-1')).toMatchObject({
      state: 'CANCELLED',
      cancelledCount: 2,
      queuedCount: 0,
      processingCount: 0,
      items: [
        expect.objectContaining({ state: 'CANCELLED', attemptCount: 1 }),
        expect.objectContaining({ state: 'CANCELLED' }),
      ],
    });
    expect(await jobsFor(id)).toEqual([]);
    expect(await prisma.libraryRecord.count()).toBe(0);
  });

  it('marks a stale worker outcome superseded without changing the live takeover owner', async () => {
    // Regression: an old worker must not write an issued outcome after a newer attempt takes ownership.
    await queue.stop();
    const id = await submit('cancel-stale-worker', [ITEM(0), ITEM(1)], noOpQueue);
    await prisma.$transaction(async (tx) => {
      await claimBatchAttempt(tx, { batchId: id, tenantId: 'tenant-1', token: 'old-worker', expectedVersion: 0 });
      await claimNextBatchItem(tx, { batchId: id, tenantId: 'tenant-1', token: 'old-worker' });
      await cancelCredentialBatch(tx, { batchId: id, tenantId: 'tenant-1' });
    });
    const oldSnapshot = await getCredentialBatchById(id, 'tenant-1');
    expect(oldSnapshot).toMatchObject({ attemptToken: 'old-worker', processingCount: 1, cancelledCount: 1 });
    await prisma.$transaction(async (tx) => {
      expect(
        await claimBatchAttempt(tx, {
          batchId: id,
          tenantId: 'tenant-1',
          token: 'new-worker',
          expectedVersion: oldSnapshot!.version,
          staleBefore: new Date(Date.now() + 1_000),
        }),
      ).toEqual({ applied: true });
    });
    const liveBefore = await getCredentialBatchById(id, 'tenant-1');
    expect(liveBefore).toMatchObject({
      attemptToken: 'new-worker',
      processingCount: 0,
      unknownCount: 1,
      cancelledCount: 1,
    });

    let observedOutcome: string | undefined;
    const deps = defaultCredentialBatchIssueDependencies(idleQueue);
    deps.getBatch = async () => oldSnapshot;
    deps.claimAttempt = async () => ({ applied: true });
    deps.claimNextItem = async () => ({
      outcome: 'claimed' as const,
      item: { index: 0, request: oldSnapshot!.items[0].request },
    });
    deps.issue = async () => ({ status: 201 as const, body: { credentialId: 'stale-worker-credential' } });
    deps.markIssued = async (tx, input) => {
      const result = await markItemIssued(tx, input);
      observedOutcome = result.outcome;
      return result;
    };
    deps.recordKnownCredentialId = async () => ({ applied: false });
    await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());

    expect(observedOutcome).toBe('superseded');
    expect(await getCredentialBatchById(id, 'tenant-1')).toEqual(liveBefore);
  });

  it('handles a stale worker claim after live takeover and cancellation without touching the settled owner', async () => {
    // Regression: a stale worker must treat an already-settled cancellation as success and leave no warning or fence release.
    await queue.stop();
    const id = await submit('cancel-stale-claim', [ITEM(0)], noOpQueue);
    const claimEntered = barrier();
    const allowClaim = barrier();
    let staleToken: string | undefined;
    let staleClaimToken: string | undefined;
    const deps = defaultCredentialBatchIssueDependencies(noOpQueue);
    deps.claimAttempt = async (tx, input) => {
      staleToken = input.token;
      return claimBatchAttempt(tx, input);
    };
    deps.claimNextItem = async (tx, input) => {
      claimEntered.release();
      await allowClaim.promise;
      staleClaimToken = input.token;
      const result = await claimNextBatchItem(tx, input);
      expect(result).toEqual({ outcome: 'cancelled' });
      return result;
    };

    const staleWorker = credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());
    try {
      await claimEntered.promise;
      const held = await getCredentialBatchById(id, 'tenant-1');
      expect(staleToken).toEqual(expect.any(String));
      expect(held).toMatchObject({ state: CredentialBatchState.RUNNING, attemptToken: staleToken, queuedCount: 1 });

      expect(
        await prisma.$transaction((tx) =>
          claimBatchAttempt(tx, {
            batchId: id,
            tenantId: 'tenant-1',
            token: 'live-worker',
            expectedVersion: held!.version,
            staleBefore: new Date(Date.now() + 1_000),
          }),
        ),
      ).toEqual({ applied: true });
      expect(await getCredentialBatchById(id, 'tenant-1')).toMatchObject({
        state: CredentialBatchState.RUNNING,
        attemptToken: 'live-worker',
      });

      const cancellation = await prisma.$transaction((tx) =>
        cancelCredentialBatch(tx, { batchId: id, tenantId: 'tenant-1' }),
      );
      expect(cancellation).toMatchObject({
        outcome: 'applied',
        batch: {
          state: CredentialBatchState.CANCELLED,
          settledAt: expect.any(Date),
          attemptToken: null,
          queuedCount: 0,
          processingCount: 0,
          cancelledCount: 1,
        },
      });
      const settledBeforeStaleClaim = await getCredentialBatchById(id, 'tenant-1');
      expect(settledBeforeStaleClaim).toMatchObject({
        state: CredentialBatchState.CANCELLED,
        attemptToken: null,
        queuedCount: 0,
        processingCount: 0,
        cancelledCount: 1,
      });

      loggerCalls.info.mockClear();
      loggerCalls.warn.mockClear();
      allowClaim.release();
      await expect(staleWorker).resolves.toBeUndefined();

      expect(await getCredentialBatchById(id, 'tenant-1')).toMatchObject({
        state: settledBeforeStaleClaim!.state,
        attemptToken: settledBeforeStaleClaim!.attemptToken,
        lastProgressAt: settledBeforeStaleClaim!.lastProgressAt,
      });
      expect(staleClaimToken).toBe(staleToken);
      expect(loggerCalls.info).toHaveBeenCalledTimes(1);
      expect(loggerCalls.info).toHaveBeenCalledWith(
        expect.objectContaining({ batchId: id, tenantId: 'tenant-1', settlement: 'already-settled' }),
        'Credential batch cancellation already settled',
      );
      expect(loggerCalls.warn).not.toHaveBeenCalled();
    } finally {
      allowClaim.release();
      await staleWorker;
    }
  });

  it('serialises cancellation against a post-dispatch fault and makes retry harmless', async () => {
    await queue.stop();
    const id = await submit('cancel-after-dispatch', [ITEM(0), ITEM(1)], noOpQueue);
    const dispatched = barrier();
    const fault = barrier();
    const cancelWritten = barrier();
    const commitCancel = barrier();
    const faultTransaction = barrier();
    const other = createRigClient();
    let cancelPid = 0;
    let faultPid = 0;
    let captureFault = false;
    const deps = defaultCredentialBatchIssueDependencies(idleQueue);
    deps.transaction = (callback) =>
      other.$transaction(
        async (tx) => {
          if (captureFault) {
            const [session] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
            faultPid = session.pid;
            faultTransaction.release();
          }
          return callback(tx);
        },
        { timeout: 15_000 },
      );
    let dispatchCount = 0;
    deps.issue = async ({ onDispatch }) => {
      dispatchCount += 1;
      onDispatch?.();
      dispatched.release();
      await fault.promise;
      throw new Error('lost provider response');
    };
    const run = credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());
    const observed = run.then(
      () => ({ error: null }),
      (error: Error) => ({ error }),
    );
    const cancelling = prisma.$transaction(
      async (tx) => {
        await dispatched.promise;
        const [session] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        cancelPid = session.pid;
        await cancelCredentialBatch(tx, { batchId: id, tenantId: 'tenant-1' });
        cancelWritten.release();
        await commitCancel.promise;
      },
      { timeout: 15_000 },
    );
    const drained = cancelling.catch(() => undefined);
    try {
      await Promise.race([cancelWritten.promise, cancelling]);
      captureFault = true;
      fault.release();
      await Promise.race([faultTransaction.promise, observed]);
      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT ${cancelPid} = ANY(pg_blocking_pids(${faultPid}::int)) AS blocked
        `;
        if (row.blocked) {
          blocked = true;
          break;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(blocked).toBe(true);
      commitCancel.release();
      await cancelling;
      expect((await observed).error?.message).toBe('lost provider response');
      const settled = await getCredentialBatchById(id, 'tenant-1');
      expect(settled).toMatchObject({
        state: 'NEEDS_ATTENTION',
        unknownCount: 1,
        cancelledCount: 1,
        queuedCount: 0,
        processingCount: 0,
        attemptToken: null,
        expiresAt: null,
        items: [expect.objectContaining({ state: 'OUTCOME_UNKNOWN' }), expect.objectContaining({ state: 'CANCELLED' })],
      });
      await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());
      expect(await getCredentialBatchById(id, 'tenant-1')).toEqual(settled);
      expect(await jobsFor(id)).toEqual([]);
      expect(dispatchCount).toBe(1);
    } finally {
      fault.release();
      commitCancel.release();
      await drained;
      await observed;
      await other.$disconnect();
    }
  });

  it('reconciles a cancelled dead attempt without enqueueing and reports CANCELLED from the resolve command', async () => {
    await queue.stop();
    const id = await submit('cancel-dead-worker', [ITEM(0), ITEM(1)], noOpQueue);
    await prisma.$transaction(async (tx) => {
      await claimBatchAttempt(tx, { batchId: id, tenantId: 'tenant-1', token: 'dead-worker', expectedVersion: 0 });
      await claimNextBatchItem(tx, { batchId: id, tenantId: 'tenant-1', token: 'dead-worker' });
      await cancelCredentialBatch(tx, { batchId: id, tenantId: 'tenant-1' });
    });
    await prisma.credentialBatch.update({ where: { id }, data: { lastProgressAt: new Date(0) } });
    const reconcile = credentialBatchReconciliationHandler(defaultCredentialBatchReconciliationDependencies(idleQueue));
    await reconcile({} as never, context());
    const held = await getCredentialBatchById(id, 'tenant-1');
    expect(held).toMatchObject({
      state: 'NEEDS_ATTENTION',
      unknownCount: 1,
      cancelledCount: 1,
      processingCount: 0,
      queuedCount: 0,
      attemptToken: null,
      expiresAt: null,
      items: [expect.objectContaining({ state: 'OUTCOME_UNKNOWN' }), expect.objectContaining({ state: 'CANCELLED' })],
    });
    expect(await jobsFor(id)).toEqual([]);
    await reconcile({} as never, context());
    expect(await getCredentialBatchById(id, 'tenant-1')).toEqual(held);
    const credential = await fakeIssue({ tenantId: 'tenant-1', body: ITEM(0) });
    const args = [
      '--import',
      'tsx',
      'scripts/resolve-credential-batch-item.ts',
      '--tenant',
      'tenant-1',
      '--batch',
      id,
      '--index',
      '0',
      '--version',
      String(held!.version),
      '--issued',
      credential.body.credentialId,
      '--reason',
      'verified library record',
    ];
    const execute = promisify(execFile);
    const dryRun = await execute(process.execPath, [...args, '--dry-run'], {
      env: { ...process.env, LOG_LEVEL: 'warn' },
    });
    expect(dryRun.stdout).toContain('"batchState":"CANCELLED"');
    expect(await getCredentialBatchById(id, 'tenant-1')).toEqual(held);
    const applied = await execute(process.execPath, args, { env: { ...process.env, LOG_LEVEL: 'warn' } });
    expect(applied.stdout).toContain('"batchState":"NEEDS_ATTENTION"');
    expect(applied.stdout).toContain('"batchState":"CANCELLED"');
    const resolved = await getCredentialBatchById(id, 'tenant-1');
    expect(resolved).toMatchObject({
      state: 'CANCELLED',
      issuedCount: 1,
      cancelledCount: 1,
      unknownCount: 0,
      expiresAt: expect.any(Date),
      items: [
        expect.objectContaining({ state: 'ISSUED', credentialId: credential.body.credentialId }),
        expect.objectContaining({ state: 'CANCELLED' }),
      ],
    });
    await expect(execute(process.execPath, args, { env: { ...process.env, LOG_LEVEL: 'warn' } })).rejects.toMatchObject(
      { code: 1 },
    );
    const deps = defaultCredentialBatchIssueDependencies(idleQueue);
    deps.issue = fakeIssue as never;
    await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());
    await reconcile({} as never, context());
    expect(await getCredentialBatchById(id, 'tenant-1')).toEqual(resolved);
    expect(await jobsFor(id)).toEqual([]);
    expect(issueCalls).toHaveLength(1);
  });

  it('issues five items through the real queue in order and settles with ids and counts', async () => {
    // Regression: the worker must process every submitted item in index order and persist each record id.
    const id = await submit(
      'worker-five',
      Array.from({ length: 5 }, (_, index) => ITEM(index)),
    );
    const settled = await waitForBatch(id, CredentialBatchState.COMPLETED);
    expect(settled.issuedCount).toBe(5);
    expect(settled.failedCount).toBe(0);
    expect(settled.items.map((item) => item.index)).toEqual([0, 1, 2, 3, 4]);
    expect(settled.items.map((item) => item.credentialId)).toEqual([
      'worker-credential-0',
      'worker-credential-1',
      'worker-credential-2',
      'worker-credential-3',
      'worker-credential-4',
    ]);
    expect((issueCalls as ReturnType<typeof ITEM>[]).map((item) => item.credentialPayload.index)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it('re-queues a pre-dispatch fault and continues with the next item', async () => {
    // Regression: a pre-dispatch fault must not leave a PROCESSING item or delay an item behind it.
    const id = await submit('worker-fault-release', [ITEM(0), ITEM(1)], noOpQueue);
    const deps = defaultCredentialBatchIssueDependencies(idleQueue);
    let fault = true;
    const decrypt = deps.decryptRequest;
    deps.decryptRequest = (request) => {
      if (fault) {
        fault = false;
        throw new Error('temporary decrypt failure');
      }
      return decrypt(request);
    };
    deps.issue = fakeIssue as never;

    await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());
    await expect(getCredentialBatchById(id, 'tenant-1')).resolves.toMatchObject({
      attemptToken: null,
      queuedCount: 1,
      processingCount: 0,
      issuedCount: 1,
      state: CredentialBatchState.RUNNING,
    });

    await prisma.credentialBatchItem.update({
      where: { batchId_index: { batchId: id, index: 0 } },
      data: { nextAttemptAt: new Date(0) },
    });
    await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());
    await expect(getCredentialBatchById(id, 'tenant-1')).resolves.toMatchObject({
      state: CredentialBatchState.COMPLETED,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 2,
    });
    expect((issueCalls as ReturnType<typeof ITEM>[]).map((item) => item.credentialPayload.index)).toEqual([1, 0]);
  });

  it('lets later items issue before a persistent first-item fault is exhausted', async () => {
    // Regression: per-item backoff must move a faulted item behind never-attempted work in the same batch.
    const id = await submit('worker-item-backoff-order', [ITEM(0), ITEM(1), ITEM(2)], noOpQueue);
    const firstItem = await prisma.credentialBatchItem.findFirstOrThrow({ where: { batchId: id, index: 0 } });
    const deps = defaultCredentialBatchIssueDependencies(noOpQueue);
    const decrypt = deps.decryptRequest;
    deps.decryptRequest = (request) => {
      const body = decrypt(request);
      if (request === firstItem.request) throw new Error('persistent pre-dispatch failure');
      return body;
    };
    deps.issue = fakeIssue as never;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());
      if (attempt < 3) {
        await prisma.credentialBatchItem.update({
          where: { id: firstItem.id },
          data: { nextAttemptAt: new Date(0) },
        });
      }
    }

    await expect(getCredentialBatchById(id, 'tenant-1')).resolves.toMatchObject({
      state: CredentialBatchState.COMPLETED,
      issuedCount: 2,
      failedCount: 1,
      queuedCount: 0,
      processingCount: 0,
      items: expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          state: CredentialBatchItemState.FAILED,
          attemptCount: 4,
          errorClass: 'ITEM_ATTEMPTS_EXHAUSTED',
          errorMessage: 'persistent pre-dispatch failure',
        }),
      ]),
    });
    expect((issueCalls as ReturnType<typeof ITEM>[]).map((item) => item.credentialPayload.index)).toEqual([1, 2]);
  });

  it('marks a post-dispatch fault unknown, then settles NEEDS_ATTENTION on retry', async () => {
    // Regression: a provider may have issued after dispatch, so a retry must not issue the item again.
    const id = await submit('worker-fault-unknown', [ITEM(0), ITEM(1)], noOpQueue);
    const deps = defaultCredentialBatchIssueDependencies(idleQueue);
    let fault = true;
    deps.issue = async (input) => {
      if (fault) {
        fault = false;
        input.onDispatch?.();
        throw new StorageStoreError(429, 'temporary storage response');
      }
      return fakeIssue(input as never) as never;
    };

    await expect(credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context())).rejects.toThrow(
      'temporary storage response',
    );
    await expect(getCredentialBatchById(id, 'tenant-1')).resolves.toMatchObject({
      attemptToken: null,
      queuedCount: 1,
      processingCount: 0,
      issuedCount: 0,
      unknownCount: 1,
      expiresAt: null,
      items: expect.arrayContaining([expect.objectContaining({ state: CredentialBatchItemState.OUTCOME_UNKNOWN })]),
    });

    await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());
    await expect(getCredentialBatchById(id, 'tenant-1')).resolves.toMatchObject({
      state: CredentialBatchState.NEEDS_ATTENTION,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 1,
      unknownCount: 1,
    });
    expect(issueCalls).toHaveLength(1);
    expect((issueCalls[0] as ReturnType<typeof ITEM>).credentialPayload.index).toBe(1);
  });

  it('records one definitive refusal and still settles the remaining items', async () => {
    // Regression: one API-level refusal must become FAILED without stopping later item work.
    const refusing = { ...ITEM(1), credentialPayload: { ...ITEM(1).credentialPayload, refuse: true } };
    const id = await submit('worker-refusal', [ITEM(0), refusing, ITEM(2)]);
    const settled = await waitForBatch(id, CredentialBatchState.COMPLETED);
    expect(settled.issuedCount).toBe(2);
    expect(settled.failedCount).toBe(1);
    expect(settled.items[1]).toMatchObject({
      state: CredentialBatchItemState.FAILED,
      errorClass: 'REFUSED',
      errorMessage: 'item refused by the verifier double',
    });
  });

  it('marks an abandoned processing item unknown and settles NEEDS_ATTENTION without re-issuing it', async () => {
    // Regression: a killed attempt must not replay an external issuance whose record transition was not committed.
    const id = await submit('worker-unknown', [ITEM(0)], noOpQueue);
    await prisma.$transaction(async (tx) => {
      expect(
        await claimBatchAttempt(tx, { batchId: id, tenantId: 'tenant-1', token: 'abandoned', expectedVersion: 0 }),
      ).toEqual({ applied: true });
      expect(await claimNextBatchItem(tx, { batchId: id, tenantId: 'tenant-1', token: 'abandoned' })).toMatchObject({
        outcome: 'claimed',
      });
    });
    await prisma.credentialBatch.update({ where: { id }, data: { lastProgressAt: new Date(0) } });

    const deps = defaultCredentialBatchIssueDependencies(idleQueue);
    deps.issue = fakeIssue as never;
    await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());

    const settled = await getCredentialBatchById(id, 'tenant-1');
    expect(settled).toMatchObject({ state: CredentialBatchState.NEEDS_ATTENTION, unknownCount: 1, expiresAt: null });
    expect(settled?.items[0]).toMatchObject({
      state: CredentialBatchItemState.OUTCOME_UNKNOWN,
      errorClass: 'OUTCOME_UNKNOWN',
      errorMessage: expect.stringContaining('check the library'),
    });
    expect(issueCalls).toHaveLength(0);
  });

  it('commits a continuation job with its progress checkpoint', async () => {
    // Regression: budget exhaustion must enqueue the next delivery in the same transaction as the checkpoint.
    const id = await submit('worker-continuation', [ITEM(0), ITEM(1)], noOpQueue);
    const before = await getCredentialBatchById(id, 'tenant-1');
    const deps = defaultCredentialBatchIssueDependencies(idleQueue);
    deps.issue = fakeIssue as never;
    await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context(5));
    const after = await getCredentialBatchById(id, 'tenant-1');
    const jobs = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      "SELECT count(*)::bigint AS count FROM pgboss.job WHERE name = $1 AND data->>'batchId' = $2",
      CREDENTIAL_BATCH_ISSUE_JOB,
      id,
    );
    expect(after?.lastProgressAt.getTime()).toBeGreaterThan(before?.lastProgressAt.getTime() ?? 0);
    expect(after?.state).toBe(CredentialBatchState.RUNNING);
    expect(Number(jobs[0].count)).toBe(1);
  });

  it('resumes a real continuation and settles the remaining items', async () => {
    // Regression: the second invocation must process the queued remainder after the first checkpoint.
    const id = await submit('worker-resume', [ITEM(0), ITEM(1)], noOpQueue);
    const deps = defaultCredentialBatchIssueDependencies(idleQueue);
    const clock = { now: new Date('2026-09-18T00:00:00.000Z') };
    deps.now = () => new Date(clock.now);
    deps.issue = async (input) => {
      const result = await fakeIssue(input as never);
      if (issueCalls.length === 1) clock.now = new Date(clock.now.getTime() + 7_000);
      return result as never;
    };

    // The shared worker is stopped so this test controls the continuation
    // delivery and can observe the real queue row before resuming it.
    await queue.stop();
    try {
      await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context(8));
      await expect(getCredentialBatchById(id, 'tenant-1')).resolves.toMatchObject({
        state: CredentialBatchState.RUNNING,
        queuedCount: 1,
        issuedCount: 1,
      });
      const jobs = await prisma.$queryRawUnsafe<{ state: string }[]>(
        "SELECT state::text AS state FROM pgboss.job WHERE name = $1 AND data->>'batchId' = $2",
        CREDENTIAL_BATCH_ISSUE_JOB,
        id,
      );
      expect(jobs).toEqual([{ state: 'created' }]);

      await credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context());
      await expect(getCredentialBatchById(id, 'tenant-1')).resolves.toMatchObject({
        state: CredentialBatchState.COMPLETED,
        queuedCount: 0,
        issuedCount: 2,
      });
    } finally {
      await clearJobs();
      await queue.start();
    }
  });

  it('counts a fetched active job as active before reconciliation checks it', async () => {
    // Regression: a job already fetched by pg-boss must not be mistaken for vanished work.
    let fetched!: () => void;
    const fetchedPromise = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    let complete!: () => void;
    const completed = new Promise<void>((resolve) => {
      complete = resolve;
    });
    activeJobRun = { fetched, completed };
    await activeQueue.enqueue(ACTIVE_JOB, { batchId: 'active-batch' });
    await fetchedPromise;
    await expect(activeQueue.hasActiveJob(ACTIVE_JOB, 'active-batch')).resolves.toBe(true);
    complete();
    activeJobRun = undefined;
  });

  it('reconciliation re-enqueues a stalled batch and leaves a batch with a scheduled job alone', async () => {
    // Regression: recovery is for vanished jobs only and never races an active or scheduled delivery.
    const stalledId = await submit('worker-reconcile-stalled', [ITEM(0)], noOpQueue);
    const activeId = await submit('worker-reconcile-active', [ITEM(1)], noOpQueue);
    const old = new Date(Date.now() - 120_000);
    await prisma.credentialBatch.updateMany({
      where: { id: { in: [stalledId, activeId] } },
      data: { lastProgressAt: old },
    });
    await idleQueue.enqueue(
      CREDENTIAL_BATCH_ISSUE_JOB,
      { batchId: activeId, tenantId: 'tenant-1' },
      { startAfter: new Date(Date.now() + 60_000) },
    );

    const deps = defaultCredentialBatchReconciliationDependencies(idleQueue);
    await queue.stop();
    try {
      await credentialBatchReconciliationHandler(deps)({} as never, context());

      const jobs = await prisma.$queryRawUnsafe<{ data: { batchId: string } }[]>(
        "SELECT data FROM pgboss.job WHERE name = $1 AND data->>'batchId' IN ($2, $3)",
        CREDENTIAL_BATCH_ISSUE_JOB,
        stalledId,
        activeId,
      );
      expect(jobs.filter((job) => job.data.batchId === stalledId)).toHaveLength(1);
      expect(jobs.filter((job) => job.data.batchId === activeId)).toHaveLength(1);

      const issueDeps = defaultCredentialBatchIssueDependencies(idleQueue);
      issueDeps.issue = fakeIssue as never;
      await credentialBatchIssueHandler(issueDeps)({ batchId: stalledId, tenantId: 'tenant-1' }, context());
      await expect(getCredentialBatchById(stalledId, 'tenant-1')).resolves.toMatchObject({
        state: CredentialBatchState.COMPLETED,
        issuedCount: 1,
        attemptToken: null,
        items: [expect.objectContaining({ state: CredentialBatchItemState.ISSUED })],
      });
    } finally {
      await clearJobs();
      await queue.start();
    }
  });

  it('releases the ownership fence when cancellation is observed between items', async () => {
    // Regression: an abort at the next item boundary must not leave the previous handler token on the batch.
    const id = await submit('worker-abort-between-items', [ITEM(0), ITEM(1)], noOpQueue);
    const controller = new AbortController();
    const deps = defaultCredentialBatchIssueDependencies(idleQueue);
    deps.issue = async (input) => {
      const result = await fakeIssue(input as never);
      if (issueCalls.length === 1) controller.abort();
      return result as never;
    };

    await expect(
      credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context(60, controller.signal)),
    ).rejects.toThrow();
    await expect(getCredentialBatchById(id, 'tenant-1')).resolves.toMatchObject({
      state: CredentialBatchState.RUNNING,
      attemptToken: null,
      queuedCount: 1,
      processingCount: 0,
      issuedCount: 1,
    });
  });

  it('duplicate delivery is fenced so only one handler issues the item', async () => {
    // Regression: concurrent delivery of one job must not produce two ordinary issuances.
    const id = await submit('worker-duplicate', [ITEM(0)], noOpQueue);
    const deps = defaultCredentialBatchIssueDependencies(idleQueue);
    deps.issue = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return fakeIssue(input as never) as never;
    };
    await Promise.all([
      credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context()),
      credentialBatchIssueHandler(deps)({ batchId: id, tenantId: 'tenant-1' }, context()),
    ]);
    expect(issueCalls).toHaveLength(1);
    await expect(getCredentialBatchById(id, 'tenant-1')).resolves.toMatchObject({
      state: CredentialBatchState.COMPLETED,
      issuedCount: 1,
    });
  });
});
