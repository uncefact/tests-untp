import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsStatus,
  LibraryRecordOrigin,
  Prisma,
  type PrismaClient,
} from '../../src/lib/prisma/generated/index.js';
import { PgBossJobQueue } from '../../src/lib/jobs/pg-boss-job-queue';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { prisma } from '../../src/lib/prisma/prisma';
import {
  lockLibraryRecordForUpdate,
  updateLibraryRecordAnnotations,
} from '../../src/lib/prisma/repositories/library-record.repository';
import { replaceCustody } from '../../src/lib/prisma/repositories/external-credential.repository';
import { credentialRecordSchema, toCredentialRecord } from '../../src/lib/library/credential-record-projection';
import { noChecksRun } from '../../src/lib/prisma/repositories/check-run.repository';
import { holdRowForUpdate, waitForQueueBehind, type LockHolder } from './rig/locks';

const OWNER_TENANT_ID = 'annotations-owner-tenant';
const OTHER_TENANT_ID = 'annotations-other-tenant';
const RECORD_ID = 'annotations-external-record';
const NATIVE_ID = 'annotations-native-record';
const ADVISORY_ID = 'annotations-advisory-record';

/**
 * Custody values on the fixture, so every "custody unchanged" assertion
 * compares two real values. With the columns left null a repository whose
 * update also nulled them would compare null with null and pass.
 */
const FIXTURE_STORAGE_URI = 'https://storage.example/annotations-copy';
const FIXTURE_DECRYPTION_KEY = 'annotations-fixture-stored-key';
const FIXTURE_STORAGE_DIGEST = 'zAnnotationsFixtureCopyDigest';

/**
 * Content identity on the fixtures, for the same reason as the custody values.
 * The canonical record holds a digest; the advisory sibling holds a pointer at
 * it and no digest of its own, which is the pair the exclusivity check permits.
 * With both columns left null every preservation assertion would compare null
 * with null and an update that cleared them would pass.
 */
const FIXTURE_CONTENT_DIGEST = 'zAnnotationsFixtureContentDigest';

/**
 * The three stored states an annotation update has to leave alone. A record
 * with a settled run and a durable copy; one whose newest run is still
 * pending, where an implementation might think a declaration change is worth
 * re-verifying; and one registration left with no copy at all after a failed
 * fetch, which is the state with the least for a careless update to preserve.
 */
type FixtureState = 'extracted' | 'pending' | 'no-copy';

const COMPLETE_CHECKS = {
  retrieval: CheckResult.PASS,
  decryption: CheckResult.NOT_RUN,
  digest: CheckResult.PASS,
  proof: CheckResult.PASS,
  status: CheckResult.PASS,
  temporal: CheckResult.PASS,
  schemaConformance: CheckResult.PASS,
};

const client = createRigClient();
/**
 * Whatever `PgBossJobQueue` forwards, collected rather than dropped: this
 * suite's assertion is that an annotation update enqueues nothing, and a
 * queue that was failing would satisfy a job count while saying so only here.
 */
const queueErrors: Error[] = [];
/**
 * Started only so the `pgboss.job` table exists and the counts below observe
 * a real queue rather than a missing one. Nothing in this suite enqueues; the
 * point of the assertion is that the repository does not either.
 */
const queue = new PgBossJobQueue({
  connectionString: process.env.RI_DATABASE_URL as string,
  onError: (error) => queueErrors.push(error),
});
const concurrent = createRigClient();
/** A third connection, so a delete can race a PATCH while a holder blocks both. */
const deleter = createRigClient();

/** The column is INTEGER, so this token can be matched but never advanced. */
const MAX_ANNOTATION_VERSION = 2147483647;

/** Every holder opened by a test is released in afterEach. */
const holders: LockHolder[] = [];

/**
 * Opens a transaction on a separate connection holding the parent row
 * `FOR UPDATE`, and reports that connection's backend id so waiters can be
 * attributed to it. Nothing proceeds past the returned promise until the lock
 * is actually held.
 */
async function holdParentLock(recordId = RECORD_ID): Promise<LockHolder> {
  const holder = await holdRowForUpdate(concurrent, {
    table: 'LibraryRecord',
    id: recordId,
    tenantId: OWNER_TENANT_ID,
  });
  holders.push(holder);
  return holder;
}

