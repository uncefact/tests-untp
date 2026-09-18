import { createRigClient, truncateApplicationTables } from './rig/db';
import { CredentialBatchItemState, CredentialBatchState, LibraryRecordOrigin } from '../../src/lib/prisma/generated';
import {
  CREDENTIAL_BATCH_ISSUE_ENQUEUE_OPTIONS,
  CredentialBatchAttemptFenceLostError,
  claimBatchAttempt,
  claimNextBatchItem,
  createCredentialBatch,
  expireDueCredentialBatches,
  findCredentialBatchSubmission,
  getCredentialBatchById,
  getCredentialBatchItemForInspection,
  markItemFailed,
  markItemIssued,
  markItemOutcomeUnknown,
  recordKnownCredentialId,
  releaseBatchAttempt,
  resolveUnknownBatchItem,
  settleBatchIfFinished,
  type BatchSubmissionResult,
} from '../../src/lib/prisma/repositories/credential-batch.repository';
import { projectCredentialBatch } from '../../src/lib/credentials/credential-batch-projection';
import { CREDENTIAL_BATCH_ISSUE_JOB } from '../../src/lib/jobs/queue-names';
import type { JobQueue } from '../../src/lib/jobs/types';
import { PgBossJobQueue } from '../../src/lib/jobs/pg-boss-job-queue';
import { getEncryptionService } from '../../src/lib/encryption/encryption';

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.BATCH_RETENTION_DAYS = '1';

const prisma = createRigClient();
const quiet = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quiet,
};

const ITEM = {
  credentialPayload: { issuer: { id: 'did:web:issuer.example' } },
  credentialType: 'DigitalProductPassport',
  version: '0.6.0',
};

