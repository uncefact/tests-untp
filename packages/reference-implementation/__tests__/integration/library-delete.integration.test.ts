import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsStatus,
  ExternalContentKind,
  IdempotencyOperation,
  LibraryRecordOrigin,
  type PrismaClient,
} from '../../src/lib/prisma/generated/index.js';
import type { JobContext } from '../../src/lib/jobs/types';
import {
  StoredCopyReadError,
  defaultVerifyGenerationDependencies,
  verifyGenerationHandler,
  type VerifyGenerationDependencies,
} from '../../src/lib/library/verify-generation-job';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertNativeCredential, seedSystemTenant } from './fixtures';
import { holdRowForUpdate, waitForQueueBehind, type LockHolder } from './rig/locks';
import { prisma } from '../../src/lib/prisma/prisma';
import { isTransactionDeadlock } from '../../src/lib/prisma/db-errors';
import {
  deleteLibraryRecord,
  deleteLibraryRecordTestHooks,
  LibraryRecordDeletePlanAnomalyError,
  getLibraryRecordById,
  listLibraryRecords,
  updateLibraryRecordAnnotations,
} from '../../src/lib/prisma/repositories/library-record.repository';
import {
  noChecksRun,
  settleCheckRunComplete,
  settleCheckRunFailed,
} from '../../src/lib/prisma/repositories/check-run.repository';
import { claimIdempotencyKey, findIdempotencyKey } from '../../src/lib/prisma/repositories/idempotency-key.repository';

const OWNER_TENANT_ID = 'library-delete-owner';
const OTHER_TENANT_ID = 'library-delete-other';

const client = createRigClient();
const concurrent = createRigClient();
const observer = createRigClient();
const holders: LockHolder[] = [];

const COMPLETE_CHECKS = {
  retrieval: CheckResult.PASS,
  decryption: CheckResult.NOT_RUN,
  digest: CheckResult.PASS,
  proof: CheckResult.PASS,
  status: CheckResult.PASS,
  temporal: CheckResult.PASS,
  schemaConformance: CheckResult.PASS,
};

type Storage = {
  storageUri: string | null;
  storageDigestMultibase: string | null;
  storageServiceInstanceId: string | null;
  storageExternalId: string | null;
  storageBucket: string | null;
};

const EMPTY_STORAGE: Storage = {
  storageUri: null,
  storageDigestMultibase: null,
  storageServiceInstanceId: null,
  storageExternalId: null,
  storageBucket: null,
};

function storageFor(id: string): Storage {
  return {
    storageUri: `https://storage.example/${id}`,
    storageDigestMultibase: `zStorageDigest-${id}`,
    storageServiceInstanceId: `storage-instance-${id}`,
    storageExternalId: `storage-object-${id}`,
    storageBucket: `bucket-${id}`,
  };
}

function deleteStorage(storage: Storage): Omit<Storage, 'storageDigestMultibase'> {
  const { storageDigestMultibase, ...coordinates } = storage;
  void storageDigestMultibase;
  return coordinates;
}

function deleteStorageFor(id: string): Omit<Storage, 'storageDigestMultibase'> {
  return deleteStorage(storageFor(id));
}

function jobContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 'library-delete-job',
    attempt: 1,
    isFinalAttempt: true,
    signal: new AbortController().signal,
    ...overrides,
    expireSeconds: overrides.expireSeconds ?? 300,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfil) => {
    resolve = fulfil;
  });
  return { promise, resolve };
}

type ExternalOptions = {
  id: string;
  tenantId?: string;
  storage?: Storage;
  contentDigest?: string | null;
  state?: CheckRunState;
  generations?: number;
  claim?: boolean;
  duplicateOfRecordId?: string | null;
  createdAt?: Date;
  contentKind?: ExternalContentKind;
};