async function createExternal(
  prisma: PrismaClient,
  id = RECORD_ID,
  tenantId = OWNER_TENANT_ID,
  state: FixtureState = 'extracted',
): Promise<void> {
  const old = new Date('2026-01-01T00:00:00.000Z');
  const noCopy = state === 'no-copy';
  await prisma.$transaction(async (tx) => {
    await tx.libraryRecord.create({
      data: {
        id,
        tenantId,
        origin: LibraryRecordOrigin.EXTERNAL,
        // A registration whose fetch failed has nothing to extract from, so
        // the descriptive columns and the core type stay null and the details
        // status stays pending, as the register route leaves them.
        credentialType: noCopy ? null : 'DigitalProductPassport',
        coreCredentialType: noCopy ? null : CoreCredentialType.DPP,
        coreDataModelVersion: noCopy ? null : '0.6.0',
        detailsStatus: noCopy ? CredentialDetailsStatus.EXTRACTION_PENDING : CredentialDetailsStatus.EXTRACTED,
        name: noCopy ? null : 'Extracted credential name',
        issuerName: noCopy ? null : 'Supplier',
        issuerDid: noCopy ? null : 'did:web:supplier.example',
        subjectName: noCopy ? null : 'Battery pack',
        subjectId: noCopy ? null : 'https://supplier.example/battery-pack',
        validFrom: noCopy ? null : new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: old,
        createdAt: old,
      },
    });
    await tx.externalCredential.create({
      data: {
        id,
        tenantId,
        sourceUrl: 'https://supplier.example/credential',
        sourceDigest: noCopy ? null : 'zSourceDigest',
        // Per record, because the digest is unique per tenant and this helper
        // builds more than one record in the same tenant.
        contentDigest: noCopy ? null : `${FIXTURE_CONTENT_DIGEST}-${id}`,
        encrypted: noCopy ? null : false,
        contentKind: noCopy ? null : 'CREDENTIAL',
        storageUri: noCopy ? null : FIXTURE_STORAGE_URI,
        decryptionKey: noCopy ? null : FIXTURE_DECRYPTION_KEY,
        storageDigestMultibase: noCopy ? null : FIXTURE_STORAGE_DIGEST,
        displayName: 'Initial label',
        declaredCredentialType: CoreCredentialType.DPP,
        dateReceived: new Date('2026-01-02T00:00:00.000Z'),
        notes: 'Initial notes',
        updatedAt: old,
        createdAt: old,
      },
    });
    if (noCopy) {
      await tx.checkRun.create({
        data: {
          recordId: id,
          tenantId,
          generation: 1,
          state: CheckRunState.FAILED,
          ...noChecksRun(),
          retrieval: CheckResult.FAIL,
          failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
          failureMessage: 'The source could not be reached.',
          failureRetryable: true,
          requestedAt: old,
          completedAt: new Date('2026-01-01T00:00:01.000Z'),
        },
      });
      return;
    }
    await tx.checkRun.create({
      data: {
        recordId: id,
        tenantId,
        generation: 1,
        state: CheckRunState.COMPLETE,
        ...COMPLETE_CHECKS,
        requestedAt: old,
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
      },
    });
    if (state === 'pending') {
      // A re-verification in flight: the newest run has no result yet, which
      // is the state an implementation might mistake for a reason to enqueue.
      await tx.checkRun.create({
        data: {
          recordId: id,
          tenantId,
          generation: 2,
          state: CheckRunState.PENDING,
          ...noChecksRun(),
          requestedAt: new Date('2026-01-03T00:00:00.000Z'),
          completedAt: null,
        },
      });
    }
  });
}

/**
 * An advisory sibling of `pointsAt`: no digest of its own, and a pointer at
 * the record that holds one. Annotating either record must leave that pointer
 * alone, and the pointer is what a careless update would clear.
 */
async function createAdvisorySibling(prisma: PrismaClient, pointsAt = RECORD_ID): Promise<void> {
  const old = new Date('2026-01-01T00:00:00.000Z');
  await prisma.$transaction(async (tx) => {
    await tx.libraryRecord.create({
      data: {
        id: ADVISORY_ID,
        tenantId: OWNER_TENANT_ID,
        origin: LibraryRecordOrigin.EXTERNAL,
        detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
        updatedAt: old,
        createdAt: old,
      },
    });
    await tx.externalCredential.create({
      data: {
        id: ADVISORY_ID,
        tenantId: OWNER_TENANT_ID,
        sourceUrl: 'https://supplier.example/credential-again',
        contentDigest: null,
        duplicateOfRecordId: pointsAt,
        displayName: 'Advisory label',
        declaredCredentialType: CoreCredentialType.DPP,
        updatedAt: old,
        createdAt: old,
      },
    });
    await tx.checkRun.create({
      data: {
        recordId: ADVISORY_ID,
        tenantId: OWNER_TENANT_ID,
        generation: 1,
        state: CheckRunState.COMPLETE,
        ...COMPLETE_CHECKS,
        requestedAt: old,
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
      },
    });
  });
}

