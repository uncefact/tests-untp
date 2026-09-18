import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { listMigrationDirectories } from '../../src/lib/prisma/migration-directories';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { contend } from './rig/locks';
import {
  PrismaClient,
  CredentialBatchItemState,
  CredentialBatchState,
  LibraryRecordOrigin,
} from '../../src/lib/prisma/generated';
import {
  CREDENTIAL_BATCH_ISSUE_ENQUEUE_OPTIONS,
  CredentialBatchAttemptFenceLostError,
  claimBatchAttempt,
  claimBatchAttemptAndRelease,
  checkpointBatchContinuation,
  cancelCredentialBatch,
  markItemQueued,
  CREDENTIAL_BATCH_ITEM_ATTEMPT_LIMIT,
  claimNextBatchItem,
  createCredentialBatch,
  expireDueCredentialBatches,
  findStalledCredentialBatches,
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
    await truncateApplicationTables(prisma);
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
    await expect(
      prisma.$transaction((tx) =>
        settleBatchIfFinished(tx, { batchId: supersededId, tenantId: 'tenant-1', token: 'stale-token' }),
      ),
    ).resolves.toEqual({ outcome: 'superseded' });
    await expect(prisma.credentialBatch.findUniqueOrThrow({ where: { id: supersededId } })).resolves.toMatchObject({
      state: CredentialBatchState.RUNNING,
      attemptToken: 'settle-token',
      settledAt: null,
    });

    await expect(
      prisma.$transaction((tx) =>
        settleBatchIfFinished(tx, { batchId: appliedId, tenantId: 'tenant-1', token: 'settle-token' }),
      ),
    ).resolves.toMatchObject({ outcome: 'applied', state: CredentialBatchState.COMPLETED });
  });

  it('returns a non-applied cancellation settlement to reconciliation without calling it fence loss', async () => {
    // Regression: a not-ready settlement must reach reconciliation as its own outcome.
    const created = await submit('settle-cancel-not-ready-key', 'digest-settle-cancel-not-ready', [ITEM, ITEM]);
    const batchId = createdBatchId(created);
    await prisma.$transaction(async (tx) => {
      await claimBatchAttempt(tx, { batchId, tenantId: 'tenant-1', token: 'old-attempt', expectedVersion: 0 });
      await claimNextBatchItem(tx, { batchId, tenantId: 'tenant-1', token: 'old-attempt' });
    });
    await prisma.$executeRaw`
      UPDATE "CredentialBatchItem"
      SET state = 'PROCESSING', "attemptToken" = 'other-attempt'
      WHERE "batchId" = ${batchId} AND index = 1
    `;
    await prisma.$executeRaw`
      UPDATE "CredentialBatch"
      SET "queuedCount" = 0, "processingCount" = 2
      WHERE id = ${batchId}
    `;
    const cancelled = await prisma.$transaction((tx) => cancelCredentialBatch(tx, { batchId, tenantId: 'tenant-1' }));
    if (cancelled.outcome !== 'applied') throw new Error('expected cancellation to apply');
    await prisma.credentialBatch.update({ where: { id: batchId }, data: { lastProgressAt: new Date(0) } });
    const staleBefore = new Date(Date.now() - 1_000);

    await expect(
      prisma.$transaction((tx) =>
        claimBatchAttemptAndRelease(tx, {
          batchId,
          tenantId: 'tenant-1',
          token: 'recovery-attempt',
          expectedVersion: cancelled.batch.version,
          staleBefore,
        }),
      ),
    ).resolves.toEqual({ applied: true, settled: false, settlement: 'not-ready' });
    await expect(
      prisma.credentialBatch.findUnique({ where: { id: batchId }, include: { items: true } }),
    ).resolves.toMatchObject({
      attemptToken: null,
      lastProgressAt: staleBefore,
      processingCount: 1,
      unknownCount: 1,
      items: expect.arrayContaining([
        expect.objectContaining({ state: CredentialBatchItemState.OUTCOME_UNKNOWN }),
        expect.objectContaining({ state: CredentialBatchItemState.PROCESSING, attemptToken: 'other-attempt' }),
      ]),
    });
    expect(await findStalledCredentialBatches(new Date())).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: batchId, attemptToken: null })]),
    );
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
    ).resolves.toEqual({ outcome: 'missing' });
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

  it('rolls back takeover item transitions when the parent fence write is refused', async () => {
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

    await expect(
      prisma.$transaction(async (tx) => {
        const wrappedTx = {
          ...tx,
          credentialBatch: {
            ...tx.credentialBatch,
            updateMany: async () => ({ count: 0 }),
          },
        } as unknown as Parameters<typeof claimBatchAttempt>[0];
        await claimBatchAttempt(wrappedTx, {
          batchId,
          tenantId: 'tenant-1',
          token: 'takeover-attempt',
          expectedVersion: 2,
          staleBefore: new Date(1_000),
        });
      }),
    ).rejects.toBeInstanceOf(CredentialBatchAttemptFenceLostError);

    await expect(
      prisma.credentialBatch.findUnique({ where: { id: batchId }, include: { items: true } }),
    ).resolves.toMatchObject({
      attemptToken: 'old-attempt',
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
  async function runningBatch(key: string, count: number, processing = true) {
    const batchId = createdBatchId(
      await submit(
        key,
        key,
        Array.from({ length: count }, () => ITEM),
      ),
    );
    const input = { batchId, tenantId: 'tenant-1', token: 'cancel-attempt' };
    await prisma.$transaction(async (tx) => {
      expect(await claimBatchAttempt(tx, { ...input, expectedVersion: 0 })).toEqual({ applied: true });
      if (processing)
        expect(await claimNextBatchItem(tx, input)).toMatchObject({ outcome: 'claimed', item: { index: 0 } });
    });
    return input;
  }

  it('cancels deferred queued items together and preserves the in-flight attempt and issued credential', async () => {
    const input = await runningBatch('cancel-five', 5);
    const before = await getCredentialBatchById(input.batchId, input.tenantId);
    await prisma.credentialBatchItem.updateMany({
      where: { batchId: input.batchId, index: 2 },
      data: { nextAttemptAt: new Date(Date.now() + 60_000), attemptToken: 'old-retry-token' },
    });
    const result = await prisma.$transaction((tx) => cancelCredentialBatch(tx, input));
    expect(result).toMatchObject({
      outcome: 'applied',
      batch: {
        state: CredentialBatchState.RUNNING,
        queuedCount: 0,
        processingCount: 1,
        cancelledCount: 4,
        cancelRequestedAt: expect.any(Date),
        settledAt: null,
        attemptToken: input.token,
        lastProgressAt: before?.lastProgressAt,
      },
    });
    const during = await getCredentialBatchById(input.batchId, input.tenantId);
    expect(during?.items[0]).toEqual(before?.items[0]);
    expect(
      during?.items.slice(1).map(({ state, nextAttemptAt, attemptToken }) => ({ state, nextAttemptAt, attemptToken })),
    ).toEqual(Array.from({ length: 4 }, () => ({ state: 'CANCELLED', nextAttemptAt: null, attemptToken: null })));
    expect(await prisma.$transaction((tx) => cancelCredentialBatch(tx, input))).toEqual({
      outcome: 'already-requested',
      batch: during,
    });
    expect(await getCredentialBatchById(input.batchId, input.tenantId)).toEqual(during);
    await nativeCredential('cancel-issued-credential');
    await prisma.$transaction(async (tx) => {
      expect(await markItemIssued(tx, { ...input, index: 0, credentialId: 'cancel-issued-credential' })).toEqual({
        outcome: 'applied',
      });
      expect(await settleBatchIfFinished(tx, input)).toEqual({
        outcome: 'applied',
        state: CredentialBatchState.CANCELLED,
      });
    });
    const after = await getCredentialBatchById(input.batchId, input.tenantId);
    expect(after).toMatchObject({
      state: CredentialBatchState.CANCELLED,
      issuedCount: 1,
      cancelledCount: 4,
      processingCount: 0,
      queuedCount: 0,
      attemptToken: null,
      settledAt: expect.any(Date),
      expiresAt: expect.any(Date),
    });
    expect(after?.items[0]).toMatchObject({
      state: CredentialBatchItemState.ISSUED,
      credentialId: 'cancel-issued-credential',
    });
    const settled = await prisma.$transaction((tx) => cancelCredentialBatch(tx, input));
    expect(settled).toEqual({ outcome: 'not-cancellable', batch: after });
    expect(await getCredentialBatchById(input.batchId, input.tenantId)).toEqual(after);
    expect(await prisma.credential.findUnique({ where: { id: 'cancel-issued-credential' } })).not.toBeNull();
  });

  it('rolls back the cancellation flag, items and counters if the transaction fails', async () => {
    const input = await runningBatch('cancel-rollback', 2);
    const before = await getCredentialBatchById(input.batchId, input.tenantId);
    await expect(
      prisma.$transaction(async (tx) => {
        await cancelCredentialBatch(tx, input);
        throw new Error('cancel transaction fault');
      }),
    ).rejects.toThrow('cancel transaction fault');
    expect(await getCredentialBatchById(input.batchId, input.tenantId)).toEqual(before);
  });

  it('rejects a queued-row counter mismatch with its batch identity and leaves every row unchanged', async () => {
    // Regression: a counter mismatch must roll back every batch and item row.
    const batchId = createdBatchId(await submit('cancel-counter-drift', 'cancel-counter-drift', [ITEM, ITEM]));
    await prisma.$executeRaw`
      UPDATE "CredentialBatch"
      SET "queuedCount" = "queuedCount" + 1, "itemCount" = "itemCount" + 1
      WHERE id = ${batchId}
    `;
    const beforeBatch = await prisma.credentialBatch.findUniqueOrThrow({ where: { id: batchId } });
    const beforeItems = await prisma.credentialBatchItem.findMany({ where: { batchId }, orderBy: { index: 'asc' } });

    await expect(
      prisma.$transaction((tx) => cancelCredentialBatch(tx, { batchId, tenantId: 'tenant-1' })),
    ).rejects.toThrow(`batchId=${batchId}, tenantId=tenant-1, cancelledRows=2, queuedCount=3`);

    await expect(prisma.credentialBatch.findUniqueOrThrow({ where: { id: batchId } })).resolves.toEqual(beforeBatch);
    await expect(
      prisma.credentialBatchItem.findMany({ where: { batchId }, orderBy: { index: 'asc' } }),
    ).resolves.toEqual(beforeItems);
  });

  it('settles queued cancellation immediately and returns tenant-scoped refusal outcomes without writes', async () => {
    const batchId = createdBatchId(await submit('cancel-queued', 'cancel-queued', [ITEM, ITEM]));
    const input = { batchId, tenantId: 'tenant-1' };
    const before = await getCredentialBatchById(batchId, input.tenantId);
    expect(await prisma.$transaction((tx) => cancelCredentialBatch(tx, { ...input, tenantId: 'tenant-2' }))).toEqual({
      outcome: 'missing',
    });
    expect(await prisma.$transaction((tx) => cancelCredentialBatch(tx, { ...input, batchId: 'absent' }))).toEqual({
      outcome: 'missing',
    });
    expect(await getCredentialBatchById(batchId, input.tenantId)).toEqual(before);
    expect(await prisma.$transaction((tx) => cancelCredentialBatch(tx, input))).toMatchObject({
      outcome: 'applied',
      batch: {
        state: CredentialBatchState.CANCELLED,
        queuedCount: 0,
        cancelledCount: 2,
        settledAt: expect.any(Date),
        expiresAt: expect.any(Date),
      },
    });
    for (const state of [
      CredentialBatchState.COMPLETED,
      CredentialBatchState.NEEDS_ATTENTION,
      CredentialBatchState.CANCELLED,
      CredentialBatchState.EXPIRED,
    ]) {
      await prisma.credentialBatch.update({ where: { id: batchId }, data: { state } });
      const snapshot = await getCredentialBatchById(batchId, input.tenantId);
      expect(await prisma.$transaction((tx) => cancelCredentialBatch(tx, input))).toEqual({
        outcome: state === CredentialBatchState.EXPIRED ? 'expired' : 'not-cancellable',
        batch: snapshot,
      });
      expect(await getCredentialBatchById(batchId, input.tenantId)).toEqual(snapshot);
    }
  });

  it('completes with zero cancelled items when the sole in-flight item issues', async () => {
    const input = await runningBatch('cancel-zero', 1);
    await prisma.$transaction((tx) => cancelCredentialBatch(tx, input));
    await nativeCredential('cancel-zero-credential');
    await prisma.$transaction(async (tx) => {
      await markItemIssued(tx, { ...input, index: 0, credentialId: 'cancel-zero-credential' });
      expect(await settleBatchIfFinished(tx, input)).toEqual({
        outcome: 'applied',
        state: CredentialBatchState.COMPLETED,
      });
    });
    expect(await getCredentialBatchById(input.batchId, input.tenantId)).toMatchObject({
      state: CredentialBatchState.COMPLETED,
      cancelledCount: 0,
      issuedCount: 1,
      cancelRequestedAt: expect.any(Date),
    });
  });

  it.each(['ISSUED', 'FAILED'] as const)(
    'holds uncertainty after cancellation and resolves the last unknown as %s',
    async (state) => {
      const input = await runningBatch(`cancel-unknown-${state}`, 2);
      await prisma.$transaction((tx) => cancelCredentialBatch(tx, input));
      await prisma.$transaction(async (tx) => {
        expect(
          await markItemOutcomeUnknown(tx, {
            ...input,
            index: 0,
            errorClass: 'OUTCOME_UNKNOWN',
            errorMessage: 'check library',
          }),
        ).toEqual({ outcome: 'applied' });
        expect(await settleBatchIfFinished(tx, input)).toEqual({
          outcome: 'applied',
          state: CredentialBatchState.NEEDS_ATTENTION,
        });
      });
      const held = await prisma.credentialBatch.findUniqueOrThrow({ where: { id: input.batchId } });
      expect(held).toMatchObject({ unknownCount: 1, cancelledCount: 1, expiresAt: null });
      await nativeCredential('resolved-cancel-credential');
      const result = await prisma.$transaction((tx) =>
        resolveUnknownBatchItem(tx, {
          ...input,
          index: 0,
          expectedVersion: held.version,
          reason: 'checked provider and library',
          resolution:
            state === 'ISSUED'
              ? { state, credentialId: 'resolved-cancel-credential' }
              : { state, evidence: 'provider confirmed no issuance' },
        }),
      );
      expect(result).toMatchObject({
        outcome: 'applied',
        after: {
          batchState: CredentialBatchState.CANCELLED,
          counts: {
            total: 2,
            cancelled: 1,
            unknown: 0,
            issued: state === 'ISSUED' ? 1 : 0,
            failed: state === 'FAILED' ? 1 : 0,
          },
        },
      });
      expect(await getCredentialBatchById(input.batchId, input.tenantId)).toMatchObject({
        state: CredentialBatchState.CANCELLED,
        settledAt: held.settledAt,
        expiresAt: expect.any(Date),
        resolvedAt: expect.any(Date),
      });
    },
  );

  it('keeps exhausted pre-dispatch attempts failed after cancellation', async () => {
    const input = await runningBatch('cancel-exhausted', 2);
    await prisma.credentialBatchItem.updateMany({
      where: { batchId: input.batchId, index: 0 },
      data: { attemptCount: CREDENTIAL_BATCH_ITEM_ATTEMPT_LIMIT - 1 },
    });
    await prisma.$transaction((tx) => cancelCredentialBatch(tx, input));
    await prisma.$transaction(async (tx) => {
      expect(await markItemQueued(tx, { ...input, index: 0, errorMessage: 'decrypt unavailable' })).toEqual({
        outcome: 'attempts-exhausted',
      });
      await settleBatchIfFinished(tx, input);
    });
    expect(await getCredentialBatchById(input.batchId, input.tenantId)).toMatchObject({
      state: CredentialBatchState.CANCELLED,
      cancelledCount: 1,
      failedCount: 1,
      processingCount: 0,
      items: [
        expect.objectContaining({
          state: 'FAILED',
          attemptCount: CREDENTIAL_BATCH_ITEM_ATTEMPT_LIMIT,
          nextAttemptAt: null,
          attemptToken: null,
        }),
        expect.objectContaining({ state: 'CANCELLED' }),
      ],
    });
  });

  it.each([
    ['budget', 'cancel'],
    ['budget', 'checkpoint'],
    ['deferred', 'cancel'],
    ['deferred', 'checkpoint'],
  ] as const)('serialises the %s checkpoint with %s first', async (path, first) => {
    const input = await runningBatch(`checkpoint-${path}-${first}`, path === 'budget' ? 5 : 1);
    await clearBatchJobs();
    const startAfter = new Date(Date.now() + 30_000);
    if (path === 'budget') await nativeCredential('checkpoint-issued');
    const cancel = (tx: Parameters<typeof cancelCredentialBatch>[0]) => cancelCredentialBatch(tx, input);
    await prisma.$transaction(async (tx) => {
      if (path === 'budget') {
        expect(await markItemIssued(tx, { ...input, index: 0, credentialId: 'checkpoint-issued' })).toEqual({
          outcome: 'applied',
        });
      } else {
        expect(await markItemQueued(tx, { ...input, index: 0, errorMessage: 'pre-dispatch fault' })).toEqual({
          outcome: 'applied',
        });
      }
    });
    const checkpoint = (tx: Parameters<typeof checkpointBatchContinuation>[0]) =>
      checkpointBatchContinuation(tx, { ...input, queue, ...(path === 'deferred' ? { startAfter } : {}) });
    const results =
      first === 'cancel' ? await contend(prisma, cancel, checkpoint) : await contend(prisma, checkpoint, cancel);
    expect(results[first === 'cancel' ? 1 : 0]).toEqual({
      outcome: first === 'checkpoint' ? 'checkpointed' : 'superseded',
    });
    expect(results[first === 'cancel' ? 0 : 1]).toMatchObject({ outcome: 'applied' });
    const batch = await getCredentialBatchById(input.batchId, input.tenantId);
    expect(batch).toMatchObject({
      state: 'CANCELLED',
      queuedCount: 0,
      processingCount: 0,
      issuedCount: path === 'budget' ? 1 : 0,
      cancelledCount: path === 'budget' ? 4 : 1,
      attemptToken: null,
    });
    const jobs = await prisma.$queryRaw<Array<{ start_after: Date }>>`
      SELECT start_after FROM pgboss.job WHERE name = ${CREDENTIAL_BATCH_ISSUE_JOB} AND data->>'batchId' = ${input.batchId}
    `;
    expect(jobs).toHaveLength(first === 'checkpoint' ? 1 : 0);
    if (first === 'checkpoint' && path === 'deferred') expect(jobs[0].start_after).toEqual(startAfter);
    expect(await prisma.$transaction((tx) => claimNextBatchItem(tx, input))).toEqual({ outcome: 'cancelled' });
  });

  it.each(['budget', 'deferred'] as const)(
    'settles cancellation at the %s checkpoint after the held attempt finishes',
    async (path) => {
      const input = await runningBatch(`cancel-held-checkpoint-${path}`, 2);
      await clearBatchJobs();
      await prisma.$transaction((tx) => cancelCredentialBatch(tx, input));
      await prisma.$transaction((tx) => markItemQueued(tx, { ...input, index: 0, errorMessage: 'pre-dispatch fault' }));
      const before = await getCredentialBatchById(input.batchId, input.tenantId);
      expect(before).toMatchObject({
        state: 'RUNNING',
        cancelledCount: 2,
        processingCount: 0,
        attemptToken: input.token,
      });
      expect(
        await prisma.$transaction((tx) => checkpointBatchContinuation(tx, { ...input, token: 'stale', queue })),
      ).toEqual({ outcome: 'superseded' });
      expect(await getCredentialBatchById(input.batchId, input.tenantId)).toEqual(before);
      expect(
        await prisma.$transaction((tx) =>
          checkpointBatchContinuation(tx, {
            ...input,
            queue,
            ...(path === 'deferred' ? { startAfter: new Date(Date.now() + 30_000) } : {}),
          }),
        ),
      ).toEqual({ outcome: 'applied', state: CredentialBatchState.CANCELLED });
      expect(await getCredentialBatchById(input.batchId, input.tenantId)).toMatchObject({
        state: 'CANCELLED',
        cancelledCount: 2,
        attemptToken: null,
      });
      const jobs = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM pgboss.job WHERE name = ${CREDENTIAL_BATCH_ISSUE_JOB} AND data->>'batchId' = ${input.batchId}
    `;
      expect(jobs).toEqual([]);
    },
  );

  it('expires cancelled items while retaining tombstone counts and held unknown evidence', async () => {
    const cancelled = await runningBatch('expiry-cancelled', 2, false);
    await prisma.$transaction((tx) => cancelCredentialBatch(tx, cancelled));
    const held = await runningBatch('expiry-cancelled-held', 2);
    await prisma.$transaction(async (tx) => {
      await cancelCredentialBatch(tx, held);
      await markItemOutcomeUnknown(tx, {
        ...held,
        index: 0,
        errorClass: 'OUTCOME_UNKNOWN',
        errorMessage: 'lost response',
      });
      await settleBatchIfFinished(tx, held);
    });
    const before = await getCredentialBatchById(cancelled.batchId, cancelled.tenantId);
    expect(before?.expiresAt).toBeInstanceOf(Date);
    const deadline = new Date(before!.expiresAt!.getTime() + 1);
    // A stale deadline must not make held investigation evidence eligible for expiry.
    await prisma.credentialBatch.update({ where: { id: held.batchId }, data: { expiresAt: new Date(0) } });
    const heldBefore = await getCredentialBatchById(held.batchId, held.tenantId);
    expect(await expireDueCredentialBatches(deadline)).toBe(1);
    expect(await getCredentialBatchById(cancelled.batchId, cancelled.tenantId)).toEqual({
      ...before,
      state: 'EXPIRED',
      items: [],
      updatedAt: expect.any(Date),
    });
    expect(await getCredentialBatchById(held.batchId, held.tenantId)).toEqual(heldBefore);
    expect(await expireDueCredentialBatches(deadline)).toBe(0);
  });

  it.each(['cancel', 'claim'] as const)(
    'serialises cancel versus claim with %s holding the batch lock first',
    async (first) => {
      const input = await runningBatch(`race-claim-${first}`, 2, false);
      const cancel = (tx: Parameters<typeof cancelCredentialBatch>[0]) => cancelCredentialBatch(tx, input);
      const claim = (tx: Parameters<typeof claimNextBatchItem>[0]) => claimNextBatchItem(tx, input);
      const results = first === 'cancel' ? await contend(prisma, cancel, claim) : await contend(prisma, claim, cancel);
      expect(results[0]).toMatchObject({ outcome: first === 'cancel' ? 'applied' : 'claimed' });
      expect(results[1]).toMatchObject({ outcome: first === 'cancel' ? 'cancelled' : 'applied' });
      const batch = await getCredentialBatchById(input.batchId, input.tenantId);
      expect(batch).toMatchObject({
        queuedCount: 0,
        processingCount: first === 'claim' ? 1 : 0,
        cancelledCount: first === 'claim' ? 1 : 2,
        state: first === 'claim' ? 'RUNNING' : 'CANCELLED',
      });
      expect(batch?.items.map((item) => item.state)).toEqual(
        first === 'claim' ? ['PROCESSING', 'CANCELLED'] : ['CANCELLED', 'CANCELLED'],
      );
      expect(await prisma.$transaction((tx) => claimNextBatchItem(tx, input))).toEqual({ outcome: 'cancelled' });
    },
  );

  it('returns cancelled before checking a non-owner token and preserves the live owner', async () => {
    // Regression: moving the cancellation check below the token fence would return superseded here.
    const input = await runningBatch('cancel-non-owner-claim', 2);
    await prisma.$transaction((tx) => cancelCredentialBatch(tx, input));
    const before = await getCredentialBatchById(input.batchId, input.tenantId);
    expect(before).toMatchObject({
      state: CredentialBatchState.RUNNING,
      attemptToken: input.token,
      processingCount: 1,
      cancelledCount: 1,
    });

    expect(await prisma.$transaction((tx) => claimNextBatchItem(tx, { ...input, token: 'non-owner-token' }))).toEqual({
      outcome: 'cancelled',
    });
    const after = await getCredentialBatchById(input.batchId, input.tenantId);
    expect(after).toMatchObject({
      state: before!.state,
      attemptToken: before!.attemptToken,
      lastProgressAt: before!.lastProgressAt,
      processingCount: before!.processingCount,
      cancelledCount: before!.cancelledCount,
    });
  });

  it.each(['first-session', 'second-session'] as const)(
    'serialises two cancellation requests with the %s session first',
    async (firstSession) => {
      // Regression: concurrent cancellation must apply once and preserve the first request timestamp.
      const input = await runningBatch(`race-cancel-cancel-${firstSession}`, 2);
      const before = await getCredentialBatchById(input.batchId, input.tenantId);
      const firstCancel = (tx: Parameters<typeof cancelCredentialBatch>[0]) => cancelCredentialBatch(tx, input);
      const secondCancel = (tx: Parameters<typeof cancelCredentialBatch>[0]) => cancelCredentialBatch(tx, input);
      const results =
        firstSession === 'first-session'
          ? await contend(prisma, firstCancel, secondCancel)
          : await contend(prisma, secondCancel, firstCancel);

      expect(results[0]).toMatchObject({ outcome: 'applied', batch: { cancelRequestedAt: expect.any(Date) } });
      expect(results[1]).toMatchObject({ outcome: 'already-requested' });
      if (results[0].outcome !== 'applied' || results[1].outcome !== 'already-requested') {
        throw new Error('expected the first cancellation to apply and the second to join it');
      }
      expect(results[1].batch.cancelRequestedAt).toEqual(results[0].batch.cancelRequestedAt);
      const after = await getCredentialBatchById(input.batchId, input.tenantId);
      expect(after).toMatchObject({
        queuedCount: 0,
        processingCount: 1,
        cancelledCount: 1,
        state: CredentialBatchState.RUNNING,
        version: (before?.version ?? 0) + 1,
      });
      expect(after?.items.map((item) => item.state)).toEqual(['PROCESSING', 'CANCELLED']);
    },
  );

  it.each(['cancel', 'fault'] as const)('serialises cancel versus pre-dispatch fault with %s first', async (first) => {
    const input = await runningBatch(`race-fault-${first}`, 2);
    const cancel = (tx: Parameters<typeof cancelCredentialBatch>[0]) => cancelCredentialBatch(tx, input);
    const fault = (tx: Parameters<typeof markItemQueued>[0]) =>
      markItemQueued(tx, { ...input, index: 0, errorMessage: 'decrypt unavailable' });
    const results = first === 'cancel' ? await contend(prisma, cancel, fault) : await contend(prisma, fault, cancel);
    expect(results.map((result) => result.outcome)).toEqual(['applied', 'applied']);
    if (first === 'cancel') await prisma.$transaction((tx) => settleBatchIfFinished(tx, input));
    const batch = await getCredentialBatchById(input.batchId, input.tenantId);
    expect(batch).toMatchObject({
      state: CredentialBatchState.CANCELLED,
      queuedCount: 0,
      processingCount: 0,
      cancelledCount: 2,
    });
    expect(
      batch?.items.map(({ state, nextAttemptAt, attemptToken }) => ({ state, nextAttemptAt, attemptToken })),
    ).toEqual([
      { state: 'CANCELLED', nextAttemptAt: null, attemptToken: null },
      { state: 'CANCELLED', nextAttemptAt: null, attemptToken: null },
    ]);
    expect(batch?.items[0].attemptCount).toBe(1);
  });

  it('preserves already issued rows when cancellation arrives during the next item', async () => {
    const input = await runningBatch('cancel-existing-issued', 3);
    await nativeCredential('already-issued-before-cancel');
    await prisma.$transaction(async (tx) => {
      await markItemIssued(tx, { ...input, index: 0, credentialId: 'already-issued-before-cancel' });
      expect(await claimNextBatchItem(tx, input)).toMatchObject({ outcome: 'claimed', item: { index: 1 } });
    });
    const issued = await prisma.credentialBatchItem.findFirstOrThrow({ where: { batchId: input.batchId, index: 0 } });
    const result = await prisma.$transaction((tx) => cancelCredentialBatch(tx, input));
    expect(result).toMatchObject({
      outcome: 'applied',
      batch: { issuedCount: 1, processingCount: 1, cancelledCount: 1, queuedCount: 0 },
    });
    expect(await prisma.credentialBatchItem.findFirstOrThrow({ where: { batchId: input.batchId, index: 0 } })).toEqual(
      issued,
    );
    await prisma.$transaction(async (tx) => {
      await markItemFailed(tx, { ...input, index: 1, errorClass: 'REFUSED', errorMessage: 'service refused' });
      expect(await settleBatchIfFinished(tx, input)).toEqual({
        outcome: 'applied',
        state: CredentialBatchState.CANCELLED,
      });
    });
    expect(await getCredentialBatchById(input.batchId, input.tenantId)).toMatchObject({
      state: 'CANCELLED',
      issuedCount: 1,
      failedCount: 1,
      cancelledCount: 1,
      queuedCount: 0,
      processingCount: 0,
    });
  });

  it('recovers a cancelled stalled attempt as unknown and settles while the new token is owned', async () => {
    const input = await runningBatch('cancel-stalled', 2);
    await prisma.$transaction((tx) => cancelCredentialBatch(tx, input));
    const batch = await prisma.credentialBatch.update({
      where: { id: input.batchId },
      data: { lastProgressAt: new Date(0) },
    });
    await prisma.$transaction(async (tx) => {
      expect(
        await claimBatchAttempt(tx, {
          ...input,
          token: 'recovery',
          expectedVersion: batch.version,
          staleBefore: new Date(1_000),
        }),
      ).toEqual({ applied: true });
      expect(await settleBatchIfFinished(tx, input)).toEqual({ outcome: 'superseded' });
      expect(await settleBatchIfFinished(tx, { ...input, token: 'recovery' })).toEqual({
        outcome: 'applied',
        state: CredentialBatchState.NEEDS_ATTENTION,
      });
    });
    expect(await getCredentialBatchById(input.batchId, input.tenantId)).toMatchObject({
      state: 'NEEDS_ATTENTION',
      cancelledCount: 1,
      unknownCount: 1,
      processingCount: 0,
      attemptToken: null,
      expiresAt: null,
      items: [expect.objectContaining({ state: 'OUTCOME_UNKNOWN' }), expect.objectContaining({ state: 'CANCELLED' })],
    });
  });

  it.each(['unknown', 'failed'] as const)(
    'settles cancellation arriving after the final %s outcome but before worker settlement',
    async (outcome) => {
      const input = await runningBatch(`cancel-after-outcome-${outcome}`, 1);
      await prisma.$transaction((tx) =>
        outcome === 'unknown'
          ? markItemOutcomeUnknown(tx, {
              ...input,
              index: 0,
              errorClass: 'OUTCOME_UNKNOWN',
              errorMessage: 'check library',
            })
          : markItemFailed(tx, { ...input, index: 0, errorClass: 'REFUSED', errorMessage: 'refused' }),
      );
      expect(await prisma.$transaction((tx) => cancelCredentialBatch(tx, input))).toMatchObject({
        outcome: 'applied',
        batch: {
          state: outcome === 'unknown' ? 'NEEDS_ATTENTION' : 'COMPLETED',
          cancelledCount: 0,
          queuedCount: 0,
          processingCount: 0,
          settledAt: expect.any(Date),
          expiresAt: outcome === 'unknown' ? null : expect.any(Date),
        },
      });
    },
  );
});

describe('credential batch cancellation migration on populated tables', () => {
  const migration = '20260918120000_credential_batch_cancel';
  const schema = `cancel_upgrade_${randomUUID().replaceAll('-', '')}`;
  const admin = createRigClient();
  let upgrade: PrismaClient | undefined;
  let url: string;

  function deploy(args: string[]) {
    return execFileSync('pnpm', ['exec', 'prisma', ...args, '--config', 'prisma/prisma.config.ts'], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, RI_DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
  }

  afterAll(async () => {
    await upgrade?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    const rows = await admin.$queryRaw<Array<{ schema_name: string }>>`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${schema}
    `;
    await admin.$disconnect();
    expect(rows).toEqual([]);
  });

  it('deploys over existing batches, preserves their meaning and enforces both revised count constraints', async () => {
    // Regression: the migrated sum constraint must retain failed, processing and unknown work in the total.
    const target = new URL(process.env.RI_DATABASE_URL as string);
    target.searchParams.set('schema', schema);
    url = target.toString();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    upgrade = new PrismaClient({ datasources: { db: { url } } });
    const migrations = listMigrationDirectories(path.resolve(__dirname, '../../prisma/migrations'));
    for (const name of migrations.filter((name) => name >= migration)) {
      deploy(['migrate', 'resolve', '--applied', name]);
    }
    deploy(['migrate', 'deploy']);
    const columnsBefore = await upgrade.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'CredentialBatch'
    `;
    expect(columnsBefore.map((column) => column.column_name)).toContain('unknownCount');
    expect(columnsBefore.map((column) => column.column_name)).not.toContain('cancelledCount');
    await upgrade.$executeRaw`INSERT INTO "Tenant" (id, name, "updatedAt") VALUES ('upgrade-tenant', 'Upgrade tenant', now())`;
    await upgrade.$executeRaw`
      INSERT INTO "CredentialBatch" (id, "tenantId", state, "itemCount", "queuedCount", "processingCount", "issuedCount", "failedCount", "unknownCount", "idempotencyKey", "bodyDigest", "updatedAt")
      VALUES ('upgrade-queued', 'upgrade-tenant', 'QUEUED', 2, 2, 0, 0, 0, 0, 'upgrade-key', 'upgrade-digest', now()),
             ('upgrade-completed', 'upgrade-tenant', 'COMPLETED', 1, 0, 0, 1, 0, 0, 'completed-key', 'completed-digest', now()),
             ('upgrade-attention', 'upgrade-tenant', 'NEEDS_ATTENTION', 3, 0, 1, 0, 1, 1, 'attention-key', 'attention-digest', now())
    `;
    await upgrade.$executeRaw`
      INSERT INTO "CredentialBatchItem" (id, "batchId", "tenantId", "index", state, request, "updatedAt")
      VALUES ('upgrade-item-0', 'upgrade-queued', 'upgrade-tenant', 0, 'QUEUED', 'retained envelope zero', now()),
             ('upgrade-item-1', 'upgrade-queued', 'upgrade-tenant', 1, 'QUEUED', 'retained envelope one', now()),
             ('upgrade-attention-item-0', 'upgrade-attention', 'upgrade-tenant', 0, 'FAILED', 'failed envelope', now()),
             ('upgrade-attention-item-1', 'upgrade-attention', 'upgrade-tenant', 1, 'PROCESSING', 'processing envelope', now()),
             ('upgrade-attention-item-2', 'upgrade-attention', 'upgrade-tenant', 2, 'OUTCOME_UNKNOWN', 'unknown envelope', now())
    `;
    const before = await upgrade.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "CredentialBatch" ORDER BY id`;
    const itemsBefore = await upgrade.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT * FROM "CredentialBatchItem" ORDER BY id`;
    await upgrade.$executeRaw`DELETE FROM "_prisma_migrations" WHERE migration_name = ${migration}`;
    expect(deploy(['migrate', 'deploy'])).toContain(migration);
    await upgrade.$disconnect();
    upgrade = new PrismaClient({ datasources: { db: { url } } });
    const after = await upgrade.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "CredentialBatch" ORDER BY id`;
    expect(after).toEqual(before.map((row) => ({ ...row, cancelledCount: 0, cancelRequestedAt: null })));
    expect(await upgrade.$queryRaw`SELECT * FROM "CredentialBatchItem" ORDER BY id`).toEqual(itemsBefore);
    await upgrade.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "CredentialBatchItem" SET state = 'CANCELLED' WHERE "batchId" = 'upgrade-queued'`;
      await tx.$executeRaw`UPDATE "CredentialBatch" SET state = 'CANCELLED', "queuedCount" = 0, "cancelledCount" = 2, "cancelRequestedAt" = now() WHERE id = 'upgrade-queued'`;
    });
    expect(
      await upgrade.credentialBatch.findUnique({ where: { id: 'upgrade-queued' }, include: { items: true } }),
    ).toMatchObject({
      state: 'CANCELLED',
      cancelledCount: 2,
      queuedCount: 0,
      cancelRequestedAt: expect.any(Date),
      items: [expect.objectContaining({ state: 'CANCELLED' }), expect.objectContaining({ state: 'CANCELLED' })],
    });
    await expect(
      upgrade.$executeRaw`UPDATE "CredentialBatch" SET "cancelledCount" = 3 WHERE id = 'upgrade-queued'`,
    ).rejects.toThrow('CredentialBatch_counts_sum_check');
    await expect(
      upgrade.$executeRaw`UPDATE "CredentialBatch" SET "cancelledCount" = -1, "queuedCount" = 3 WHERE id = 'upgrade-queued'`,
    ).rejects.toThrow('CredentialBatch_counts_non_negative_check');
    // Regression: the new sum constraint must still count unknown work when failed and processing work exist.
    await expect(
      upgrade.$executeRaw`UPDATE "CredentialBatch" SET "unknownCount" = 0 WHERE id = 'upgrade-attention'`,
    ).rejects.toThrow('CredentialBatch_counts_sum_check');
    expect(await upgrade.credentialBatch.findUnique({ where: { id: 'upgrade-queued' } })).toMatchObject({
      queuedCount: 0,
      cancelledCount: 2,
      itemCount: 2,
    });
  }, 180_000);
});
