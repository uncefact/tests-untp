jest.mock('@/lib/api/logger');

import { EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertNativeCredential } from './fixtures';
import { CredentialBatchItemState, CredentialBatchState, LibraryRecordOrigin } from '../../src/lib/prisma/generated';
import {
  credentialBatchExpiryHandler,
  type CredentialBatchExpiryDependencies,
} from '../../src/lib/credentials/credential-batch-expiry-job';
import type { JobContext } from '../../src/lib/jobs/types';
import {
  expireDueCredentialBatches,
  getCredentialBatchById,
} from '../../src/lib/prisma/repositories/credential-batch.repository';
import { getEncryptionService } from '../../src/lib/encryption/encryption';

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.BATCH_RETENTION_DAYS = '1';

const prisma = createRigClient();
const loggerCalls = jest.requireMock('@/lib/api/logger').appLogger as Record<string, jest.Mock>;

const TENANT_ID = 'tenant-1';
const NOW = new Date('2026-09-18T00:00:00.000Z');
const SETTLED_AT = new Date('2026-09-16T00:00:00.000Z');
const NATIVE_CREDENTIAL_ID = 'expiry-handler-native-credential';
const PAST_BATCH_ID = 'expiry-handler-past';
const FUTURE_BATCH_ID = 'expiry-handler-future';
const HELD_BATCH_ID = 'expiry-handler-held';
const RUNNING_BATCH_ID = 'expiry-handler-running';
const EXACT_NOW_BATCH_ID = 'expiry-handler-exact-now';

const ITEM = {
  credentialPayload: { issuer: { id: 'did:web:issuer.example' } },
  credentialType: 'DigitalProductPassport',
  version: '0.7.0',
};

type BatchItemFixture = {
  id: string;
  index: number;
  state: CredentialBatchItemState;
  credentialId?: string | null;
  errorClass?: string | null;
  errorMessage?: string | null;
  attemptToken?: string | null;
};

type BatchFixture = {
  id: string;
  correlationId?: string;
  state: CredentialBatchState;
  itemCount: number;
  queuedCount: number;
  processingCount: number;
  issuedCount: number;
  failedCount: number;
  unknownCount: number;
  idempotencyKey: string;
  bodyDigest: string;
  settledAt: Date | null;
  expiresAt: Date | null;
  attemptToken?: string | null;
  attemptStartedAt?: Date | null;
  version?: number;
  items: readonly BatchItemFixture[];
};

function encryptedRequest(): string {
  return JSON.stringify(getEncryptionService().encrypt(JSON.stringify(ITEM), EncryptionAlgorithm.AES_256_GCM));
}

async function insertBatch(fixture: BatchFixture): Promise<void> {
  await prisma.credentialBatch.create({
    data: {
      id: fixture.id,
      tenantId: TENANT_ID,
      correlationId: fixture.correlationId ?? `correlation-${fixture.id}`,
      state: fixture.state,
      itemCount: fixture.itemCount,
      queuedCount: fixture.queuedCount,
      processingCount: fixture.processingCount,
      issuedCount: fixture.issuedCount,
      failedCount: fixture.failedCount,
      unknownCount: fixture.unknownCount,
      idempotencyKey: fixture.idempotencyKey,
      bodyDigest: fixture.bodyDigest,
      settledAt: fixture.settledAt,
      expiresAt: fixture.expiresAt,
      attemptToken: fixture.attemptToken ?? null,
      attemptStartedAt: fixture.attemptStartedAt ?? null,
      version: fixture.version ?? 0,
    },
  });

  if (fixture.items.length === 0) return;
  await prisma.credentialBatchItem.createMany({
    data: fixture.items.map((item) => ({
      id: item.id,
      batchId: fixture.id,
      tenantId: TENANT_ID,
      index: item.index,
      state: item.state,
      request: encryptedRequest(),
      credentialId: item.credentialId ?? null,
      errorClass: item.errorClass ?? null,
      errorMessage: item.errorMessage ?? null,
      attemptToken: item.attemptToken ?? null,
    })),
  });
}

async function readBatchRows(batchId: string) {
  const [batch, items] = await Promise.all([
    prisma.credentialBatch.findUniqueOrThrow({ where: { id: batchId } }),
    prisma.credentialBatchItem.findMany({ where: { batchId }, orderBy: { index: 'asc' } }),
  ]);
  return { batch, items };
}