async function createNative(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.libraryRecord.create({
      data: { id: NATIVE_ID, tenantId: OWNER_TENANT_ID, origin: LibraryRecordOrigin.NATIVE },
    });
    await tx.credential.create({
      data: {
        id: NATIVE_ID,
        tenantId: OWNER_TENANT_ID,
        storageUri: 'https://storage.example/native',
        digestMultibase: 'zNativeDigest',
      },
    });
  });
}

async function queuedJobCount(): Promise<number> {
  const [row] = await client.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM pgboss.job`;
  return Number(row.count);
}

beforeAll(async () => {
  await queue.start();
});

beforeEach(async () => {
  await truncateApplicationTables(client);
  await client.tenant.createMany({
    data: [
      { id: OWNER_TENANT_ID, name: 'Annotations owner' },
      { id: OTHER_TENANT_ID, name: 'Annotations other' },
    ],
  });
  queueErrors.splice(0);
});

afterEach(async () => {
  for (const holder of holders.splice(0)) {
    holder.release();
    await holder.done.catch(() => undefined);
  }
  expect(queueErrors.splice(0)).toEqual([]);
});

afterAll(async () => {
  await queue.stop();
  expect(queueErrors.splice(0)).toEqual([]);
  await client.$disconnect();
  await concurrent.$disconnect();
  await deleter.$disconnect();
});

describe('recipient annotation updates against Postgres', () => {
  it.each([
    ['an extracted record', 'extracted'] as const,
    ['a record whose newest run is pending', 'pending'] as const,
    ['a record with no durable copy', 'no-copy'] as const,
  ])(
    'advances the token on %s, touching only annotation timestamps and leaving extracted fields, custody, runs and the queue unchanged',
    async (_name, state: FixtureState) => {
      await createExternal(client, RECORD_ID, OWNER_TENANT_ID, state);
      await createAdvisorySibling(client);
      const before = await client.$transaction(async (tx) => ({
        advisory: await tx.externalCredential.findUniqueOrThrow({ where: { id: ADVISORY_ID } }),
        record: await tx.libraryRecord.findUniqueOrThrow({ where: { id: RECORD_ID } }),
        external: await tx.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } }),
        runs: await tx.checkRun.findMany({ where: { recordId: RECORD_ID }, orderBy: { generation: 'asc' } }),
      }));
      const jobsBefore = await queuedJobCount();

      const result = await updateLibraryRecordAnnotations({
        recordId: RECORD_ID,
        tenantId: OWNER_TENANT_ID,
        expectedVersion: 1,
        changes: {
          displayName: 'Corrected label',
          declaredCredentialType: CoreCredentialType.DCC,
          dateReceived: null,
          notes: null,
        },
      });

      expect(result.outcome).toBe('updated');
      if (result.outcome !== 'updated') throw new Error(`expected update, got ${result.outcome}`);
      expect(result.view.origin).toBe(LibraryRecordOrigin.EXTERNAL);
      expect(result.view.external.annotationVersion).toBe(2);
      expect(result.view.external.displayName).toBe('Corrected label');
      expect(result.view.external.declaredCredentialType).toBe(CoreCredentialType.DCC);
      expect(result.view.external.dateReceived).toBeNull();
      expect(result.view.external.notes).toBeNull();

      const after = await client.$transaction(async (tx) => ({
        advisory: await tx.externalCredential.findUniqueOrThrow({ where: { id: ADVISORY_ID } }),
        record: await tx.libraryRecord.findUniqueOrThrow({ where: { id: RECORD_ID } }),
        external: await tx.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } }),
        runs: await tx.checkRun.findMany({ where: { recordId: RECORD_ID }, orderBy: { generation: 'asc' } }),
      }));
      expect(after.external.annotationVersion).toBe(2);
      // Content identity is the duplicate-detection state, and neither column
      // is an annotation. The canonical digest is real for the two states that
      // fetched a body, and the advisory row beside it is untouched entirely.
      expect(after.external.contentDigest).toBe(before.external.contentDigest);
      expect(after.external.duplicateOfRecordId).toBe(before.external.duplicateOfRecordId);
      expect(after.advisory).toEqual(before.advisory);
      expect(after.advisory.duplicateOfRecordId).toBe(RECORD_ID);
      // Real values on both sides for the extracted and pending states, and
      // the nulls a failed registration really leaves for the third.
      expect(after.external.storageUri).toBe(before.external.storageUri);
      expect(after.external.decryptionKey).toBe(before.external.decryptionKey);
      expect(after.external.storageDigestMultibase).toBe(before.external.storageDigestMultibase);
      expect(after.external.sourceDigest).toBe(before.external.sourceDigest);
      expect(after.record.name).toBe(before.record.name);
      expect(after.record.credentialType).toBe(before.record.credentialType);
      expect(after.record.coreCredentialType).toBe(before.record.coreCredentialType);
      expect(after.record.detailsStatus).toBe(before.record.detailsStatus);
      expect(after.runs).toEqual(before.runs);
      // AC1 says an annotation update never re-triggers verification. Without
      // this, only the absence of a code path says so.
      expect(await queuedJobCount()).toBe(jobsBefore);
      expect(after.record.updatedAt.getTime()).toBeGreaterThan(before.record.updatedAt.getTime());
    },
  );

  it('adds and removes the declared-type mismatch warning as the declaration changes, writing nothing else', async () => {
    await createExternal(client);
    await createAdvisorySibling(client);
    const beforeAny = await client.$transaction(async (tx) => ({
      advisory: await tx.externalCredential.findUniqueOrThrow({ where: { id: ADVISORY_ID } }),
      record: await tx.libraryRecord.findUniqueOrThrow({ where: { id: RECORD_ID } }),
      external: await tx.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } }),
      runs: await tx.checkRun.findMany({ where: { recordId: RECORD_ID }, orderBy: { generation: 'asc' } }),
    }));

    // The fixture's extracted core type is DPP and its declaration matches it,
    // so the fixture carries no mismatch warning to begin with.
    const mismatched = await updateLibraryRecordAnnotations({
      recordId: RECORD_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      changes: { declaredCredentialType: CoreCredentialType.DCC },
    });
    if (mismatched.outcome !== 'updated') throw new Error(`expected update, got ${mismatched.outcome}`);
    expect(toCredentialRecord(mismatched.view).warnings).toContainEqual(
      expect.objectContaining({ code: 'DECLARED_TYPE_MISMATCH' }),
    );

    const realigned = await updateLibraryRecordAnnotations({
      recordId: RECORD_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 2,
      changes: { declaredCredentialType: CoreCredentialType.DPP },
    });
    if (realigned.outcome !== 'updated') throw new Error(`expected update, got ${realigned.outcome}`);
    expect(toCredentialRecord(realigned.view).warnings).not.toContainEqual(
      expect.objectContaining({ code: 'DECLARED_TYPE_MISMATCH' }),
    );

    // The warning is derived at projection time, so nothing but the declared
    // type, the annotation token and the two timestamps may have moved across
    // the pair. A warning cached in a column at register time would survive a
    // declaration change and fail the first assertion above.
    const afterBoth = await client.$transaction(async (tx) => ({
      advisory: await tx.externalCredential.findUniqueOrThrow({ where: { id: ADVISORY_ID } }),
      record: await tx.libraryRecord.findUniqueOrThrow({ where: { id: RECORD_ID } }),
      external: await tx.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } }),
      runs: await tx.checkRun.findMany({ where: { recordId: RECORD_ID }, orderBy: { generation: 'asc' } }),
    }));
    expect(afterBoth.external).toEqual({
      ...beforeAny.external,
      annotationVersion: 3,
      updatedAt: afterBoth.external.updatedAt,
    });
    expect(afterBoth.external.declaredCredentialType).toBe(CoreCredentialType.DPP);
    // The full-row comparison above covers the canonical digest because the
    // fixture now carries one. The advisory pointer lives on the sibling row,
    // which no annotation update has any reason to touch.
    expect(afterBoth.external.contentDigest).toBe(beforeAny.external.contentDigest);
    expect(afterBoth.advisory).toEqual(beforeAny.advisory);
    expect(afterBoth.record).toEqual({ ...beforeAny.record, updatedAt: afterBoth.record.updatedAt });
    expect(afterBoth.runs).toEqual(beforeAny.runs);
  });

  it('keeps omitted fields and clears explicit nulls, while a stale token changes no stored column', async () => {
    await createExternal(client);
    const first = await updateLibraryRecordAnnotations({
      recordId: RECORD_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      changes: { notes: null },
    });
    expect(first.outcome).toBe('updated');

    const afterClear = await client.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } });
    expect(afterClear.notes).toBeNull();
    expect(afterClear.displayName).toBe('Initial label');
    // The other nullable column, populated by the fixture and omitted by this
    // request: an update that cleared every nullable column it was not given
    // would leave notes null here and pass on that alone.
    expect(afterClear.dateReceived).toEqual(new Date('2026-01-02T00:00:00.000Z'));

    const snapshot = await client.$transaction(async (tx) => ({
      record: await tx.libraryRecord.findUniqueOrThrow({ where: { id: RECORD_ID } }),
      external: await tx.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } }),
      runs: await tx.checkRun.findMany({ where: { recordId: RECORD_ID } }),
    }));
    const stale = await updateLibraryRecordAnnotations({
      recordId: RECORD_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      changes: { displayName: 'must not be stored' },
    });
    expect(stale).toEqual({ outcome: 'version_conflict', currentVersion: 2 });
    await expect(
      client.$transaction(async (tx) => ({
        record: await tx.libraryRecord.findUniqueOrThrow({ where: { id: RECORD_ID } }),
        external: await tx.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } }),
        runs: await tx.checkRun.findMany({ where: { recordId: RECORD_ID } }),
      })),
    ).resolves.toEqual(snapshot);
  });

  it('serialises two current-token updates so exactly one wins, sees version two, and touches the parent', async () => {
    await createExternal(client);
    const fixture = await client.libraryRecord.findUniqueOrThrow({ where: { id: RECORD_ID } });
    const holder = await holdParentLock();

    const first = updateLibraryRecordAnnotations({
      recordId: RECORD_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      changes: { displayName: 'winner one' },
    });
    const second = updateLibraryRecordAnnotations({
      recordId: RECORD_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      changes: { displayName: 'winner two' },
    });
    // Both writers must be queued behind the holder before it lets go, or the
    // second could start after the first had already committed and this would
    // be two sequential updates wearing a race's name.
    await waitForQueueBehind(client, holder.pid, 2);
    holder.release();
    await holder.done;
    const results = await Promise.all([first, second]);

    const winners = results.filter((result) => result.outcome === 'updated');
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.outcome === 'version_conflict')).toHaveLength(1);
    const winner = winners[0];
    // The returned view is what the route projects, so a repository that
    // advanced the stored token without answering with the advanced row, or
    // that skipped the parent touch, fails here and not only in storage.
    if (winner.outcome !== 'updated' || winner.view.origin !== LibraryRecordOrigin.EXTERNAL) {
      throw new Error('expected an external updated view');
    }
    expect(winner.view.external.annotationVersion).toBe(2);
    expect(winner.view.record.updatedAt.getTime()).toBeGreaterThan(fixture.updatedAt.getTime());

    const final = await client.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } });
    expect(final.annotationVersion).toBe(2);
    expect(['winner one', 'winner two']).toContain(final.displayName);
  });

  it('hands each writer its own in-transaction view even when the later write commits first', async () => {
    await createExternal(client);
    const holder = await holdParentLock();

    let releaseFirstWriter!: () => void;
    const secondWriterCommitted = new Promise<void>((resolve) => {
      releaseFirstWriter = resolve;
    });
    // Test-side interception over real database I/O: the first writer's
    // transaction commits for real, and only the delivery of its result to its
    // own continuation is held until the second writer has committed. The lock
    // schedule below fixes who writes first; this fixes what each of them can
    // still observe afterwards.
    const realTransaction = prisma.$transaction;
    let held = false;
    const intercepted = prisma as unknown as { $transaction: unknown };
    intercepted.$transaction = async (...args: unknown[]) => {
      const holdThisOne = !held;
      held = true;
      const result = await (realTransaction as (...a: unknown[]) => Promise<unknown>).apply(prisma, args);
      if (holdThisOne) await secondWriterCommitted;
      return result;
    };

    try {
      const firstWriter = updateLibraryRecordAnnotations({
        recordId: RECORD_ID,
        tenantId: OWNER_TENANT_ID,
        expectedVersion: 1,
        changes: { displayName: 'A' },
      });
      await waitForQueueBehind(client, holder.pid, 1);
      const secondWriter = updateLibraryRecordAnnotations({
        recordId: RECORD_ID,
        tenantId: OWNER_TENANT_ID,
        expectedVersion: 2,
        changes: { displayName: 'B' },
      });
      await waitForQueueBehind(client, holder.pid, 2);
      holder.release();
      await holder.done;

      const second = await secondWriter;
      releaseFirstWriter();
      const first = await firstWriter;

      // B holds the second token, so B succeeding is also the proof that the
      // queue ran in the intended order: had B been granted the lock first it
      // would have found version 1 and answered version_conflict.
      if (second.outcome !== 'updated' || second.view.origin !== LibraryRecordOrigin.EXTERNAL) {
        throw new Error(`expected the second writer to update, got ${second.outcome}`);
      }
      if (first.outcome !== 'updated' || first.view.origin !== LibraryRecordOrigin.EXTERNAL) {
        throw new Error(`expected the first writer to update, got ${first.outcome}`);
      }
      // A view re-read after the transaction commits would hand A the row B
      // wrote; the in-transaction view cannot.
      expect(first.view.external.annotationVersion).toBe(2);
      expect(first.view.external.displayName).toBe('A');
      expect(second.view.external.annotationVersion).toBe(3);
      expect(second.view.external.displayName).toBe('B');

      const stored = await client.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } });
      expect(stored.annotationVersion).toBe(3);
      expect(stored.displayName).toBe('B');
    } finally {
      intercepted.$transaction = realTransaction;
      releaseFirstWriter();
    }
  });

  // Both queue orders, because only one of them can expose a wrong lock order:
  // when the delete is queued first it acquires the parent and then cascades to
  // the child, so a PATCH that took the child before the parent is holding
  // exactly what the delete now needs while waiting for what the delete holds,
  // and Postgres reports the cycle as a deadlock (40P01). A sequential delete,
  // or a PATCH that is always first in the queue, never puts the two lock
  // acquisitions in flight together and cannot tell the orders apart.
  it.each([['the PATCH', 'patch-first'] as const, ['the delete', 'delete-first'] as const])(
    'lets a delete and a PATCH settle without deadlocking when %s is queued first',
    async (_first, order) => {
      await createExternal(client);
      const holder = await holdParentLock();

      // Kicked off inside a promise: a Prisma query builder is lazy, so a bare
      // `delete(...)` would not reach the database until it was awaited, and
      // the two lock requests would never be in flight together.
      const startDelete = () => (async () => deleter.libraryRecord.delete({ where: { id: RECORD_ID } }))();
      const startPatch = () =>
        updateLibraryRecordAnnotations({
          recordId: RECORD_ID,
          tenantId: OWNER_TENANT_ID,
          expectedVersion: 1,
          changes: { displayName: 'patched during a delete' },
        });

      let patch: ReturnType<typeof startPatch>;
      let deletion: ReturnType<typeof startDelete>;
      if (order === 'patch-first') {
        patch = startPatch();
        await waitForQueueBehind(client, holder.pid, 1);
        deletion = startDelete();
      } else {
        deletion = startDelete();
        await waitForQueueBehind(client, holder.pid, 1);
        patch = startPatch();
      }
      // Neither operation is wrapped in a retry. If the PATCH took the child
      // before its parent, this queue barrier puts both lock acquisitions in
      // flight together and Postgres reports the cycle as 40P01.
      await waitForQueueBehind(client, holder.pid, 2);
      holder.release();
      await holder.done;

      const [patchResult] = await Promise.all([patch, deletion]);
      // Either winner is permitted. What is not is a deadlock, or a PATCH
      // claiming to have updated a record the delete had already removed.
      expect(['updated', 'missing']).toContain(patchResult.outcome);
      expect(await client.libraryRecord.count({ where: { id: RECORD_ID } })).toBe(0);
      expect(await client.externalCredential.count({ where: { id: RECORD_ID } })).toBe(0);
    },
  );

  it.each([['the PATCH', 'patch-first'] as const, ['custody replacement', 'custody-first'] as const])(
    'lets a custody replacement and a PATCH settle without deadlocking when %s is queued first',
    async (_first, order) => {
      await createExternal(client);
      const holder = await holdParentLock();
      const replacement = {
        uri: 'https://storage.example/replaced-copy',
        digestMultibase: 'zReplacedCopyDigest',
        serviceInstanceId: 'storage-service-replaced',
        externalId: 'replaced-object',
        bucket: 'library',
        decryptionKey: 'replaced-key' as never,
      };
      const startCustody = () =>
        prisma.$transaction(
          (tx) =>
            replaceCustody(tx, {
              recordId: RECORD_ID,
              tenantId: OWNER_TENANT_ID,
              storage: replacement,
            }),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 5_000,
            timeout: 15_000,
          },
        );
      const startPatch = () =>
        updateLibraryRecordAnnotations({
          recordId: RECORD_ID,
          tenantId: OWNER_TENANT_ID,
          expectedVersion: 1,
          changes: { displayName: 'patched during custody replacement' },
        });

      let patch: ReturnType<typeof startPatch> | undefined;
      let custody: ReturnType<typeof startCustody> | undefined;
      try {
        if (order === 'patch-first') {
          const patchHandle = startPatch();
          patch = patchHandle;
          void patchHandle.catch(() => undefined);
          await waitForQueueBehind(client, holder.pid, 1);
          const custodyHandle = startCustody();
          custody = custodyHandle;
          void custodyHandle.catch(() => undefined);
        } else {
          const custodyHandle = startCustody();
          custody = custodyHandle;
          void custodyHandle.catch(() => undefined);
          await waitForQueueBehind(client, holder.pid, 1);
          const patchHandle = startPatch();
          patch = patchHandle;
          void patchHandle.catch(() => undefined);
        }

        // Neither operation is wrapped in a retry. If custody writes the child
        // before its parent lock, this queue barrier exposes the deadlock after
        // the PATCH takes the parent and waits for that child.
        await waitForQueueBehind(client, holder.pid, 2);
        holder.release();
        await holder.done;

        const [patchResult, custodyResult] = await Promise.all([patch, custody]);
        expect(patchResult.outcome).toBe('updated');
        expect(custodyResult.id).toBe(RECORD_ID);

        const final = await client.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } });
        expect(final).toMatchObject({
          displayName: 'patched during custody replacement',
          annotationVersion: 2,
          notes: 'Initial notes',
          storageUri: replacement.uri,
          storageDigestMultibase: replacement.digestMultibase,
          storageServiceInstanceId: replacement.serviceInstanceId,
          storageExternalId: replacement.externalId,
          storageBucket: replacement.bucket,
          decryptionKey: replacement.decryptionKey,
        });
      } finally {
        holder.release();
        await holder.done.catch(() => undefined);
        await Promise.allSettled([patch, custody].filter((operation) => operation !== undefined));
      }
    },
  );

  it('binds an apostrophe-containing owned id and keeps the lock until the owning transaction ends', async () => {
    // The owned, absent and foreign cases distinguish bound values from a
    // quoted interpolation, while the waiter proves the lock survives the
    // tagged statement until the interactive transaction ends.
    const ownedId = "helper-owned-'apostrophe";
    await createExternal(client, ownedId);

    let releaseOwner!: () => void;
    const ownerReleased = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });
    let allowReacquisition!: () => void;
    const reacquisitionAllowed = new Promise<void>((resolve) => {
      allowReacquisition = resolve;
    });
    let signalOwnerReady!: () => void;
    const ownerReady = new Promise<void>((resolve) => {
      signalOwnerReady = resolve;
    });
    let signalReacquired!: (result: boolean) => void;
    const reacquired = new Promise<boolean>((resolve) => {
      signalReacquired = resolve;
    });
    let ownerPid = 0;
    let ownerLocked = false;
    const ownerDone = client.$transaction(
      async (tx) => {
        ownerLocked = await lockLibraryRecordForUpdate(tx, ownedId, OWNER_TENANT_ID);
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        ownerPid = backend.pid;
        signalOwnerReady();
        await reacquisitionAllowed;
        if (ownerLocked) {
          signalReacquired(await lockLibraryRecordForUpdate(tx, ownedId, OWNER_TENANT_ID));
        }
        await ownerReleased;
      },
      { timeout: 20_000 },
    );

    let waiter: Promise<unknown> | undefined;
    try {
      await Promise.race([
        ownerReady,
        ownerDone.then(() => {
          throw new Error('owner transaction ended before it signalled ready');
        }),
      ]);
      expect(ownerLocked).toBe(true);
      waiter = concurrent.$transaction(
        async (tx) => {
          expect(await lockLibraryRecordForUpdate(tx, ownedId, OWNER_TENANT_ID)).toBe(true);
        },
        { timeout: 20_000 },
      );
      await waitForQueueBehind(client, ownerPid, 1);
      allowReacquisition();
      await expect(
        Promise.race([
          reacquired,
          ownerDone.then(() => {
            throw new Error('owner transaction ended before it signalled reacquired');
          }),
        ]),
      ).resolves.toBe(true);
      releaseOwner();
      await ownerDone;
      await waiter;

      await expect(
        client.$transaction(async (tx) => ({
          absent: await lockLibraryRecordForUpdate(tx, 'helper-absent', OWNER_TENANT_ID),
          foreign: await lockLibraryRecordForUpdate(tx, ownedId, OTHER_TENANT_ID),
        })),
      ).resolves.toEqual({ absent: false, foreign: false });
    } finally {
      allowReacquisition();
      releaseOwner();
      await ownerDone.catch(() => undefined);
      await waiter?.catch(() => undefined);
    }
  });

  it('leaves the row untouched when a matching token is already at the column maximum', async () => {
    await createExternal(client);
    await client.externalCredential.update({
      where: { id: RECORD_ID },
      data: { annotationVersion: MAX_ANNOTATION_VERSION },
    });
    const before = await client.$transaction(async (tx) => ({
      record: await tx.libraryRecord.findUniqueOrThrow({ where: { id: RECORD_ID } }),
      external: await tx.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } }),
    }));

    // The accepted limit (plan ruling R1): the token matches, so the write is
    // attempted and the increment overflows INTEGER. The only promise the
    // accepted outcome makes is that the failure changes nothing, which is
    // what this asserts; a repository that wrote the child outside the
    // transaction, or touched the parent first, would leave a trace here.
    await expect(
      updateLibraryRecordAnnotations({
        recordId: RECORD_ID,
        tenantId: OWNER_TENANT_ID,
        expectedVersion: MAX_ANNOTATION_VERSION,
        changes: { displayName: 'must not be stored', notes: 'must not be stored' },
      }),
    ).rejects.toThrow();

    const after = await client.$transaction(async (tx) => ({
      record: await tx.libraryRecord.findUniqueOrThrow({ where: { id: RECORD_ID } }),
      external: await tx.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } }),
    }));
    expect(after.external).toEqual(before.external);
    expect(after.record.updatedAt).toEqual(before.record.updatedAt);
  });

  it('projects the returned view onto a body carrying no stored key, copy location or copy digest', async () => {
    await createExternal(client);
    // Values that cannot appear in a projected body by coincidence, so the
    // absence assertions below cannot pass for the wrong reason.
    const storedKey = 'KEY-MUST-NOT-LEAK-7f3a';
    const storedUri = 'https://storage.example/URI-MUST-NOT-LEAK-7f3a';
    const storedDigest = 'zDIGESTMUSTNOTLEAK7f3a';
    await client.externalCredential.update({
      where: { id: RECORD_ID },
      data: { decryptionKey: storedKey, storageUri: storedUri, storageDigestMultibase: storedDigest },
    });

    const result = await updateLibraryRecordAnnotations({
      recordId: RECORD_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      changes: { displayName: 'Keyless projection' },
    });
    if (result.outcome !== 'updated' || result.view.origin !== LibraryRecordOrigin.EXTERNAL) {
      throw new Error(`expected an external updated view, got ${result.outcome}`);
    }

    // The real projection, not a stand-in: the view the repository returns
    // carries the whole child row, so a projection that spread the row instead
    // of listing the contract's values would publish all three.
    const body = toCredentialRecord(result.view);
    expect(body.hasKey).toBe(true);
    const rendered = JSON.stringify(body);
    for (const secret of [storedKey, storedUri, storedDigest]) {
      expect(rendered).not.toContain(secret);
    }
    expect(credentialRecordSchema.safeParse(body).success).toBe(true);
  });

  it('rolls the child update back when a test-owned parent trigger fails the parent touch', async () => {
    await createExternal(client);
    const functionName = 'test_annotations_parent_touch_failure';
    const triggerName = 'test_annotations_parent_touch_failure_trigger';
    await client.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "${functionName}"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."id" = '${RECORD_ID}' THEN
          RAISE EXCEPTION 'annotation parent touch failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await client.$executeRawUnsafe(
      `CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON "LibraryRecord" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
    );

    const before = await client.$transaction(async (tx) => ({
      record: await tx.libraryRecord.findUniqueOrThrow({ where: { id: RECORD_ID } }),
      external: await tx.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } }),
    }));

    try {
      await expect(
        updateLibraryRecordAnnotations({
          recordId: RECORD_ID,
          tenantId: OWNER_TENANT_ID,
          expectedVersion: 1,
          changes: { notes: 'must roll back' },
        }),
      ).rejects.toThrow('annotation parent touch failure');
    } finally {
      await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "LibraryRecord"`);
      await client.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }

    // The whole child row and the parent timestamp, not only the two columns
    // this request named: what the transaction promises is that nothing it
    // touched survives, and the submitted notes and version are the two values
    // a partial assertion would happen to cover.
    const after = await client.$transaction(async (tx) => ({
      record: await tx.libraryRecord.findUniqueOrThrow({ where: { id: RECORD_ID } }),
      external: await tx.externalCredential.findUniqueOrThrow({ where: { id: RECORD_ID } }),
    }));
    expect(after.external).toEqual(before.external);
    expect(after.record.updatedAt).toEqual(before.record.updatedAt);
  });

  it('returns missing for foreign, deleted and native records before any child write', async () => {
    await createExternal(client, 'foreign-record', OTHER_TENANT_ID);
    await createExternal(client, 'deleted-record');
    await createNative(client);
    await client.libraryRecord.delete({ where: { id: 'deleted-record' } });

    await expect(
      updateLibraryRecordAnnotations({
        recordId: 'foreign-record',
        tenantId: OWNER_TENANT_ID,
        expectedVersion: 1,
        changes: { notes: 'not visible' },
      }),
    ).resolves.toEqual({ outcome: 'missing' });
    await expect(
      updateLibraryRecordAnnotations({
        recordId: 'deleted-record',
        tenantId: OWNER_TENANT_ID,
        expectedVersion: 1,
        changes: { notes: 'not visible' },
      }),
    ).resolves.toEqual({ outcome: 'missing' });
    await expect(
      updateLibraryRecordAnnotations({
        recordId: NATIVE_ID,
        tenantId: OWNER_TENANT_ID,
        expectedVersion: 1,
        changes: { notes: 'not visible' },
      }),
    ).resolves.toEqual({ outcome: 'native' });
  });
});
