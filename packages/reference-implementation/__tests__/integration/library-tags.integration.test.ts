import {
  CheckResult,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsStatus,
  LibraryRecordOrigin,
  type PrismaClient,
} from '../../src/lib/prisma/generated/index.js';
import { createRigClient, truncateApplicationTables } from './rig/db';
import {
  replaceLibraryRecordTags,
  updateLibraryRecordAnnotations,
} from '../../src/lib/prisma/repositories/library-record.repository';
import { holdRowForUpdate, waitForQueueBehind, type LockHolder } from './rig/locks';
import { insertNativeCredential } from './fixtures';

const OWNER_TENANT_ID = 'tags-owner-tenant';
const OTHER_TENANT_ID = 'tags-other-tenant';
const EXTERNAL_ID = 'tags-external-record';
const NATIVE_ID = 'tags-native-record';

const client = createRigClient();
/** A second connection, so a holder can keep the parent row locked while writers queue behind it. */
const concurrent = createRigClient();

/** Every holder opened by a test is released in afterEach. */
const holders: LockHolder[] = [];

async function holdParentLock(recordId: string): Promise<LockHolder> {
  const holder = await holdRowForUpdate(concurrent, {
    table: 'LibraryRecord',
    id: recordId,
    tenantId: OWNER_TENANT_ID,
  });
  holders.push(holder);
  return holder;
}

const OLD = new Date('2026-01-01T00:00:00.000Z');

async function createExternal(prisma: PrismaClient, id = EXTERNAL_ID, tenantId = OWNER_TENANT_ID): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.libraryRecord.create({
      data: {
        id,
        tenantId,
        origin: LibraryRecordOrigin.EXTERNAL,
        credentialType: 'DigitalProductPassport',
        coreCredentialType: CoreCredentialType.DPP,
        coreDataModelVersion: '0.7.0',
        detailsStatus: CredentialDetailsStatus.EXTRACTED,
        name: 'Extracted credential name',
        issuerName: 'Supplier',
        issuerDid: 'did:web:supplier.example',
        subjectName: 'Battery pack',
        subjectId: 'https://supplier.example/battery-pack',
        validFrom: OLD,
        updatedAt: OLD,
        createdAt: OLD,
      },
    });
    await tx.externalCredential.create({
      data: {
        id,
        tenantId,
        sourceUrl: 'https://supplier.example/credential',
        sourceDigest: 'zSourceDigest',
        contentDigest: `zTagsFixtureContentDigest-${id}`,
        encrypted: false,
        contentKind: 'CREDENTIAL',
        storageUri: 'https://storage.example/tags-copy',
        decryptionKey: 'tags-fixture-stored-key',
        storageDigestMultibase: 'zTagsFixtureCopyDigest',
        displayName: 'Initial label',
        declaredCredentialType: CoreCredentialType.DPP,
        dateReceived: new Date('2026-01-02T00:00:00.000Z'),
        notes: 'Initial notes',
        updatedAt: OLD,
        createdAt: OLD,
      },
    });
    await tx.checkRun.create({
      data: {
        recordId: id,
        tenantId,
        generation: 1,
        state: CheckRunState.COMPLETE,
        retrieval: CheckResult.PASS,
        decryption: CheckResult.NOT_RUN,
        digest: CheckResult.PASS,
        proof: CheckResult.PASS,
        status: CheckResult.PASS,
        temporal: CheckResult.PASS,
        schemaConformance: CheckResult.PASS,
        requestedAt: OLD,
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
      },
    });
  });
}

/** Every stored row a tag replacement could touch, read in one transaction. */
async function snapshot(id: string) {
  return client.$transaction(async (tx) => ({
    record: await tx.libraryRecord.findUniqueOrThrow({ where: { id } }),
    external: await tx.externalCredential.findUnique({ where: { id } }),
    credential: await tx.credential.findUnique({ where: { id } }),
    runs: await tx.checkRun.findMany({ where: { recordId: id }, orderBy: { generation: 'asc' } }),
  }));
}

beforeEach(async () => {
  await truncateApplicationTables(client);
  await client.tenant.createMany({
    data: [
      { id: OWNER_TENANT_ID, name: 'Tags owner' },
      { id: OTHER_TENANT_ID, name: 'Tags other' },
    ],
  });
});

afterEach(async () => {
  for (const holder of holders.splice(0)) {
    holder.release();
    await holder.done.catch(() => undefined);
  }
});

afterAll(async () => {
  await client.$disconnect();
  await concurrent.$disconnect();
});