describe('credential batch persistence and progression', () => {
  const queueErrors: Error[] = [];
  const queue = new PgBossJobQueue({
    connectionString: process.env.RI_DATABASE_URL as string,
    onError: (error) => queueErrors.push(error),
  });

  async function clearBatchJobs(): Promise<void> {
    await prisma.$executeRawUnsafe('DELETE FROM pgboss.job WHERE name = $1', CREDENTIAL_BATCH_ISSUE_JOB);
  }

  function createdBatchId(result: BatchSubmissionResult): string {
    if (result.outcome !== 'created') throw new Error('expected a newly created batch fixture');
    return result.batchId;
  }

  async function submit(key: string, digest: string, items = [ITEM], selectedQueue: JobQueue = queue) {
    return createCredentialBatch({
      tenantId: 'tenant-1',
      idempotencyKey: key,
      bodyDigest: digest,
      items,
      queue: selectedQueue,
    });
  }

  async function unknownBatch(key: string, itemCount = 1): Promise<{ batchId: string; settledAt: Date }> {
    const created = await submit(
      key,
      `digest-${key}`,
      Array.from({ length: itemCount }, () => ITEM),
    );
    const batchId = createdBatchId(created);
    const settledAt = new Date('2026-09-17T01:00:00.000Z');
    await prisma.credentialBatchItem.updateMany({
      where: { batchId },
      data: {
        state: CredentialBatchItemState.OUTCOME_UNKNOWN,
        errorClass: 'OUTCOME_UNKNOWN',
        errorMessage: 'check the library',
        attemptToken: null,
      },
    });
    await prisma.credentialBatch.update({
      where: { id: batchId },
      data: {
        state: CredentialBatchState.NEEDS_ATTENTION,
        queuedCount: 0,
        processingCount: 0,
        issuedCount: 0,
        failedCount: 0,
        unknownCount: itemCount,
        settledAt,
        resolvedAt: null,
        expiresAt: null,
        version: 7,
      },
    });
    return { batchId, settledAt };
  }

  async function nativeCredential(id: string, tenantId = 'tenant-1'): Promise<void> {
    await prisma.libraryRecord.create({
      data: {
        id,
        tenantId,
        origin: LibraryRecordOrigin.NATIVE,
        credentialType: 'DigitalProductPassport',
        credential: {
          create: {
            storageUri: `https://storage.example/${id}`,
            digestMultibase: `z${id}`,
          },
        },
      },
    });
  }

  beforeAll(async () => {
    await queue.start();
    await queue.declareQueue(CREDENTIAL_BATCH_ISSUE_JOB);
  });

  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await clearBatchJobs();
    await prisma.tenant.createMany({
      data: [
        { id: 'tenant-1', name: 'Tenant One' },
        { id: 'tenant-2', name: 'Tenant Two' },
      ],
    });
  });

  afterEach(async () => {
    await clearBatchJobs();
    expect(queueErrors.splice(0)).toEqual([]);
  });

  afterAll(async () => {
    await queue.stop();
    await prisma.$disconnect();
  });

  it('commits the batch, encrypted items and one job together, and rolls all back together', async () => {
    const created = await submit('atomic-key', 'digest-atomic', [ITEM, ITEM]);
    expect(created).toEqual({ outcome: 'created', batchId: expect.any(String) });
    const batchId = created.outcome === 'created' ? created.batchId : '';

    const batch = await prisma.credentialBatch.findUnique({ where: { id: batchId }, include: { items: true } });
    expect(batch).toMatchObject({
      id: batchId,
      tenantId: 'tenant-1',
      state: CredentialBatchState.QUEUED,
      itemCount: 2,
      queuedCount: 2,
      processingCount: 0,
      issuedCount: 0,
      failedCount: 0,
      unknownCount: 0,
    });
    expect(batch?.items).toHaveLength(2);
    expect(batch?.items.map((item) => item.index)).toEqual([0, 1]);
    expect(batch?.items[0].request).not.toContain(JSON.stringify(ITEM));
    expect(JSON.parse(getEncryptionService().decrypt(JSON.parse(batch?.items[0].request as string)))).toEqual(ITEM);

    const jobs = await prisma.$queryRawUnsafe<{ data: Record<string, unknown> }[]>(
      'SELECT data FROM pgboss.job WHERE name = $1',
      CREDENTIAL_BATCH_ISSUE_JOB,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toEqual({ batchId, tenantId: 'tenant-1' });

    const failingQueue = {
      enqueueWithin: async (
        tx: Parameters<NonNullable<JobQueue['enqueueWithin']>>[0],
        name: string,
        payload: { batchId: string; tenantId: string },
        options: typeof CREDENTIAL_BATCH_ISSUE_ENQUEUE_OPTIONS,
      ) => {
        await queue.enqueueWithin(tx, name, payload, options);
        throw new Error('rollback after queue insertion');
      },
    } as unknown as JobQueue;
    await expect(submit('rollback-key', 'digest-rollback', [ITEM], failingQueue)).rejects.toThrow(
      'rollback after queue insertion',
    );
    expect(await prisma.credentialBatch.count({ where: { idempotencyKey: 'rollback-key' } })).toBe(0);
    const rollbackJobs = await prisma.$queryRawUnsafe<{ data: Record<string, unknown> }[]>(
      "SELECT data FROM pgboss.job WHERE name = $1 AND data->>'tenantId' = $2",
      CREDENTIAL_BATCH_ISSUE_JOB,
      'tenant-1',
    );
    expect(rollbackJobs).toEqual([{ data: { batchId, tenantId: 'tenant-1' } }]);
  });

  it('commits the maximum batch size while encryption happens outside the transaction budget', async () => {
    const startedAt = Date.now();
    const created = await submit(
      'maximum-size-key',
      'digest-maximum-size',
      Array.from({ length: 500 }, () => ITEM),
    );

    expect(created).toEqual({ outcome: 'created', batchId: expect.any(String) });
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    if (created.outcome !== 'created') throw new Error('expected a newly created maximum-size batch');
    await expect(prisma.credentialBatchItem.count({ where: { batchId: created.batchId } })).resolves.toBe(500);
  });

  it('rejects a raw count movement that does not preserve the batch item-count invariant', async () => {
    const created = await submit('count-check-key', 'digest-count-check');
    if (created.outcome !== 'created') throw new Error('expected a newly created count-check batch');

    await expect(
      prisma.$executeRawUnsafe(
        'UPDATE "CredentialBatch" SET "issuedCount" = "issuedCount" + 1 WHERE "id" = $1',
        created.batchId,
      ),
    ).rejects.toThrow();
    await expect(prisma.credentialBatch.findUnique({ where: { id: created.batchId } })).resolves.toMatchObject({
      queuedCount: 1,
      issuedCount: 0,
    });
  });

  it('rejects a credential from another tenant on batch-item insert and update', async () => {
    // Regression: the item credential relation must enforce the tenant boundary in Postgres, not only in Prisma queries.
    const created = await submit('credential-tenant-fk-key', 'digest-credential-tenant-fk');
    if (created.outcome !== 'created') throw new Error('expected a newly created credential tenant-fk batch');
    const foreignCredentialId = 'foreign-tenant-credential';
    await prisma.libraryRecord.create({
      data: {
        id: foreignCredentialId,
        tenantId: 'tenant-2',
        origin: LibraryRecordOrigin.NATIVE,
        credentialType: 'DigitalProductPassport',
        credential: {
          create: {
            storageUri: 'https://storage.example/foreign-tenant-credential',
            digestMultibase: 'zForeignTenantCredential',
          },
        },
      },
    });
    const existingItem = await prisma.credentialBatchItem.findFirstOrThrow({ where: { batchId: created.batchId } });

    await expect(
      prisma.$executeRawUnsafe(
        'INSERT INTO "CredentialBatchItem" ("id", "batchId", "tenantId", "index", "state", "request", "credentialId", "updatedAt") VALUES ($1, $2, $3, $4, \'QUEUED\', $5, $6, $7)',
        'foreign-tenant-insert-item',
        created.batchId,
        'tenant-1',
        1,
        existingItem.request,
        foreignCredentialId,
        new Date(),
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        'UPDATE "CredentialBatchItem" SET "credentialId" = $1 WHERE "batchId" = $2 AND "index" = $3',
        foreignCredentialId,
        created.batchId,
        0,
      ),
    ).rejects.toThrow();
    await expect(prisma.credentialBatchItem.findFirst({ where: { batchId: created.batchId } })).resolves.toMatchObject({
      credentialId: null,
    });
  });

  it('records a known credential id only on an outcome-unknown item', async () => {
    // Regression: a late provider result must enrich OUTCOME_UNKNOWN, but must not overwrite an item still owned by another attempt.
    const unknown = await unknownBatch('record-known-credential-id-key');
    await nativeCredential('known-after-fence-credential');
    await expect(
      prisma.$transaction((tx) =>
        recordKnownCredentialId(tx, {
          batchId: unknown.batchId,
          tenantId: 'tenant-1',
          index: 0,
          credentialId: 'known-after-fence-credential',
        }),
      ),
    ).resolves.toEqual({ applied: true });
    await expect(
      prisma.credentialBatchItem.findFirst({ where: { batchId: unknown.batchId, index: 0 } }),
    ).resolves.toMatchObject({
      state: CredentialBatchItemState.OUTCOME_UNKNOWN,
      credentialId: 'known-after-fence-credential',
    });

    const processing = await submit('record-known-processing-key', 'digest-record-known-processing');
    const processingId = createdBatchId(processing);
    await prisma.$transaction(async (tx) => {
      expect(
        await claimBatchAttempt(tx, {
          batchId: processingId,
          tenantId: 'tenant-1',
          token: 'foreign-attempt-token',
          expectedVersion: 0,
        }),
      ).toEqual({ applied: true });
      expect(
        await claimNextBatchItem(tx, {
          batchId: processingId,
          tenantId: 'tenant-1',
          token: 'foreign-attempt-token',
        }),
      ).toMatchObject({ outcome: 'claimed', item: { index: 0 } });
    });
    const before = await prisma.credentialBatchItem.findFirstOrThrow({ where: { batchId: processingId, index: 0 } });
    await expect(
      prisma.$transaction((tx) =>
        recordKnownCredentialId(tx, {
          batchId: processingId,
          tenantId: 'tenant-1',
          index: 0,
          credentialId: 'must-not-overwrite-processing-item',
        }),
      ),
    ).resolves.toEqual({ applied: false });
    await expect(
      prisma.credentialBatchItem.findFirstOrThrow({ where: { batchId: processingId, index: 0 } }),
    ).resolves.toEqual(before);
  });

  it('resolves unknown items through every fenced branch and retains unresolved evidence', async () => {
    const known = await unknownBatch('resolve-known-id-key');
    await nativeCredential('late-worker-credential');
    const inspected = await prisma.credentialBatch.findUniqueOrThrow({ where: { id: known.batchId } });
    await expect(
      prisma.$transaction((tx) =>
        recordKnownCredentialId(tx, {
          batchId: known.batchId,
          tenantId: 'tenant-1',
          index: 0,
          credentialId: 'late-worker-credential',
        }),
      ),
    ).resolves.toEqual({ applied: true });
    await expect(prisma.credentialBatch.findUniqueOrThrow({ where: { id: known.batchId } })).resolves.toMatchObject({
      version: inspected.version + 1,
      lastProgressAt: expect.any(Date),
    });
    await expect(
      prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          tenantId: 'tenant-1',
          batchId: known.batchId,
          index: 0,
          expectedVersion: inspected.version,
          resolution: { state: 'FAILED', evidence: 'stale resolution' },
          reason: 'late-worker race',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'version-mismatch' });
    const currentKnown = await prisma.credentialBatch.findUniqueOrThrow({ where: { id: known.batchId } });
    await expect(
      prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          tenantId: 'tenant-1',
          batchId: known.batchId,
          index: 0,
          expectedVersion: currentKnown.version,
          resolution: { state: 'FAILED', evidence: 'credential already recorded' },
          reason: 'late-worker race re-inspection',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'credential-recorded' });
    await expect(
      prisma.credentialBatchItem.findFirstOrThrow({ where: { batchId: known.batchId, index: 0 } }),
    ).resolves.toMatchObject({
      credentialId: 'late-worker-credential',
      state: CredentialBatchItemState.OUTCOME_UNKNOWN,
    });
    await expect(
      prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          tenantId: 'tenant-1',
          batchId: known.batchId,
          index: 0,
          expectedVersion: currentKnown.version,
          resolution: { state: 'ISSUED', credentialId: 'late-worker-credential' },
          reason: 'late-worker credential confirmed',
        }),
      ),
    ).resolves.toMatchObject({
      outcome: 'applied',
      after: {
        batchState: CredentialBatchState.COMPLETED,
        itemState: CredentialBatchItemState.ISSUED,
        credentialId: 'late-worker-credential',
      },
    });
    await expect(prisma.credentialBatch.findUniqueOrThrow({ where: { id: known.batchId } })).resolves.toMatchObject({
      state: CredentialBatchState.COMPLETED,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 1,
      failedCount: 0,
      unknownCount: 0,
      settledAt: expect.any(Date),
    });
    await expect(
      prisma.credentialBatchItem.findFirstOrThrow({ where: { batchId: known.batchId, index: 0 } }),
    ).resolves.toMatchObject({
      state: CredentialBatchItemState.ISSUED,
      credentialId: 'late-worker-credential',
    });

    const notSettled = await submit('resolve-not-settled-key', 'digest-resolve-not-settled');
    const notSettledId = createdBatchId(notSettled);
    await expect(
      prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          tenantId: 'tenant-1',
          batchId: notSettledId,
          index: 0,
          expectedVersion: 7,
          resolution: { state: 'FAILED', evidence: 'ticket/not-settled' },
          reason: 'branch coverage',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'not-settled' });

    const notUnknown = await unknownBatch('resolve-not-unknown-key');
    await prisma.credentialBatchItem.updateMany({
      where: { batchId: notUnknown.batchId, index: 0 },
      data: { state: CredentialBatchItemState.FAILED },
    });
    await expect(
      prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          tenantId: 'tenant-1',
          batchId: notUnknown.batchId,
          index: 0,
          expectedVersion: 7,
          resolution: { state: 'FAILED', evidence: 'ticket/not-unknown' },
          reason: 'branch coverage',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'not-unknown' });

    const versionMismatch = await unknownBatch('resolve-version-key');
    await expect(
      prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          tenantId: 'tenant-1',
          batchId: versionMismatch.batchId,
          index: 0,
          expectedVersion: 6,
          resolution: { state: 'FAILED', evidence: 'ticket/version' },
          reason: 'branch coverage',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'version-mismatch', before: { batchVersion: 7 } });

    const foreignCredential = 'resolve-foreign-credential';
    await nativeCredential(foreignCredential, 'tenant-2');
    const foreign = await unknownBatch('resolve-foreign-key');
    await expect(
      prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          tenantId: 'tenant-1',
          batchId: foreign.batchId,
          index: 0,
          expectedVersion: 7,
          resolution: { state: 'ISSUED', credentialId: foreignCredential },
          reason: 'branch coverage',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'credential-not-found' });

    const missingEvidence = await unknownBatch('resolve-evidence-key');
    await expect(
      prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          tenantId: 'tenant-1',
          batchId: missingEvidence.batchId,
          index: 0,
          expectedVersion: 7,
          resolution: { state: 'FAILED', evidence: '  ' },
          reason: 'branch coverage',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'evidence-missing' });

    const missingReason = await unknownBatch('resolve-reason-key');
    await expect(
      prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          tenantId: 'tenant-1',
          batchId: missingReason.batchId,
          index: 0,
          expectedVersion: 7,
          resolution: { state: 'FAILED', evidence: 'ticket/reason' },
          reason: '  ',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'reason-missing' });

    const failed = await unknownBatch('resolve-failed-key', 2);
    await expect(
      prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          tenantId: 'tenant-1',
          batchId: failed.batchId,
          index: 0,
          expectedVersion: 7,
          resolution: { state: 'FAILED', evidence: 'ticket/failed-credential' },
          reason: 'provider confirmed no credential was stored',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'applied', after: { batchState: CredentialBatchState.NEEDS_ATTENTION } });
    await expect(
      prisma.credentialBatch.findUnique({ where: { id: failed.batchId }, include: { items: true } }),
    ).resolves.toMatchObject({
      state: CredentialBatchState.NEEDS_ATTENTION,
      unknownCount: 1,
      failedCount: 1,
      resolvedAt: null,
      expiresAt: null,
      items: expect.arrayContaining([
        expect.objectContaining({
          state: CredentialBatchItemState.FAILED,
          credentialId: null,
          errorClass: 'OPERATOR_CONFIRMED_FAILED',
          errorMessage: 'ticket/failed-credential',
          resolutionReason: 'provider confirmed no credential was stored',
          resolvedAt: expect.any(Date),
        }),
      ]),
    });
    const failedBatch = await getCredentialBatchById(failed.batchId, 'tenant-1');
    if (failedBatch === null) throw new Error('expected the resolved failed batch to remain readable');
    expect(projectCredentialBatch(failedBatch).items).toEqual(
      expect.arrayContaining([
        {
          index: 0,
          state: CredentialBatchItemState.FAILED,
          error: {
            code: 'OPERATOR_CONFIRMED_FAILED',
            message: 'An operator confirmed this item was not issued.',
          },
        },
      ]),
    );

    const issuedCredential = 'resolve-issued-credential';
    await nativeCredential(issuedCredential);
    const resolved = await unknownBatch('resolve-issued-key');
    const beforeResolve = await prisma.credentialBatch.findUniqueOrThrow({ where: { id: resolved.batchId } });
    const resolution = await prisma.$transaction((tx) =>
      resolveUnknownBatchItem(tx, {
        tenantId: 'tenant-1',
        batchId: resolved.batchId,
        index: 0,
        expectedVersion: 7,
        resolution: { state: 'ISSUED', credentialId: issuedCredential },
        reason: 'library record confirmed',
      }),
    );
    expect(resolution).toMatchObject({ outcome: 'applied', after: { batchState: CredentialBatchState.COMPLETED } });
    const afterResolve = await prisma.credentialBatch.findUniqueOrThrow({ where: { id: resolved.batchId } });
    expect(afterResolve).toMatchObject({
      state: CredentialBatchState.COMPLETED,
      unknownCount: 0,
      issuedCount: 1,
      settledAt: beforeResolve.settledAt,
    });
    expect(afterResolve.resolvedAt).not.toBeNull();
    await expect(
      prisma.credentialBatchItem.findFirstOrThrow({ where: { batchId: resolved.batchId, index: 0 } }),
    ).resolves.toMatchObject({
      resolutionReason: 'library record confirmed',
      resolvedAt: expect.any(Date),
    });
    await expect(
      prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          tenantId: 'tenant-1',
          batchId: resolved.batchId,
          index: 0,
          expectedVersion: afterResolve.version,
          resolution: { state: 'FAILED', evidence: 'must not change issued item' },
          reason: 'settled item re-inspection',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'not-unknown' });
    expect(afterResolve.expiresAt?.getTime()).toBe(afterResolve.resolvedAt!.getTime() + 24 * 60 * 60 * 1_000);
    await expect(expireDueCredentialBatches(new Date(afterResolve.expiresAt!.getTime() + 1))).resolves.toBe(2);
    await expect(prisma.credentialBatchItem.count({ where: { batchId: resolved.batchId } })).resolves.toBe(0);
    await expect(prisma.credentialBatchItem.count({ where: { batchId: known.batchId } })).resolves.toBe(0);

    const held = await unknownBatch('resolve-held-key');
    await expect(expireDueCredentialBatches(new Date('2027-01-01T00:00:00.000Z'))).resolves.toBe(0);
    await expect(prisma.credentialBatch.findUnique({ where: { id: held.batchId } })).resolves.toMatchObject({
      state: CredentialBatchState.NEEDS_ATTENTION,
      expiresAt: null,
    });
    await expect(prisma.credentialBatchItem.count({ where: { batchId: held.batchId } })).resolves.toBe(1);
  });

  it('reads found, missing and foreign items through the tenant-scoped inspection store', async () => {
    const created = await submit('inspection-store-key', 'digest-inspection-store');
    const batchId = createdBatchId(created);
    const found = await getCredentialBatchItemForInspection(batchId, 'tenant-1', 0);
    expect(found).toMatchObject({
      tenantId: 'tenant-1',
      batchId,
      index: 0,
      batchState: CredentialBatchState.QUEUED,
      batchVersion: 0,
      requestDigest: 'digest-inspection-store',
      itemState: CredentialBatchItemState.QUEUED,
    });
    expect(found?.encryptedRequest).not.toContain(JSON.stringify(ITEM));
    await expect(getCredentialBatchItemForInspection(batchId, 'tenant-2', 0)).resolves.toBeNull();
    await expect(getCredentialBatchItemForInspection(batchId, 'tenant-1', 99)).resolves.toBeNull();
  });

  it('expires only due settled batches, deletes their items and keeps the tombstone readable', async () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    const due = await submit('expiry-due-key', 'digest-expiry-due');
    const notDue = await submit('expiry-not-due-key', 'digest-expiry-not-due');
    const running = await submit('expiry-running-key', 'digest-expiry-running');
    const needsAttention = await submit('expiry-needs-attention-key', 'digest-expiry-needs-attention');
    if (
      due.outcome !== 'created' ||
      notDue.outcome !== 'created' ||
      running.outcome !== 'created' ||
      needsAttention.outcome !== 'created'
    ) {
      throw new Error('expected expiry fixtures to be newly created');
    }
    const settledAt = new Date('2026-09-16T12:00:00.000Z');
    const dueExpiresAt = new Date('2026-09-17T11:00:00.000Z');
    const futureExpiresAt = new Date('2026-09-18T11:00:00.000Z');
    await prisma.credentialBatchItem.updateMany({
      where: { batchId: needsAttention.batchId },
      data: {
        // Regression: the expiry sweep must not expire a due NEEDS_ATTENTION batch.
        state: CredentialBatchItemState.OUTCOME_UNKNOWN,
        errorClass: 'OUTCOME_UNKNOWN',
        errorMessage: 'check the library',
        attemptToken: null,
      },
    });
    await prisma.credentialBatch.update({
      where: { id: due.batchId },
      data: {
        state: CredentialBatchState.COMPLETED,
        queuedCount: 0,
        issuedCount: 1,
        settledAt,
        expiresAt: dueExpiresAt,
      },
    });
    await prisma.credentialBatch.update({
      where: { id: notDue.batchId },
      data: {
        state: CredentialBatchState.COMPLETED,
        queuedCount: 0,
        issuedCount: 1,
        settledAt,
        expiresAt: futureExpiresAt,
      },
    });
    await prisma.credentialBatch.update({
      where: { id: running.batchId },
      data: {
        state: CredentialBatchState.RUNNING,
        settledAt: null,
        expiresAt: null,
      },
    });
    await prisma.credentialBatch.update({
      where: { id: needsAttention.batchId },
      data: {
        state: CredentialBatchState.NEEDS_ATTENTION,
        queuedCount: 0,
        unknownCount: 1,
        settledAt,
        expiresAt: dueExpiresAt,
      },
    });
    const before = await prisma.credentialBatch.findUnique({ where: { id: due.batchId } });

    await expect(expireDueCredentialBatches(now)).resolves.toBe(1);

    await expect(prisma.credentialBatch.findUnique({ where: { id: due.batchId } })).resolves.toMatchObject({
      id: due.batchId,
      tenantId: 'tenant-1',
      idempotencyKey: 'expiry-due-key',
      bodyDigest: 'digest-expiry-due',
      state: CredentialBatchState.EXPIRED,
      itemCount: 1,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 1,
      failedCount: 0,
      unknownCount: 0,
      createdAt: before?.createdAt,
      settledAt,
      expiresAt: dueExpiresAt,
    });
    await expect(getCredentialBatchById(due.batchId, 'tenant-1')).resolves.toMatchObject({
      id: due.batchId,
      state: CredentialBatchState.EXPIRED,
      items: [],
    });
    await expect(prisma.credentialBatch.findUnique({ where: { id: notDue.batchId } })).resolves.toMatchObject({
      state: CredentialBatchState.COMPLETED,
    });
    await expect(prisma.credentialBatchItem.count({ where: { batchId: notDue.batchId } })).resolves.toBe(1);
    await expect(prisma.credentialBatch.findUnique({ where: { id: running.batchId } })).resolves.toMatchObject({
      state: CredentialBatchState.RUNNING,
    });
    await expect(prisma.credentialBatchItem.count({ where: { batchId: running.batchId } })).resolves.toBe(1);
    await expect(prisma.credentialBatch.findUnique({ where: { id: needsAttention.batchId } })).resolves.toMatchObject({
      state: CredentialBatchState.NEEDS_ATTENTION,
      expiresAt: dueExpiresAt,
    });
    await expect(prisma.credentialBatchItem.count({ where: { batchId: needsAttention.batchId } })).resolves.toBe(1);
    await expect(expireDueCredentialBatches(now)).resolves.toBe(0);
  });

  it('expires 150 due batches in bounded ordered passes and returns the total', async () => {
    // Regression: one transaction must not load an unbounded retention backlog or report only its first page.
    const expiresAt = new Date('2026-09-17T11:00:00.000Z');
    const settledAt = new Date('2026-09-16T12:00:00.000Z');
    await prisma.credentialBatch.createMany({
      data: Array.from({ length: 150 }, (_, index) => ({
        id: `expiry-bounded-${index}`,
        tenantId: 'tenant-1',
        state: CredentialBatchState.COMPLETED,
        itemCount: 0,
        idempotencyKey: `expiry-bounded-key-${index}`,
        bodyDigest: `expiry-bounded-digest-${index}`,
        settledAt,
        expiresAt,
      })),
    });

    await expect(expireDueCredentialBatches(new Date('2026-09-17T12:00:00.000Z'))).resolves.toBe(150);
    await expect(
      prisma.credentialBatch.count({
        where: { state: CredentialBatchState.EXPIRED, id: { startsWith: 'expiry-bounded-' } },
      }),
    ).resolves.toBe(150);
  });

  it('returns every settleBatchIfFinished branch from a distinct Postgres fixture', async () => {
    await expect(
      prisma.$transaction((tx) =>
        settleBatchIfFinished(tx, { batchId: 'missing-batch', tenantId: 'tenant-1', token: 'missing-token' }),
      ),
    ).resolves.toEqual({ outcome: 'missing' });

    const alreadySettled = await submit('settle-already-key', 'digest-settle-already');
    const queuedNotReady = await submit('settle-queued-key', 'digest-settle-queued');
    const processingNotReady = await submit('settle-processing-key', 'digest-settle-processing');
    const superseded = await submit('settle-superseded-key', 'digest-settle-superseded');
    const applied = await submit('settle-applied-key', 'digest-settle-applied');
    const alreadySettledId = createdBatchId(alreadySettled);
    const queuedNotReadyId = createdBatchId(queuedNotReady);
    const processingNotReadyId = createdBatchId(processingNotReady);
    const supersededId = createdBatchId(superseded);
    const appliedId = createdBatchId(applied);

    await prisma.credentialBatch.update({
      where: { id: alreadySettledId },
      data: { state: CredentialBatchState.COMPLETED, queuedCount: 0, issuedCount: 1 },
    });
    await expect(
      prisma.$transaction((tx) =>
        settleBatchIfFinished(tx, { batchId: alreadySettledId, tenantId: 'tenant-1', token: 'already-token' }),
      ),
    ).resolves.toEqual({ outcome: 'already-settled' });

    await expect(
      prisma.$transaction((tx) =>
        settleBatchIfFinished(tx, { batchId: queuedNotReadyId, tenantId: 'tenant-1', token: 'queued-token' }),
      ),
    ).resolves.toEqual({ outcome: 'not-ready' });

    await prisma.$transaction(async (tx) => {
      expect(
        await claimBatchAttempt(tx, {
          batchId: processingNotReadyId,
          tenantId: 'tenant-1',
          token: 'processing-not-ready',
          expectedVersion: 0,
        }),
      ).toEqual({ applied: true });
      expect(
        await claimNextBatchItem(tx, {
          batchId: processingNotReadyId,
          tenantId: 'tenant-1',
          token: 'processing-not-ready',
        }),
      ).toMatchObject({
        outcome: 'claimed',
      });
      await expect(
        settleBatchIfFinished(tx, {
          batchId: processingNotReadyId,
          tenantId: 'tenant-1',
          token: 'processing-not-ready',
        }),
      ).resolves.toEqual({
        outcome: 'not-ready',
      });
    });

    for (const batchId of [supersededId, appliedId]) {
      await prisma.credentialBatch.update({
        where: { id: batchId },
        data: { state: CredentialBatchState.RUNNING, queuedCount: 0, issuedCount: 1, attemptToken: 'settle-token' },
      });
    }
    await prisma.$transaction(async (tx) => {
      const wrappedTx = {
        credentialBatch: {
          findFirst: async (...args: Parameters<typeof tx.credentialBatch.findFirst>) => {
            const found = await tx.credentialBatch.findFirst(...args);
            if (found !== null) {
              await prisma.$executeRawUnsafe(
                'UPDATE "CredentialBatch" SET "version" = "version" + 1 WHERE "id" = $1',
                supersededId,
              );
            }
            return found;
          },
          updateMany: tx.credentialBatch.updateMany.bind(tx.credentialBatch),
        },
      } as unknown as Parameters<typeof settleBatchIfFinished>[0];
      await expect(
        settleBatchIfFinished(wrappedTx, { batchId: supersededId, tenantId: 'tenant-1', token: 'settle-token' }),
      ).resolves.toEqual({ outcome: 'superseded' });
    });

    await expect(
      prisma.$transaction((tx) =>
        settleBatchIfFinished(tx, { batchId: appliedId, tenantId: 'tenant-1', token: 'settle-token' }),
      ),
    ).resolves.toMatchObject({ outcome: 'applied', state: CredentialBatchState.COMPLETED });
  });

  it('returns tenant-fenced missing or zero-row outcomes without changing a row', async () => {
    const queued = await submit('foreign-queued-key', 'digest-foreign-queued');
    const issued = await submit('foreign-issued-key', 'digest-foreign-issued');
    const failed = await submit('foreign-failed-key', 'digest-foreign-failed');
    const unknown = await submit('foreign-unknown-key', 'digest-foreign-unknown');
    const release = await submit('foreign-release-key', 'digest-foreign-release');
    const queuedId = createdBatchId(queued);
    const issuedId = createdBatchId(issued);
    const failedId = createdBatchId(failed);
    const unknownId = createdBatchId(unknown);
    const releaseId = createdBatchId(release);

    async function prepareProcessing(batchId: string, token: string): Promise<void> {
      await prisma.$transaction(async (tx) => {
        expect(await claimBatchAttempt(tx, { batchId, tenantId: 'tenant-1', token, expectedVersion: 0 })).toEqual({
          applied: true,
        });
        expect(await claimNextBatchItem(tx, { batchId, tenantId: 'tenant-1', token })).toMatchObject({
          outcome: 'claimed',
        });
      });
    }
    await prepareProcessing(issuedId, 'issued-attempt');
    await prepareProcessing(failedId, 'failed-attempt');
    await prepareProcessing(unknownId, 'unknown-attempt');
    await prepareProcessing(releaseId, 'release-attempt');

    expect(
      await prisma.credentialBatch.findUnique({ where: { id: queuedId }, include: { items: true } }),
    ).toMatchObject({
      queuedCount: 1,
      items: [{ state: CredentialBatchItemState.QUEUED }],
    });
    await expect(
      prisma.$transaction((tx) =>
        claimBatchAttempt(tx, { batchId: queuedId, tenantId: 'tenant-2', token: 'wrong', expectedVersion: 0 }),
      ),
    ).resolves.toEqual({ applied: false });
    await expect(
      prisma.$transaction((tx) => claimNextBatchItem(tx, { batchId: queuedId, tenantId: 'tenant-2', token: 'wrong' })),
    ).resolves.toEqual({ outcome: 'empty' });
    await expect(
      prisma.$transaction((tx) =>
        settleBatchIfFinished(tx, { batchId: queuedId, tenantId: 'tenant-2', token: 'wrong' }),
      ),
    ).resolves.toEqual({ outcome: 'missing' });

    await expect(
      prisma.$transaction((tx) =>
        releaseBatchAttempt(tx, { batchId: releaseId, tenantId: 'tenant-2', token: 'release-attempt' }),
      ),
    ).resolves.toEqual({ applied: false });
    await expect(
      prisma.$transaction((tx) =>
        markItemIssued(tx, {
          batchId: issuedId,
          tenantId: 'tenant-2',
          index: 0,
          token: 'wrong',
          credentialId: 'foreign-credential',
        }),
      ),
    ).resolves.toEqual({ outcome: 'missing' });
    await expect(
      prisma.$transaction((tx) =>
        markItemFailed(tx, {
          batchId: failedId,
          tenantId: 'tenant-2',
          index: 0,
          token: 'wrong',
          errorClass: 'FOREIGN',
          errorMessage: 'must not write',
        }),
      ),
    ).resolves.toEqual({ outcome: 'missing' });
    await expect(
      prisma.$transaction((tx) =>
        markItemOutcomeUnknown(tx, {
          batchId: unknownId,
          tenantId: 'tenant-2',
          index: 0,
          token: 'wrong',
          errorClass: 'FOREIGN',
          errorMessage: 'must not write',
        }),
      ),
    ).resolves.toEqual({ outcome: 'missing' });

    for (const batchId of [queuedId, issuedId, failedId, unknownId, releaseId]) {
      await expect(
        prisma.credentialBatch.findUnique({ where: { id: batchId }, include: { items: true } }),
      ).resolves.toMatchObject({
        tenantId: 'tenant-1',
      });
    }
    await expect(prisma.credentialBatchItem.findFirst({ where: { batchId: issuedId } })).resolves.toMatchObject({
      state: CredentialBatchItemState.PROCESSING,
      credentialId: null,
    });
    await expect(prisma.credentialBatchItem.findFirst({ where: { batchId: failedId } })).resolves.toMatchObject({
      state: CredentialBatchItemState.PROCESSING,
      errorClass: null,
    });
    await expect(prisma.credentialBatchItem.findFirst({ where: { batchId: unknownId } })).resolves.toMatchObject({
      state: CredentialBatchItemState.PROCESSING,
      errorClass: null,
    });
  });

  it('repairs a processing item left under a released token when a new attempt claims the batch', async () => {
    // Regression: older fault handling could clear the batch token while leaving its item PROCESSING forever.
    const created = await submit('released-token-repair-key', 'digest-released-token-repair');
    if (created.outcome !== 'created') throw new Error('expected a newly created released-token repair batch');

    await prisma.$transaction(async (tx) => {
      expect(
        await claimBatchAttempt(tx, {
          batchId: created.batchId,
          tenantId: 'tenant-1',
          token: 'old-attempt',
          expectedVersion: 0,
        }),
      ).toEqual({ applied: true });
      expect(
        await claimNextBatchItem(tx, { batchId: created.batchId, tenantId: 'tenant-1', token: 'old-attempt' }),
      ).toMatchObject({
        outcome: 'claimed',
      });
      expect(
        await releaseBatchAttempt(tx, { batchId: created.batchId, tenantId: 'tenant-1', token: 'old-attempt' }),
      ).toEqual({
        applied: true,
      });
    });

    await prisma.$transaction(async (tx) => {
      expect(
        await claimBatchAttempt(tx, {
          batchId: created.batchId,
          tenantId: 'tenant-1',
          token: 'new-attempt',
          expectedVersion: 3,
        }),
      ).toEqual({ applied: true });
    });
    await expect(
      prisma.credentialBatch.findUnique({ where: { id: created.batchId }, include: { items: true } }),
    ).resolves.toMatchObject({
      attemptToken: 'new-attempt',
      processingCount: 0,
      queuedCount: 0,
      unknownCount: 1,
      items: [
        expect.objectContaining({
          state: CredentialBatchItemState.OUTCOME_UNKNOWN,
          errorClass: 'OUTCOME_UNKNOWN',
          errorMessage: expect.stringContaining('check the library'),
        }),
      ],
    });
  });

  it('rolls back takeover item transitions when a concurrent fence change wins', async () => {
    // Regression: a failed fenced batch update must not commit OUTCOME_UNKNOWN without its counters.
    const created = await submit('claim-race-key', 'digest-claim-race');
    if (created.outcome !== 'created') throw new Error('expected a newly created claim-race batch');
    const batchId = created.batchId;
    await prisma.$transaction(async (tx) => {
      expect(
        await claimBatchAttempt(tx, { batchId, tenantId: 'tenant-1', token: 'old-attempt', expectedVersion: 0 }),
      ).toEqual({ applied: true });
      expect(await claimNextBatchItem(tx, { batchId, tenantId: 'tenant-1', token: 'old-attempt' })).toMatchObject({
        outcome: 'claimed',
      });
    });
    await prisma.credentialBatch.update({ where: { id: batchId }, data: { lastProgressAt: new Date(0) } });

    let signalFlipped!: () => void;
    const itemFlipped = new Promise<void>((resolve) => {
      signalFlipped = resolve;
    });
    let concurrentClaim!: Promise<unknown>;
    await expect(
      prisma.$transaction(async (tx) => {
        const wrappedTx = {
          credentialBatch: {
            findFirst: tx.credentialBatch.findFirst.bind(tx.credentialBatch),
            updateMany: tx.credentialBatch.updateMany.bind(tx.credentialBatch),
          },
          credentialBatchItem: {
            updateMany: async (...args: Parameters<typeof tx.credentialBatchItem.updateMany>) => {
              const result = await tx.credentialBatchItem.updateMany(...args);
              if (result.count === 1) {
                signalFlipped();
                await concurrentClaim;
              }
              return result;
            },
          },
        } as unknown as Parameters<typeof claimBatchAttempt>[0];
        concurrentClaim = (async () => {
          await itemFlipped;
          return prisma.credentialBatch.update({
            where: { id: batchId },
            data: { attemptToken: 'concurrent-attempt', version: { increment: 1 } },
          });
        })();
        await claimBatchAttempt(wrappedTx, {
          batchId,
          tenantId: 'tenant-1',
          token: 'takeover-attempt',
          expectedVersion: 2,
          staleBefore: new Date(1_000),
        });
      }),
    ).rejects.toBeInstanceOf(CredentialBatchAttemptFenceLostError);
    await concurrentClaim;

    await expect(
      prisma.credentialBatch.findUnique({ where: { id: batchId }, include: { items: true } }),
    ).resolves.toMatchObject({
      attemptToken: 'concurrent-attempt',
      processingCount: 1,
      unknownCount: 0,
      items: [{ state: CredentialBatchItemState.PROCESSING, attemptToken: 'old-attempt' }],
    });
  });

  it('fences attempts, moves stored counts with item transitions and settles an all-partial batch', async () => {
    const created = await submit('progress-key', 'digest-progress', [ITEM, ITEM]);
    if (created.outcome !== 'created') throw new Error('expected a newly created batch');
    const batchId = created.batchId;
    const credentialId = 'credential-for-batch-item';

    await prisma.libraryRecord.create({
      data: {
        id: credentialId,
        tenantId: 'tenant-1',
        origin: LibraryRecordOrigin.NATIVE,
        credentialType: 'DigitalProductPassport',
        credential: {
          create: {
            storageUri: 'https://storage.example/credential',
            digestMultibase: 'zExampleDigest',
          },
        },
      },
    });

    await prisma.$transaction(async (tx) => {
      expect(
        await claimBatchAttempt(tx, { batchId, tenantId: 'tenant-1', token: 'wrong', expectedVersion: 99 }),
      ).toEqual({ applied: false });
      expect(
        await claimBatchAttempt(tx, { batchId, tenantId: 'tenant-1', token: 'attempt-1', expectedVersion: 0 }),
      ).toEqual({ applied: true });
      expect(await releaseBatchAttempt(tx, { batchId, tenantId: 'tenant-1', token: 'wrong' })).toEqual({
        applied: false,
      });
      expect(await releaseBatchAttempt(tx, { batchId, tenantId: 'tenant-1', token: 'attempt-1' })).toEqual({
        applied: true,
      });
      expect(
        await claimBatchAttempt(tx, { batchId, tenantId: 'tenant-1', token: 'attempt-2', expectedVersion: 2 }),
      ).toEqual({ applied: true });
      const item = await claimNextBatchItem(tx, { batchId, tenantId: 'tenant-1', token: 'attempt-2' });
      expect(item).toMatchObject({ outcome: 'claimed', item: { index: 0 } });
      expect(
        await markItemIssued(tx, {
          batchId,
          tenantId: 'tenant-1',
          index: 0,
          token: 'stale-attempt',
          credentialId,
        }),
      ).toEqual({ outcome: 'superseded' });
      expect(
        await markItemIssued(tx, {
          batchId,
          tenantId: 'tenant-1',
          index: 0,
          token: 'attempt-2',
          credentialId,
          warning: { code: 'DETAILS_EXTRACTION_FAILED', message: 'warning' },
        }),
      ).toEqual({ outcome: 'applied' });
      expect(
        await markItemIssued(tx, { batchId, tenantId: 'tenant-1', index: 0, token: 'attempt-2', credentialId }),
      ).toEqual({
        outcome: 'superseded',
      });
    });

    await expect(prisma.credentialBatch.findUnique({ where: { id: batchId } })).resolves.toMatchObject({
      queuedCount: 1,
      processingCount: 0,
      issuedCount: 1,
      failedCount: 0,
      unknownCount: 0,
      state: CredentialBatchState.RUNNING,
    });

    await prisma.$transaction(async (tx) => {
      expect(await claimNextBatchItem(tx, { batchId, tenantId: 'tenant-1', token: 'attempt-2' })).toMatchObject({
        outcome: 'claimed',
        item: { index: 1 },
      });
      expect(
        await markItemFailed(tx, {
          batchId,
          tenantId: 'tenant-1',
          index: 1,
          token: 'attempt-2',
          errorClass: 'VALIDATION_ERROR',
          errorMessage: 'item rejected',
        }),
      ).toEqual({ outcome: 'applied' });
      expect(await settleBatchIfFinished(tx, { batchId, tenantId: 'tenant-1', token: 'attempt-2' })).toEqual({
        outcome: 'applied',
        state: CredentialBatchState.COMPLETED,
      });
    });

    const settled = await prisma.credentialBatch.findUnique({ where: { id: batchId } });
    expect(settled).toMatchObject({
      state: CredentialBatchState.COMPLETED,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 1,
      failedCount: 1,
      unknownCount: 0,
      settledAt: expect.any(Date),
      expiresAt: expect.any(Date),
      attemptToken: null,
    });
    expect((settled?.expiresAt as Date).getTime()).toBeGreaterThan((settled?.settledAt as Date).getTime());

    await prisma.libraryRecord.delete({ where: { id: credentialId } });
    await expect(prisma.credentialBatchItem.findFirst({ where: { batchId, index: 0 } })).resolves.toMatchObject({
      state: CredentialBatchItemState.ISSUED,
      credentialId: null,
    });

    expect(await findCredentialBatchSubmission('tenant-1', 'progress-key')).toMatchObject({
      id: batchId,
      bodyDigest: 'digest-progress',
    });
    expect(await findCredentialBatchSubmission('tenant-2', 'progress-key')).toBeNull();
    expect(await getCredentialBatchById(batchId, 'tenant-2')).toBeNull();

    const replay = await submit('progress-key', 'digest-progress');
    expect(replay).toEqual({ outcome: 'replay', batchId });
    expect(await submit('progress-key', 'digest-other')).toEqual({ outcome: 'mismatch' });

    await prisma.credentialBatchItem.deleteMany({ where: { batchId } });
    await prisma.credentialBatch.update({ where: { id: batchId }, data: { state: CredentialBatchState.EXPIRED } });
    expect(await findCredentialBatchSubmission('tenant-1', 'progress-key')).toMatchObject({
      id: batchId,
      state: CredentialBatchState.EXPIRED,
    });
    expect(await submit('progress-key', 'digest-progress')).toEqual({ outcome: 'expired', batchId });
    expect(await submit('progress-key', 'digest-other')).toEqual({ outcome: 'expired', batchId });
    expect(await prisma.credentialBatch.count({ where: { id: batchId } })).toBe(1);

    const unknown = await submit('unknown-key', 'digest-unknown');
    if (unknown.outcome !== 'created') throw new Error('expected a newly created unknown-outcome batch');
    await prisma.$transaction(async (tx) => {
      expect(
        await claimBatchAttempt(tx, {
          batchId: unknown.batchId,
          tenantId: 'tenant-1',
          token: 'unknown-attempt',
          expectedVersion: 0,
        }),
      ).toEqual({ applied: true });
      expect(
        await claimNextBatchItem(tx, { batchId: unknown.batchId, tenantId: 'tenant-1', token: 'unknown-attempt' }),
      ).toMatchObject({
        outcome: 'claimed',
        item: { index: 0 },
      });
      expect(
        await markItemOutcomeUnknown(tx, {
          batchId: unknown.batchId,
          tenantId: 'tenant-1',
          index: 0,
          token: 'unknown-attempt',
          errorClass: 'OUTCOME_UNKNOWN',
          errorMessage: 'the worker stopped after the external write',
        }),
      ).toEqual({ outcome: 'applied' });
      expect(
        await settleBatchIfFinished(tx, { batchId: unknown.batchId, tenantId: 'tenant-1', token: 'unknown-attempt' }),
      ).toEqual({
        outcome: 'applied',
        state: CredentialBatchState.NEEDS_ATTENTION,
      });
    });
    await expect(prisma.credentialBatch.findUnique({ where: { id: unknown.batchId } })).resolves.toMatchObject({
      state: CredentialBatchState.NEEDS_ATTENTION,
      issuedCount: 0,
      failedCount: 0,
      unknownCount: 1,
    });
  });
});