async function createExternal(database: PrismaClient, options: ExternalOptions): Promise<void> {
  const tenantId = options.tenantId ?? OWNER_TENANT_ID;
  const storage = options.storage ?? storageFor(options.id);
  const createdAt = options.createdAt ?? new Date('2026-01-01T00:00:00.000Z');
  const generations = options.generations ?? 1;
  const state = options.state ?? CheckRunState.COMPLETE;
  const digest = options.contentDigest === undefined ? `zContentDigest-${options.id}` : options.contentDigest;

  await database.$transaction(async (tx) => {
    await tx.libraryRecord.create({
      data: {
        id: options.id,
        tenantId,
        origin: LibraryRecordOrigin.EXTERNAL,
        name: 'Delete test credential',
        issuerName: 'Delete test supplier',
        issuerDid: 'did:web:delete-test.example',
        subjectName: 'Delete test product',
        subjectId: 'https://delete-test.example/product',
        credentialType: 'DigitalProductPassport',
        coreCredentialType: CoreCredentialType.DPP,
        coreDataModelVersion: '0.6.0',
        detailsStatus: CredentialDetailsStatus.EXTRACTED,
        createdAt,
        updatedAt: createdAt,
      },
    });
    await tx.externalCredential.create({
      data: {
        id: options.id,
        tenantId,
        sourceUrl: 'https://supplier.example/delete-test',
        sourceDigest: 'zSourceDigest-delete-test',
        contentDigest: digest,
        duplicateOfRecordId: options.duplicateOfRecordId ?? null,
        encrypted: false,
        contentKind: options.contentKind ?? ExternalContentKind.CREDENTIAL,
        ...storage,
        displayName: 'Delete test credential',
        declaredCredentialType: CoreCredentialType.DPP,
        dateReceived: new Date('2026-01-02T00:00:00.000Z'),
        notes: 'Delete test notes',
        createdAt,
        updatedAt: createdAt,
      },
    });
    for (let generation = 1; generation <= generations; generation += 1) {
      const pending = generation === generations && state === CheckRunState.PENDING;
      const runState = pending || generations === 1 ? state : CheckRunState.COMPLETE;
      await tx.checkRun.create({
        data: {
          id: `${options.id}-run-${generation}`,
          recordId: options.id,
          tenantId,
          generation,
          state: runState,
          ...(runState === CheckRunState.PENDING ? noChecksRun() : COMPLETE_CHECKS),
          requestedAt: createdAt,
          completedAt: runState === CheckRunState.PENDING ? null : new Date(createdAt.getTime() + 1_000),
        },
      });
    }
  });

  if (options.claim) {
    await database.idempotencyKey.create({
      data: {
        id: `${options.id}-claim`,
        tenantId,
        operation: IdempotencyOperation.LIBRARY_REGISTER,
        key: `${options.id}-key`,
        bodyDigest: `${options.id}-body`,
        recordId: options.id,
        responseBody: null,
      },
    });
  }
}

async function snapshot(database: PrismaClient, id: string, tenantId = OWNER_TENANT_ID) {
  return database.$transaction(async (tx) => ({
    parent: await tx.libraryRecord.findUnique({ where: { id } }),
    external: await tx.externalCredential.findUnique({ where: { id } }),
    runs: await tx.checkRun.findMany({ where: { recordId: id, tenantId }, orderBy: { generation: 'asc' } }),
    claim: await tx.idempotencyKey.findFirst({ where: { recordId: id, tenantId } }),
  }));
}

async function holdParent(id: string): Promise<LockHolder> {
  const holder = await holdRowForUpdate(concurrent, { table: 'LibraryRecord', id, tenantId: OWNER_TENANT_ID });
  holders.push(holder);
  return holder;
}

async function holdRun(id: string): Promise<LockHolder> {
  const holder = await holdRowForUpdate(concurrent, { table: 'CheckRun', id, tenantId: OWNER_TENANT_ID });
  holders.push(holder);
  return holder;
}

beforeEach(async () => {
  await truncateApplicationTables(client);
  await seedSystemTenant(client);
  await client.tenant.create({ data: { id: OWNER_TENANT_ID, name: 'Library delete owner' } });
  await client.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Library delete other' } });
});

afterEach(async () => {
  deleteLibraryRecordTestHooks.beforeLock = undefined;
  deleteLibraryRecordTestHooks.onAttemptError = undefined;
  for (const holder of holders.splice(0)) {
    holder.release();
    await holder.done.catch(() => undefined);
  }
});

afterAll(async () => {
  await client.$disconnect();
  await concurrent.$disconnect();
  await observer.$disconnect();
});