describe('library record tag replacement against Postgres', () => {
  it.each([
    ['an external record', EXTERNAL_ID],
    ['a native record', NATIVE_ID],
  ])(
    'stores the list in submitted order on %s, advances the tag version and updatedAt, and touches nothing else',
    async (_name, id) => {
      await createExternal(client);
      await insertNativeCredential(client, {
        id: NATIVE_ID,
        tenantId: OWNER_TENANT_ID,
        createdAt: OLD,
        updatedAt: OLD,
      });
      const before = await snapshot(id);
      expect(before.record.tags).toEqual([]);
      expect(before.record.tagVersion).toBe(1);

      // Not alphabetical, so a write or read that sorted the list fails here.
      const result = await replaceLibraryRecordTags({
        recordId: id,
        tenantId: OWNER_TENANT_ID,
        expectedVersion: 1,
        tags: ['zeta', 'alpha'],
      });

      if (result.outcome !== 'updated') throw new Error(`expected update, got ${result.outcome}`);
      expect(result.view.origin).toBe(before.record.origin);
      expect(result.view.record.tags).toEqual(['zeta', 'alpha']);
      expect(result.view.record.tagVersion).toBe(2);

      const after = await snapshot(id);
      expect(after.record.tags).toEqual(['zeta', 'alpha']);
      expect(after.record.updatedAt.getTime()).toBeGreaterThan(before.record.updatedAt.getTime());
      // Every other parent column, the child row of either origin (so the
      // annotation token and annotations of an external record), and the
      // runs are exactly as they were.
      expect(after.record).toEqual({
        ...before.record,
        tags: ['zeta', 'alpha'],
        tagVersion: 2,
        updatedAt: after.record.updatedAt,
      });
      expect(after.external).toEqual(before.external);
      expect(after.credential).toEqual(before.credential);
      expect(after.runs).toEqual(before.runs);
    },
  );

  it('clears with an empty list, and a repeat of the stored list still advances the version', async () => {
    await createExternal(client);
    await replaceLibraryRecordTags({
      recordId: EXTERNAL_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      tags: ['audit'],
    });

    const cleared = await replaceLibraryRecordTags({
      recordId: EXTERNAL_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 2,
      tags: [],
    });
    expect(cleared.outcome).toBe('updated');
    const afterClear = await client.libraryRecord.findUniqueOrThrow({ where: { id: EXTERNAL_ID } });
    expect(afterClear.tags).toEqual([]);
    expect(afterClear.tagVersion).toBe(3);

    const repeated = await replaceLibraryRecordTags({
      recordId: EXTERNAL_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 3,
      tags: [],
    });
    expect(repeated.outcome).toBe('updated');
    const afterRepeat = await client.libraryRecord.findUniqueOrThrow({ where: { id: EXTERNAL_ID } });
    expect(afterRepeat.tagVersion).toBe(4);
  });

  it('answers a stale version as a conflict and leaves every stored column unchanged', async () => {
    await createExternal(client);
    await replaceLibraryRecordTags({
      recordId: EXTERNAL_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      tags: ['kept'],
    });
    const before = await snapshot(EXTERNAL_ID);

    const stale = await replaceLibraryRecordTags({
      recordId: EXTERNAL_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      tags: ['must-not-be-stored'],
    });

    expect(stale).toEqual({ outcome: 'version_conflict', currentVersion: 2 });
    await expect(snapshot(EXTERNAL_ID)).resolves.toEqual(before);
  });

  it('lets exactly one of two replacements on the same version win, storing the winner’s list', async () => {
    await createExternal(client);
    const holder = await holdParentLock(EXTERNAL_ID);

    const first = replaceLibraryRecordTags({
      recordId: EXTERNAL_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      tags: ['first-writer'],
    });
    const second = replaceLibraryRecordTags({
      recordId: EXTERNAL_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      tags: ['second-writer', 'extra'],
    });
    // Both writers must be queued behind the holder before it lets go, or this
    // would be two sequential replacements wearing a race's name.
    await waitForQueueBehind(client, holder.pid, 2);
    holder.release();
    await holder.done;
    const results = await Promise.all([first, second]);

    const winners = results.flatMap((result, index) => (result.outcome === 'updated' ? [index] : []));
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.outcome === 'version_conflict')).toEqual([
      { outcome: 'version_conflict', currentVersion: 2 },
    ]);
    const winnerList = winners[0] === 0 ? ['first-writer'] : ['second-writer', 'extra'];
    const stored = await client.libraryRecord.findUniqueOrThrow({ where: { id: EXTERNAL_ID } });
    expect(stored.tags).toEqual(winnerList);
    expect(stored.tagVersion).toBe(2);
  });

  it('lets a tag replacement and an annotation update on the same record both succeed with their own tokens', async () => {
    await createExternal(client);
    const holder = await holdParentLock(EXTERNAL_ID);

    // Each sends version 1 of its own token. Had the two shared a token, the
    // one queued second would find it advanced and answer version_conflict.
    const tagReplacement = replaceLibraryRecordTags({
      recordId: EXTERNAL_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      tags: ['tagged'],
    });
    await waitForQueueBehind(client, holder.pid, 1);
    const annotationUpdate = updateLibraryRecordAnnotations({
      recordId: EXTERNAL_ID,
      tenantId: OWNER_TENANT_ID,
      expectedVersion: 1,
      changes: { displayName: 'Annotated label' },
    });
    await waitForQueueBehind(client, holder.pid, 2);
    holder.release();
    await holder.done;

    const [tagResult, annotationResult] = await Promise.all([tagReplacement, annotationUpdate]);
    expect(tagResult.outcome).toBe('updated');
    expect(annotationResult.outcome).toBe('updated');

    const stored = await snapshot(EXTERNAL_ID);
    expect(stored.record.tags).toEqual(['tagged']);
    expect(stored.record.tagVersion).toBe(2);
    expect(stored.external?.annotationVersion).toBe(2);
    expect(stored.external?.displayName).toBe('Annotated label');
  });

  it('returns missing for a record in another tenant and for a deleted record, writing nothing', async () => {
    await createExternal(client, 'tags-foreign-record', OTHER_TENANT_ID);
    await createExternal(client, 'tags-deleted-record');
    await client.libraryRecord.delete({ where: { id: 'tags-deleted-record' } });
    const foreignBefore = await snapshot('tags-foreign-record');

    await expect(
      replaceLibraryRecordTags({
        recordId: 'tags-foreign-record',
        tenantId: OWNER_TENANT_ID,
        expectedVersion: 1,
        tags: ['not-visible'],
      }),
    ).resolves.toEqual({ outcome: 'missing' });
    await expect(
      replaceLibraryRecordTags({
        recordId: 'tags-deleted-record',
        tenantId: OWNER_TENANT_ID,
        expectedVersion: 1,
        tags: ['not-visible'],
      }),
    ).resolves.toEqual({ outcome: 'missing' });
    await expect(snapshot('tags-foreign-record')).resolves.toEqual(foreignBefore);
  });
});