function jobContext(): JobContext {
  return {
    jobId: 'credential-batch-expiry-integration-test',
    attempt: 1,
    isFinalAttempt: true,
    expireSeconds: 300,
    signal: new AbortController().signal,
  };
}

describe('credential batch expiry worker', () => {
  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await prisma.tenant.createMany({
      data: [
        { id: 'tenant-1', name: 'Tenant One' },
        { id: 'tenant-2', name: 'Tenant Two' },
      ],
    });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('runs the real expiry handler through Postgres, preserves non-due rows, is idempotent, and treats expiresAt equal to now as due (repository uses <=)', async () => {
    await insertNativeCredential(prisma, { id: NATIVE_CREDENTIAL_ID, tenantId: TENANT_ID });
    await insertBatch({
      id: PAST_BATCH_ID,
      state: CredentialBatchState.COMPLETED,
      itemCount: 2,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 1,
      failedCount: 1,
      unknownCount: 0,
      idempotencyKey: 'expiry-handler-past-key',
      bodyDigest: 'expiry-handler-past-digest',
      settledAt: SETTLED_AT,
      expiresAt: new Date('2026-09-17T23:59:59.000Z'),
      items: [
        {
          id: 'expiry-handler-past-issued-item',
          index: 0,
          state: CredentialBatchItemState.ISSUED,
          credentialId: NATIVE_CREDENTIAL_ID,
        },
        {
          id: 'expiry-handler-past-failed-item',
          index: 1,
          state: CredentialBatchItemState.FAILED,
          errorClass: 'ISSUER_INVALID',
          errorMessage: 'fixture failure',
        },
      ],
    });
    await insertBatch({
      id: FUTURE_BATCH_ID,
      state: CredentialBatchState.COMPLETED,
      itemCount: 1,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 0,
      failedCount: 1,
      unknownCount: 0,
      idempotencyKey: 'expiry-handler-future-key',
      bodyDigest: 'expiry-handler-future-digest',
      settledAt: SETTLED_AT,
      expiresAt: new Date('2026-09-19T00:00:00.000Z'),
      items: [
        {
          id: 'expiry-handler-future-failed-item',
          index: 0,
          state: CredentialBatchItemState.FAILED,
          errorClass: 'ISSUER_INVALID',
          errorMessage: 'future fixture failure',
        },
      ],
    });
    await insertBatch({
      id: HELD_BATCH_ID,
      state: CredentialBatchState.NEEDS_ATTENTION,
      itemCount: 1,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 0,
      failedCount: 0,
      unknownCount: 1,
      idempotencyKey: 'expiry-handler-held-key',
      bodyDigest: 'expiry-handler-held-digest',
      settledAt: SETTLED_AT,
      expiresAt: null,
      version: 7,
      items: [
        {
          id: 'expiry-handler-held-unknown-item',
          index: 0,
          state: CredentialBatchItemState.OUTCOME_UNKNOWN,
          errorClass: 'OUTCOME_UNKNOWN',
          errorMessage: 'check the library',
        },
      ],
    });
    await insertBatch({
      id: RUNNING_BATCH_ID,
      state: CredentialBatchState.RUNNING,
      itemCount: 1,
      queuedCount: 0,
      processingCount: 1,
      issuedCount: 0,
      failedCount: 0,
      unknownCount: 0,
      idempotencyKey: 'expiry-handler-running-key',
      bodyDigest: 'expiry-handler-running-digest',
      settledAt: null,
      expiresAt: null,
      attemptToken: 'running-token',
      attemptStartedAt: new Date('2026-09-17T23:00:00.000Z'),
      version: 3,
      items: [
        {
          id: 'expiry-handler-running-processing-item',
          index: 0,
          state: CredentialBatchItemState.PROCESSING,
          attemptToken: 'running-token',
        },
      ],
    });

    const pastBefore = await readBatchRows(PAST_BATCH_ID);
    const untouchedBefore = await Promise.all([FUTURE_BATCH_ID, HELD_BATCH_ID, RUNNING_BATCH_ID].map(readBatchRows));
    expect(pastBefore.batch).toMatchObject({
      state: CredentialBatchState.COMPLETED,
      itemCount: 2,
      issuedCount: 1,
      failedCount: 1,
      settledAt: SETTLED_AT,
    });
    expect(pastBefore.items).toEqual([
      expect.objectContaining({
        index: 0,
        state: CredentialBatchItemState.ISSUED,
        credentialId: NATIVE_CREDENTIAL_ID,
      }),
      expect.objectContaining({ index: 1, state: CredentialBatchItemState.FAILED, credentialId: null }),
    ]);

    const dependencies: CredentialBatchExpiryDependencies = {
      expire: expireDueCredentialBatches,
      now: () => NOW,
    };
    const runExpiry = credentialBatchExpiryHandler(dependencies);

    loggerCalls.info.mockClear();
    await runExpiry({}, jobContext());
    // Guards a handler that bypasses the real repository or reports a different persisted expiry count.
    expect(loggerCalls.info).toHaveBeenCalledTimes(1);
    expect(loggerCalls.info).toHaveBeenCalledWith({ expired: 1 }, 'Credential batch expiry sweep finished');

    // Guards expiry failing to change the due batch to its readable tombstone state.
    await expect(getCredentialBatchById(PAST_BATCH_ID, TENANT_ID)).resolves.toMatchObject({
      id: PAST_BATCH_ID,
      state: CredentialBatchState.EXPIRED,
      itemCount: 2,
      issuedCount: 1,
      failedCount: 1,
      settledAt: SETTLED_AT,
      items: [],
    });
    // Guards expiry retaining confidential item rows instead of deleting both past-due outcomes.
    await expect(prisma.credentialBatchItem.count({ where: { batchId: PAST_BATCH_ID } })).resolves.toBe(0);
    // Guards expiry deleting the native credential referenced by the issued batch item.
    await expect(prisma.credential.findUnique({ where: { id: NATIVE_CREDENTIAL_ID } })).resolves.toMatchObject({
      id: NATIVE_CREDENTIAL_ID,
      tenantId: TENANT_ID,
      origin: LibraryRecordOrigin.NATIVE,
    });
    await expect(prisma.libraryRecord.findUnique({ where: { id: NATIVE_CREDENTIAL_ID } })).resolves.toMatchObject({
      id: NATIVE_CREDENTIAL_ID,
      tenantId: TENANT_ID,
      origin: LibraryRecordOrigin.NATIVE,
    });

    const untouchedAfter = await Promise.all([FUTURE_BATCH_ID, HELD_BATCH_ID, RUNNING_BATCH_ID].map(readBatchRows));
    // Guards expiry touching a future completed batch, a held batch with a past settlement and no deadline, or a running batch.
    expect(untouchedAfter).toEqual(untouchedBefore);

    const rowsAfterFirstSweep = await Promise.all(
      [PAST_BATCH_ID, FUTURE_BATCH_ID, HELD_BATCH_ID, RUNNING_BATCH_ID].map(readBatchRows),
    );
    loggerCalls.info.mockClear();
    await runExpiry({}, jobContext());
    // Guards a second sweep changing rows after the first sweep has converged.
    expect(loggerCalls.info).toHaveBeenCalledTimes(1);
    expect(loggerCalls.info).toHaveBeenCalledWith({ expired: 0 }, 'Credential batch expiry sweep finished');
    expect(
      await Promise.all([PAST_BATCH_ID, FUTURE_BATCH_ID, HELD_BATCH_ID, RUNNING_BATCH_ID].map(readBatchRows)),
    ).toEqual(rowsAfterFirstSweep);

    await insertBatch({
      id: EXACT_NOW_BATCH_ID,
      state: CredentialBatchState.COMPLETED,
      itemCount: 0,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 0,
      failedCount: 0,
      unknownCount: 0,
      idempotencyKey: 'expiry-handler-exact-now-key',
      bodyDigest: 'expiry-handler-exact-now-digest',
      settledAt: SETTLED_AT,
      expiresAt: NOW,
      items: [],
    });
    loggerCalls.info.mockClear();
    await runExpiry({}, jobContext());
    // Guards changing the repository's lte boundary to a strict less-than comparison.
    expect(loggerCalls.info).toHaveBeenCalledTimes(1);
    expect(loggerCalls.info).toHaveBeenCalledWith({ expired: 1 }, 'Credential batch expiry sweep finished');
    await expect(
      prisma.credentialBatch.findUniqueOrThrow({ where: { id: EXACT_NOW_BATCH_ID } }),
    ).resolves.toMatchObject({
      id: EXACT_NOW_BATCH_ID,
      state: CredentialBatchState.EXPIRED,
      expiresAt: NOW,
    });
  });
});