describe('DELETE /library/{id} database behaviour', () => {
  it('cascades the external family, every generation and its linked claim while preserving unrelated rows', async () => {
    await createExternal(client, { id: 'delete-target', generations: 2, state: CheckRunState.PENDING, claim: true });
    await createExternal(client, { id: 'delete-unrelated' });
    await insertNativeCredential(client, { id: 'delete-native', tenantId: OWNER_TENANT_ID });
    await createExternal(client, { id: 'delete-foreign', tenantId: OTHER_TENANT_ID });

    const result = await deleteLibraryRecord({ recordId: 'delete-target', tenantId: OWNER_TENANT_ID });

    expect(result).toEqual({ outcome: 'deleted', storage: deleteStorageFor('delete-target') });
    expect(await snapshot(client, 'delete-target')).toEqual({ parent: null, external: null, runs: [], claim: null });
    expect(await client.libraryRecord.findUnique({ where: { id: 'delete-unrelated' } })).not.toBeNull();
    expect(await client.libraryRecord.findUnique({ where: { id: 'delete-native' } })).not.toBeNull();
    expect(await client.libraryRecord.findUnique({ where: { id: 'delete-foreign' } })).not.toBeNull();
  });

  it('disappears from fresh detail and list reads after deletion', async () => {
    await createExternal(client, { id: 'delete-read-target' });
    await createExternal(client, { id: 'delete-read-survivor' });

    const before = await listLibraryRecords({ tenantId: OWNER_TENANT_ID, sort: 'createdAt:asc' });
    expect(before.data.map((record) => record.record.id)).toEqual(['delete-read-survivor', 'delete-read-target']);

    await expect(
      deleteLibraryRecord({ recordId: 'delete-read-target', tenantId: OWNER_TENANT_ID }),
    ).resolves.toMatchObject({
      outcome: 'deleted',
    });

    expect(await getLibraryRecordById('delete-read-target', OWNER_TENANT_ID)).toBeNull();
    const after = await listLibraryRecords({ tenantId: OWNER_TENANT_ID, sort: 'createdAt:asc' });
    expect(after.total).toBe(before.total - 1);
    expect(after.data.map((record) => record.record.id)).toEqual(['delete-read-survivor']);
  });

  it('returns native only for the caller tenant and treats foreign native and external ids as missing', async () => {
    await insertNativeCredential(client, { id: 'delete-own-native', tenantId: OWNER_TENANT_ID });
    await insertNativeCredential(client, { id: 'delete-foreign-native', tenantId: OTHER_TENANT_ID });
    await createExternal(client, { id: 'delete-foreign-external', tenantId: OTHER_TENANT_ID });

    await expect(deleteLibraryRecord({ recordId: 'delete-own-native', tenantId: OWNER_TENANT_ID })).resolves.toEqual({
      outcome: 'native',
    });
    await expect(
      deleteLibraryRecord({ recordId: 'delete-foreign-native', tenantId: OWNER_TENANT_ID }),
    ).resolves.toEqual({ outcome: 'missing' });
    await expect(
      deleteLibraryRecord({ recordId: 'delete-foreign-external', tenantId: OWNER_TENANT_ID }),
    ).resolves.toEqual({ outcome: 'missing' });
    await expect(deleteLibraryRecord({ recordId: 'delete-never-existed', tenantId: OWNER_TENANT_ID })).resolves.toEqual(
      {
        outcome: 'missing',
      },
    );
    expect(await client.libraryRecord.findUnique({ where: { id: 'delete-own-native' } })).not.toBeNull();
    expect(await client.libraryRecord.findUnique({ where: { id: 'delete-foreign-native' } })).not.toBeNull();
    expect(await client.libraryRecord.findUnique({ where: { id: 'delete-foreign-external' } })).not.toBeNull();
  });

  it('deletes pending and no-copy records, including a no-copy holder with a content identity', async () => {
    await createExternal(client, {
      id: 'delete-no-copy-holder',
      storage: EMPTY_STORAGE,
      state: CheckRunState.PENDING,
      contentDigest: 'zNoCopyHolderDigest',
    });

    const result = await deleteLibraryRecord({ recordId: 'delete-no-copy-holder', tenantId: OWNER_TENANT_ID });

    expect(result).toEqual({ outcome: 'deleted', storage: deleteStorage(EMPTY_STORAGE) });
    expect(await snapshot(client, 'delete-no-copy-holder')).toEqual({
      parent: null,
      external: null,
      runs: [],
      claim: null,
    });
  });

  it.each([
    ['successfully', false],
    ['after a terminal copy failure', true],
  ])('does not let a running verification restore a deleted record %s', async (_name, terminalFailure) => {
    const id = terminalFailure ? 'delete-running-terminal' : 'delete-running-success';
    await createExternal(client, { id, state: CheckRunState.PENDING, contentKind: ExternalContentKind.OPAQUE });
    const run = await client.checkRun.findUniqueOrThrow({ where: { id: `${id}-run-1` } });
    const record = await getLibraryRecordById(id, OWNER_TENANT_ID);
    expect(record?.origin).toBe(LibraryRecordOrigin.EXTERNAL);

    const recordRead = deferred<void>();
    const releaseVerification = deferred<void>();
    // The real settlement functions, observed: the case is only proved when
    // the intended branch reached settlement and settlement answered
    // `missing` for the vanished run.
    const base = defaultVerifyGenerationDependencies();
    const settlements: Array<[string, string]> = [];
    const deps: VerifyGenerationDependencies = {
      ...base,
      settleComplete: async (input) => {
        const outcome = await base.settleComplete(input);
        settlements.push(['complete', outcome.outcome]);
        return outcome;
      },
      settleFailed: async (input) => {
        const outcome = await base.settleFailed(input);
        settlements.push(['failed', outcome.outcome]);
        return outcome;
      },
      findRun: async () => run,
      getRecord: async () => {
        recordRead.resolve(undefined);
        await releaseVerification.promise;
        return record;
      },
      fetchStoredCopy: terminalFailure
        ? jest.fn().mockRejectedValue(new StoredCopyReadError('terminal', 'storage returned HTTP 404'))
        : jest.fn().mockResolvedValue(new TextEncoder().encode('the pinned opaque copy')),
      verifyDigest: jest.fn().mockResolvedValue(true),
      resolveVerifier: jest.fn().mockRejectedValue(new Error('opaque copies do not call the verifier')),
    };
    const handler = verifyGenerationHandler(deps);
    const verification = handler(
      {
        tenantId: OWNER_TENANT_ID,
        recordId: id,
        generation: run.generation,
        checkRunId: run.id,
      },
      jobContext(),
    );
    await recordRead.promise;

    await expect(deleteLibraryRecord({ recordId: id, tenantId: OWNER_TENANT_ID })).resolves.toMatchObject({
      outcome: 'deleted',
    });
    releaseVerification.resolve(undefined);
    await verification;

    expect(settlements).toEqual([[terminalFailure ? 'failed' : 'complete', 'missing']]);
    expect(await client.libraryRecord.findUnique({ where: { id } })).toBeNull();
    expect(await client.checkRun.findUnique({ where: { id: run.id } })).toBeNull();
  });

  it('returns missing on a second delete and frees a linked idempotency key', async () => {
    await createExternal(client, { id: 'delete-idempotent', claim: true });

    await expect(
      deleteLibraryRecord({ recordId: 'delete-idempotent', tenantId: OWNER_TENANT_ID }),
    ).resolves.toMatchObject({
      outcome: 'deleted',
    });
    await expect(deleteLibraryRecord({ recordId: 'delete-idempotent', tenantId: OWNER_TENANT_ID })).resolves.toEqual({
      outcome: 'missing',
    });
    await expect(
      findIdempotencyKey({
        tenantId: OWNER_TENANT_ID,
        operation: IdempotencyOperation.LIBRARY_REGISTER,
        key: 'delete-idempotent-key',
        bodyDigest: 'delete-idempotent-body',
      }),
    ).resolves.toEqual({ outcome: 'absent' });
    await expect(
      claimIdempotencyKey({
        tenantId: OWNER_TENANT_ID,
        operation: IdempotencyOperation.LIBRARY_REGISTER,
        key: 'delete-idempotent-key',
        bodyDigest: 'new-body-digest',
      }),
    ).resolves.toMatchObject({ outcome: 'claimed' });
  });

  it('promotes the oldest advisory and repoints the remaining advisory before deleting the holder', async () => {
    await createExternal(client, { id: 'delete-holder', contentDigest: 'zSharedDeleteDigest' });
    await createExternal(client, {
      id: 'delete-advisory-b',
      contentDigest: null,
      duplicateOfRecordId: 'delete-holder',
      storage: EMPTY_STORAGE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await createExternal(client, {
      id: 'delete-advisory-c',
      contentDigest: null,
      duplicateOfRecordId: 'delete-holder',
      storage: EMPTY_STORAGE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await createExternal(client, { id: 'delete-unrelated', contentDigest: 'zUnrelatedDeleteDigest' });

    const before = await Promise.all(
      ['delete-advisory-b', 'delete-advisory-c', 'delete-unrelated'].map((id) =>
        client.libraryRecord.findUniqueOrThrow({ where: { id } }),
      ),
    );
    const result = await deleteLibraryRecord({ recordId: 'delete-holder', tenantId: OWNER_TENANT_ID });

    expect(result).toEqual({ outcome: 'deleted', storage: deleteStorageFor('delete-holder') });
    expect(await client.externalCredential.findUnique({ where: { id: 'delete-advisory-b' } })).toMatchObject({
      contentDigest: 'zSharedDeleteDigest',
      duplicateOfRecordId: null,
    });
    expect(await client.externalCredential.findUnique({ where: { id: 'delete-advisory-c' } })).toMatchObject({
      contentDigest: null,
      duplicateOfRecordId: 'delete-advisory-b',
    });
    const after = await Promise.all(
      ['delete-advisory-b', 'delete-advisory-c', 'delete-unrelated'].map((id) =>
        client.libraryRecord.findUniqueOrThrow({ where: { id } }),
      ),
    );
    // ADR-053 decision 1: promotion touched B and C, so their parents moved;
    // a record the promotion never wrote keeps its timestamp.
    expect(after[0].updatedAt.getTime()).toBeGreaterThan(before[0].updatedAt.getTime());
    expect(after[1].updatedAt.getTime()).toBeGreaterThan(before[1].updatedAt.getTime());
    expect(after[2].updatedAt.getTime()).toBe(before[2].updatedAt.getTime());
  });

  it('keeps promotion and deletion of the promoted advisory serialised', async () => {
    await createExternal(client, { id: 'delete-inflight-holder', contentDigest: 'zInflightDeleteDigest' });
    await createExternal(client, {
      id: 'delete-inflight-advisory-b',
      contentDigest: null,
      duplicateOfRecordId: 'delete-inflight-holder',
      storage: EMPTY_STORAGE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await createExternal(client, {
      id: 'delete-inflight-advisory-c',
      contentDigest: null,
      duplicateOfRecordId: 'delete-inflight-holder',
      storage: EMPTY_STORAGE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const holder = await holdParent('delete-inflight-advisory-b');
    const deletingHolder = deleteLibraryRecord({ recordId: 'delete-inflight-holder', tenantId: OWNER_TENANT_ID });
    await waitForQueueBehind(observer, holder.pid, 1);
    const deletingAdvisory = deleteLibraryRecord({
      recordId: 'delete-inflight-advisory-b',
      tenantId: OWNER_TENANT_ID,
    });
    await waitForQueueBehind(observer, holder.pid, 2);
    holder.release();
    await holder.done;

    await expect(Promise.all([deletingHolder, deletingAdvisory])).resolves.toEqual([
      { outcome: 'deleted', storage: deleteStorageFor('delete-inflight-holder') },
      { outcome: 'deleted', storage: deleteStorage(EMPTY_STORAGE) },
    ]);
    expect(await client.libraryRecord.findUnique({ where: { id: 'delete-inflight-holder' } })).toBeNull();
    expect(await client.libraryRecord.findUnique({ where: { id: 'delete-inflight-advisory-b' } })).toBeNull();
    expect(await client.externalCredential.findUnique({ where: { id: 'delete-inflight-advisory-c' } })).toMatchObject({
      contentDigest: 'zInflightDeleteDigest',
      duplicateOfRecordId: null,
    });
  });

  it.each([
    ['holder queued first', true],
    ['advisory queued first', false],
  ])('completes concurrent holder and advisory deletes without a deadlock when %s', async (_name, holderFirst) => {
    await createExternal(client, { id: 'delete-ordering-holder', contentDigest: 'zOrderingDeleteDigest' });
    await createExternal(client, {
      id: 'delete-ordering-advisory-b',
      contentDigest: null,
      duplicateOfRecordId: 'delete-ordering-holder',
      storage: EMPTY_STORAGE,
    });
    await createExternal(client, {
      id: 'delete-ordering-advisory-c',
      contentDigest: null,
      duplicateOfRecordId: 'delete-ordering-holder',
      storage: EMPTY_STORAGE,
    });

    const parentHolder = await holdParent('delete-ordering-advisory-b');
    // Every failed attempt passes through this seam before the retry logic,
    // so the test can tell a deadlock retry (which `withDeadlockRetry` would
    // otherwise absorb, letting a regressed lock order pass) from the plan
    // restart the holder-first order legitimately takes: the advisory's
    // delete plans its lock set before the holder's promotion repoints C onto
    // it, finds C unlocked under lock, and re-plans once.
    const attemptErrors: unknown[] = [];
    deleteLibraryRecordTestHooks.onAttemptError = (error) => {
      attemptErrors.push(error);
    };
    const deleteHolder = () => deleteLibraryRecord({ recordId: 'delete-ordering-holder', tenantId: OWNER_TENANT_ID });
    const deleteAdvisory = () =>
      deleteLibraryRecord({ recordId: 'delete-ordering-advisory-b', tenantId: OWNER_TENANT_ID });
    let first: ReturnType<typeof deleteHolder>;
    let second: ReturnType<typeof deleteAdvisory>;
    if (holderFirst) {
      first = deleteHolder();
      await waitForQueueBehind(observer, parentHolder.pid, 1);
      second = deleteAdvisory();
    } else {
      first = deleteAdvisory();
      await waitForQueueBehind(observer, parentHolder.pid, 1);
      second = deleteHolder();
    }
    await waitForQueueBehind(observer, parentHolder.pid, 2);
    parentHolder.release();
    await parentHolder.done;

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(attemptErrors.filter((error) => isTransactionDeadlock(error))).toEqual([]);
    expect(attemptErrors.filter((error) => error instanceof LibraryRecordDeletePlanAnomalyError)).toHaveLength(
      holderFirst ? 1 : 0,
    );
    expect(attemptErrors).toHaveLength(holderFirst ? 1 : 0);
    const holderResult = holderFirst ? firstResult : secondResult;
    const advisoryResult = holderFirst ? secondResult : firstResult;
    expect(holderResult).toEqual({ outcome: 'deleted', storage: deleteStorageFor('delete-ordering-holder') });
    expect(advisoryResult).toEqual({ outcome: 'deleted', storage: deleteStorage(EMPTY_STORAGE) });
    expect(await client.externalCredential.findUnique({ where: { id: 'delete-ordering-advisory-c' } })).toMatchObject({
      contentDigest: 'zOrderingDeleteDigest',
      duplicateOfRecordId: null,
    });
  });

  it('replans once when a new advisory attaches after the first delete plan', async () => {
    await createExternal(client, { id: 'delete-restart-holder', contentDigest: 'zRestartDeleteDigest' });
    await createExternal(client, {
      id: 'delete-restart-advisory-b',
      contentDigest: null,
      duplicateOfRecordId: 'delete-restart-holder',
      storage: EMPTY_STORAGE,
    });
    await createExternal(client, {
      id: 'delete-restart-advisory-c',
      contentDigest: null,
      duplicateOfRecordId: 'delete-restart-holder',
      storage: EMPTY_STORAGE,
    });

    const parentHolder = await holdParent('delete-restart-holder');
    const planned = deferred<void>();
    const releaseFirstLock = deferred<void>();
    let lockAttempt = 0;
    deleteLibraryRecordTestHooks.beforeLock = async () => {
      lockAttempt += 1;
      if (lockAttempt === 1) {
        planned.resolve(undefined);
        await releaseFirstLock.promise;
      }
    };

    const deletion = deleteLibraryRecord({ recordId: 'delete-restart-holder', tenantId: OWNER_TENANT_ID });
    await planned.promise;
    const attaching = createExternal(concurrent, {
      id: 'delete-restart-advisory-d',
      contentDigest: null,
      duplicateOfRecordId: 'delete-restart-holder',
      storage: EMPTY_STORAGE,
    });
    await waitForQueueBehind(observer, parentHolder.pid, 1);
    parentHolder.release();
    await parentHolder.done;
    await attaching;
    releaseFirstLock.resolve(undefined);

    await expect(deletion).resolves.toMatchObject({ outcome: 'deleted' });
    expect(lockAttempt).toBe(2);
    expect(await client.libraryRecord.findUnique({ where: { id: 'delete-restart-holder' } })).toBeNull();
    expect(await client.externalCredential.findUnique({ where: { id: 'delete-restart-advisory-b' } })).toMatchObject({
      contentDigest: 'zRestartDeleteDigest',
      duplicateOfRecordId: null,
    });
    expect(await client.externalCredential.findUnique({ where: { id: 'delete-restart-advisory-d' } })).toMatchObject({
      contentDigest: null,
      duplicateOfRecordId: 'delete-restart-advisory-b',
    });
  });

  it('rolls promotion and the cascade back when the parent delete itself fails', async () => {
    // A failure after promotion but before commit must undo the promotion
    // too: this is the plan's trigger schedule (a test-owned BEFORE DELETE
    // trigger refuses the holder), proving the promotion writes live in the
    // same transaction as the delete against the real database.
    await createExternal(client, { id: 'delete-trigger-holder', claim: true, contentDigest: 'zTriggerDeleteDigest' });
    await createExternal(client, {
      id: 'delete-trigger-advisory-b',
      contentDigest: null,
      duplicateOfRecordId: 'delete-trigger-holder',
      storage: EMPTY_STORAGE,
    });
    await createExternal(client, {
      id: 'delete-trigger-advisory-c',
      contentDigest: null,
      duplicateOfRecordId: 'delete-trigger-holder',
      storage: EMPTY_STORAGE,
    });
    const ids = ['delete-trigger-holder', 'delete-trigger-advisory-b', 'delete-trigger-advisory-c'];
    const before = await Promise.all(ids.map((id) => snapshot(client, id)));
    await client.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_refuse_library_delete() RETURNS trigger AS $$
      BEGIN
        IF OLD."id" = 'delete-trigger-holder' THEN
          RAISE EXCEPTION 'test trigger refused the parent delete';
        END IF;
        RETURN OLD;
      END
      $$ LANGUAGE plpgsql
    `);
    await client.$executeRawUnsafe(`
      CREATE TRIGGER test_refuse_library_delete BEFORE DELETE ON "LibraryRecord"
      FOR EACH ROW EXECUTE FUNCTION test_refuse_library_delete()
    `);

    try {
      await expect(
        deleteLibraryRecord({ recordId: 'delete-trigger-holder', tenantId: OWNER_TENANT_ID }),
      ).rejects.toThrow(/test trigger refused the parent delete/);
      expect(await Promise.all(ids.map((id) => snapshot(client, id)))).toEqual(before);
    } finally {
      await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_refuse_library_delete ON "LibraryRecord"');
      await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_refuse_library_delete()');
    }
  });

  it('rolls the complete delete back when its backend is terminated before commit', async () => {
    await createExternal(client, {
      id: 'delete-terminate-holder',
      claim: true,
      contentDigest: 'zTerminateDeleteDigest',
    });
    await createExternal(client, {
      id: 'delete-terminate-advisory-b',
      contentDigest: null,
      duplicateOfRecordId: 'delete-terminate-holder',
      storage: EMPTY_STORAGE,
    });
    await createExternal(client, {
      id: 'delete-terminate-advisory-c',
      contentDigest: null,
      duplicateOfRecordId: 'delete-terminate-holder',
      storage: EMPTY_STORAGE,
    });
    const ids = ['delete-terminate-holder', 'delete-terminate-advisory-b', 'delete-terminate-advisory-c'];
    const before = await Promise.all(ids.map((id) => snapshot(client, id)));
    const transactionClient = createRigClient();
    const backendReady = deferred<number>();
    const writesDone = deferred<void>();
    const releaseCommit = deferred<void>();
    const intercepted = prisma as unknown as { $transaction: unknown };
    const realTransaction = intercepted.$transaction;
    intercepted.$transaction = async (...args: unknown[]) => {
      const callback = args[0] as (tx: unknown) => Promise<unknown>;
      const options = args[1];
      return transactionClient.$transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        backendReady.resolve(backend.pid);
        const result = await callback(tx);
        writesDone.resolve(undefined);
        await releaseCommit.promise;
        return result;
      }, options as never);
    };

    try {
      const deletion = deleteLibraryRecord({ recordId: 'delete-terminate-holder', tenantId: OWNER_TENANT_ID });
      const backendPid = await backendReady.promise;
      await writesDone.promise;
      const [terminated] = await observer.$queryRaw<{ terminated: boolean }[]>`
        SELECT pg_terminate_backend(${backendPid}::integer) AS terminated
      `;
      expect(terminated.terminated).toBe(true);
      releaseCommit.resolve(undefined);
      await expect(deletion).rejects.toBeDefined();
      expect(await Promise.all(ids.map((id) => snapshot(client, id)))).toEqual(before);
    } finally {
      intercepted.$transaction = realTransaction;
      releaseCommit.resolve(undefined);
      await transactionClient.$disconnect();
    }
  });

  it('deleting an advisory leaves the holder, its copy and other pointers intact', async () => {
    await createExternal(client, { id: 'delete-advisory-holder', contentDigest: 'zAdvisoryDeleteDigest' });
    await createExternal(client, {
      id: 'delete-advisory-one',
      contentDigest: null,
      duplicateOfRecordId: 'delete-advisory-holder',
      storage: EMPTY_STORAGE,
    });
    await createExternal(client, {
      id: 'delete-advisory-two',
      contentDigest: null,
      duplicateOfRecordId: 'delete-advisory-holder',
      storage: EMPTY_STORAGE,
    });

    await expect(deleteLibraryRecord({ recordId: 'delete-advisory-one', tenantId: OWNER_TENANT_ID })).resolves.toEqual({
      outcome: 'deleted',
      storage: deleteStorage(EMPTY_STORAGE),
    });
    expect(await client.externalCredential.findUnique({ where: { id: 'delete-advisory-holder' } })).toMatchObject({
      contentDigest: 'zAdvisoryDeleteDigest',
      ...storageFor('delete-advisory-holder'),
    });
    expect(await client.externalCredential.findUnique({ where: { id: 'delete-advisory-two' } })).toMatchObject({
      duplicateOfRecordId: 'delete-advisory-holder',
    });
  });

  it('frees a holder with no advisories so the identity can be registered again', async () => {
    await createExternal(client, { id: 'delete-free-holder', contentDigest: 'zFreeDeleteDigest' });

    await deleteLibraryRecord({ recordId: 'delete-free-holder', tenantId: OWNER_TENANT_ID });
    await expect(
      createExternal(client, { id: 'delete-free-replacement', contentDigest: 'zFreeDeleteDigest' }),
    ).resolves.toBeUndefined();
  });

  it('serialises PATCH before DELETE and returns the corresponding production writer outcomes', async () => {
    await createExternal(client, { id: 'delete-patch-first' });
    const holder = await holdParent('delete-patch-first');
    const patch = updateLibraryRecordAnnotations({
      recordId: 'delete-patch-first',
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      changes: { notes: 'patched before delete' },
    });
    await waitForQueueBehind(observer, holder.pid, 1);
    const deletion = deleteLibraryRecord({ recordId: 'delete-patch-first', tenantId: OWNER_TENANT_ID });
    await waitForQueueBehind(observer, holder.pid, 2);
    holder.release();
    await holder.done;

    await expect(patch).resolves.toMatchObject({ outcome: 'updated' });
    await expect(deletion).resolves.toMatchObject({ outcome: 'deleted' });
  });

  it('serialises DELETE before PATCH so the patch writer observes a missing record', async () => {
    await createExternal(client, { id: 'delete-delete-first' });
    const holder = await holdParent('delete-delete-first');
    const deletion = deleteLibraryRecord({ recordId: 'delete-delete-first', tenantId: OWNER_TENANT_ID });
    await waitForQueueBehind(observer, holder.pid, 1);
    const patch = updateLibraryRecordAnnotations({
      recordId: 'delete-delete-first',
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      changes: { notes: 'must not persist' },
    });
    await waitForQueueBehind(observer, holder.pid, 2);
    holder.release();
    await holder.done;

    await expect(deletion).resolves.toMatchObject({ outcome: 'deleted' });
    await expect(patch).resolves.toEqual({ outcome: 'missing' });
  });

  it('lets the first of two parent-queued deletes win and the second return missing', async () => {
    await createExternal(client, { id: 'delete-two-callers' });
    const holder = await holdParent('delete-two-callers');
    const first = deleteLibraryRecord({ recordId: 'delete-two-callers', tenantId: OWNER_TENANT_ID });
    const second = deleteLibraryRecord({ recordId: 'delete-two-callers', tenantId: OWNER_TENANT_ID });
    await waitForQueueBehind(observer, holder.pid, 2);
    holder.release();
    await holder.done;

    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.outcome).sort()).toEqual(['deleted', 'missing']);
  });

  it.each([
    ['settlement first', true],
    ['delete first', false],
  ])(
    'settles a pending run and cascades it without recreation when queued in the %s order',
    async (_name, settlementFirst) => {
      await createExternal(client, { id: 'delete-settlement', state: CheckRunState.PENDING });
      const holder = await holdRun('delete-settlement-run-1');
      let settlement: ReturnType<typeof settleCheckRunComplete>;
      let deletion: ReturnType<typeof deleteLibraryRecord>;
      if (settlementFirst) {
        settlement = settleCheckRunComplete({
          id: 'delete-settlement-run-1',
          tenantId: OWNER_TENANT_ID,
          checks: COMPLETE_CHECKS,
        });
        await waitForQueueBehind(observer, holder.pid, 1);
        deletion = deleteLibraryRecord({ recordId: 'delete-settlement', tenantId: OWNER_TENANT_ID });
        await waitForQueueBehind(observer, holder.pid, 2);
      } else {
        deletion = deleteLibraryRecord({ recordId: 'delete-settlement', tenantId: OWNER_TENANT_ID });
        await waitForQueueBehind(observer, holder.pid, 1);
        settlement = settleCheckRunComplete({
          id: 'delete-settlement-run-1',
          tenantId: OWNER_TENANT_ID,
          checks: COMPLETE_CHECKS,
        });
        await waitForQueueBehind(observer, holder.pid, 2);
      }
      holder.release();
      await holder.done;

      const [settled, deleted] = await Promise.all([settlement, deletion]);
      expect(deleted.outcome).toBe('deleted');
      expect(settled.outcome).toBe(settlementFirst ? 'applied' : 'missing');
      expect(await client.checkRun.findUnique({ where: { id: 'delete-settlement-run-1' } })).toBeNull();
      expect(await client.libraryRecord.findUnique({ where: { id: 'delete-settlement' } })).toBeNull();
    },
  );

  it('settles a failed run as missing after DELETE and never recreates its record', async () => {
    await createExternal(client, { id: 'delete-failed-settlement', state: CheckRunState.PENDING });
    const holder = await holdRun('delete-failed-settlement-run-1');
    const deletion = deleteLibraryRecord({ recordId: 'delete-failed-settlement', tenantId: OWNER_TENANT_ID });
    await waitForQueueBehind(observer, holder.pid, 1);
    const settlement = settleCheckRunFailed({
      id: 'delete-failed-settlement-run-1',
      tenantId: OWNER_TENANT_ID,
      checks: noChecksRun(),
      failure: {
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message: 'The copy is absent.',
        retryable: false,
      },
    });
    await waitForQueueBehind(observer, holder.pid, 2);
    holder.release();
    await holder.done;

    const [deleted, settled] = await Promise.all([deletion, settlement]);
    expect(deleted.outcome).toBe('deleted');
    expect(settled.outcome).toBe('missing');
    expect(await client.libraryRecord.findUnique({ where: { id: 'delete-failed-settlement' } })).toBeNull();
  });
});
