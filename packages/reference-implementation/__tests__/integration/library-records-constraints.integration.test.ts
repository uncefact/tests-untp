/**
 * The enforcement machinery 20260902000000_library_records adds, exercised
 * against real Postgres: the deferred exactly-one-child and child-delete
 * triggers, the identity-immutability trigger, the per-child origin CHECKs,
 * the composite foreign keys pinning a child to a parent of its own tenant
 * and origin, and the CheckRun generation CHECK and one-pending partial
 * index.
 *
 * ADR-053 decision 1 accepts this machinery as the price of the record shape
 * being an invariant the database holds rather than a convention the write
 * paths follow. That claim is only true while each constraint is present, so
 * every test here names the constraint it pins and fails if that constraint
 * is removed from the migration: each one performs a write the constraint is
 * the sole reason to refuse, and `refusalOf` fails the test when the write
 * succeeds.
 */
import { CheckRunState, LibraryRecordOrigin, CoreCredentialType } from '../../src/lib/prisma/generated/index.js';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertNativeCredential, seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';

const OTHER_TENANT_ID = 'ctestconstraintsothertenant';

/**
 * Runs a write the database is expected to refuse and returns the refusal's
 * message. A write that succeeds fails the test, which is what makes each
 * case sensitive to its constraint being deleted rather than to the wording
 * of the error.
 */
async function refusalOf(write: () => Promise<unknown>): Promise<string> {
  let outcome: unknown;
  try {
    outcome = await write();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`Expected the database to refuse this write; it succeeded with ${JSON.stringify(outcome)}`);
}

/**
 * The SQL for a Credential child row. Written raw rather than through the
 * typed client because these cases insert combinations the client's types
 * refuse, such as a child whose origin is EXTERNAL.
 */
function credentialInsertSql(values: { id: string; tenantId: string; origin: string; storageUri?: string }): string {
  const { id, tenantId, origin, storageUri = 'u' } = values;
  return `INSERT INTO "Credential"("id", "tenantId", "origin", "storageUri", "digestMultibase", "updatedAt")
            VALUES ('${id}', '${tenantId}', '${origin}', '${storageUri}', 'z', now())`;
}

describe('library record constraints', () => {
  const prisma = createRigClient();

  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await seedSystemTenant(prisma);
    await prisma.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Other' } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Creates an external record the way the register path does: parent then child, one transaction. */
  async function insertExternalCredential(id: string, tenantId = SYSTEM_TENANT_ID): Promise<string> {
    return prisma.$transaction(async (tx) => {
      const record = await tx.libraryRecord.create({
        data: { id, tenantId, origin: LibraryRecordOrigin.EXTERNAL },
      });
      await tx.externalCredential.create({
        data: {
          id: record.id,
          tenantId,
          displayName: 'Supplier passport',
          declaredCredentialType: CoreCredentialType.DPP,
        },
      });
      return record.id;
    });
  }

  describe('LibraryRecord_has_one_child (deferred constraint trigger)', () => {
    it('refuses a parent committed with no child', async () => {
      const message = await refusalOf(() =>
        prisma.libraryRecord.create({
          data: { id: 'rec-childless', tenantId: SYSTEM_TENANT_ID, origin: LibraryRecordOrigin.NATIVE },
        }),
      );

      expect(message).toContain('must have exactly one child row, found 0');
      expect(await prisma.libraryRecord.count()).toBe(0);
    });

    it('admits a parent whose child is created later in the same transaction', async () => {
      const created = await insertNativeCredential(prisma, { id: 'rec-native' });

      expect(created.id).toBe('rec-native');
      expect(await prisma.credential.count()).toBe(1);
    });
  });

  describe('Credential_delete_via_parent and ExternalCredential_delete_via_parent (delete guard)', () => {
    it('refuses a direct delete of a Credential child while its parent exists', async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-guarded' });

      const message = await refusalOf(() => prisma.credential.delete({ where: { id } }));

      expect(message).toContain('Delete LibraryRecord');
      expect(message).toContain('not its Credential child');
      expect(await prisma.credential.count()).toBe(1);
    });

    it('refuses a direct delete of an ExternalCredential child while its parent exists', async () => {
      const id = await insertExternalCredential('rec-external-guarded');

      const message = await refusalOf(() => prisma.externalCredential.delete({ where: { id } }));

      expect(message).toContain('not its ExternalCredential child');
      expect(await prisma.externalCredential.count()).toBe(1);
    });

    it('deletes the child when the parent is deleted, which is the supported path', async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-cascade' });

      await prisma.libraryRecord.delete({ where: { id } });

      expect(await prisma.libraryRecord.count()).toBe(0);
      expect(await prisma.credential.count()).toBe(0);
    });
  });

  describe('Credential_identity_immutable and ExternalCredential_identity_immutable', () => {
    it('refuses re-pointing a Credential child at another tenant', async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-identity' });
      // The destination parent exists and has its own child, so only the
      // identity trigger stands between the update and success.
      await insertNativeCredential(prisma, { id: 'rec-identity-other', tenantId: OTHER_TENANT_ID });

      const message = await refusalOf(() =>
        prisma.$executeRawUnsafe(`UPDATE "Credential" SET "tenantId" = '${OTHER_TENANT_ID}' WHERE "id" = '${id}'`),
      );

      expect(message).toContain('identity (id, tenantId, origin) cannot change');
      const row = await prisma.credential.findUniqueOrThrow({ where: { id } });
      expect(row.tenantId).toBe(SYSTEM_TENANT_ID);
    });

    it('refuses re-pointing a Credential child at another parent id', async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-identity-id' });
      await insertNativeCredential(prisma, { id: 'rec-identity-target' });

      const message = await refusalOf(() =>
        prisma.$executeRawUnsafe(`UPDATE "Credential" SET "id" = 'rec-identity-target-2' WHERE "id" = '${id}'`),
      );

      expect(message).toContain('identity (id, tenantId, origin) cannot change');
    });

    it('refuses changing a Credential child origin, and admits an ordinary column update', async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-identity-origin' });

      const message = await refusalOf(() =>
        prisma.$executeRawUnsafe(`UPDATE "Credential" SET "origin" = 'EXTERNAL' WHERE "id" = '${id}'`),
      );
      expect(message).toContain('identity (id, tenantId, origin) cannot change');

      // The trigger is scoped to the identity columns: everything else still updates.
      await prisma.credential.update({ where: { id }, data: { isPublished: true } });
      const row = await prisma.credential.findUniqueOrThrow({ where: { id } });
      expect(row.isPublished).toBe(true);
    });

    it('refuses re-pointing an ExternalCredential child at another tenant', async () => {
      const id = await insertExternalCredential('rec-external-identity');

      const message = await refusalOf(() =>
        prisma.$executeRawUnsafe(
          `UPDATE "ExternalCredential" SET "tenantId" = '${OTHER_TENANT_ID}' WHERE "id" = '${id}'`,
        ),
      );

      expect(message).toContain('identity (id, tenantId, origin) cannot change');
    });
  });

  describe('Credential_origin_check, ExternalCredential_origin_check and the composite foreign keys', () => {
    it('refuses a Credential child attached to an EXTERNAL parent', async () => {
      const id = await insertExternalCredential('rec-external-parent');

      // origin NATIVE satisfies the CHECK, so the composite foreign key to
      // (id, tenantId, origin) is the only thing that can refuse this: no
      // NATIVE parent carries that id.
      const message = await refusalOf(() =>
        prisma.$executeRawUnsafe(credentialInsertSql({ id, tenantId: SYSTEM_TENANT_ID, origin: 'NATIVE' })),
      );

      expect(message).toContain('Credential_id_tenantId_origin_fkey');
      expect(await prisma.credential.count()).toBe(0);
    });

    it('refuses a Credential row whose origin is not NATIVE', async () => {
      const message = await refusalOf(() =>
        prisma.$executeRawUnsafe(
          credentialInsertSql({ id: 'rec-wrong-origin', tenantId: SYSTEM_TENANT_ID, origin: 'EXTERNAL' }),
        ),
      );

      expect(message).toContain('Credential_origin_check');
    });

    it('refuses an ExternalCredential row whose origin is not EXTERNAL', async () => {
      const message = await refusalOf(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "ExternalCredential"("id", "tenantId", "origin", "displayName", "declaredCredentialType", "updatedAt")
             VALUES ('rec-wrong-origin-ext', '${SYSTEM_TENANT_ID}', 'NATIVE', 'x', 'DPP', now())`,
        ),
      );

      expect(message).toContain('ExternalCredential_origin_check');
    });

    it('refuses a Credential child whose tenant disagrees with its parent', async () => {
      // Parent and child written together the way the write paths do, but
      // with the child under a different tenant. The composite foreign key is
      // immediate, so it refuses the child insert: no parent carries
      // (id, other tenant, NATIVE).
      const message = await refusalOf(() =>
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "LibraryRecord"("id", "tenantId", "origin", "updatedAt")
               VALUES ('rec-tenant-split', '${SYSTEM_TENANT_ID}', 'NATIVE', now())`,
          );
          await tx.$executeRawUnsafe(
            credentialInsertSql({ id: 'rec-tenant-split', tenantId: OTHER_TENANT_ID, origin: 'NATIVE' }),
          );
        }),
      );

      expect(message).toContain('Credential_id_tenantId_origin_fkey');
      expect(await prisma.credential.count()).toBe(0);
    });

    it('makes a second child on one parent unreachable, by primary key and by the composite key', async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-one-child' });

      // A second Credential collides on the primary key the parent shares.
      const duplicate = await refusalOf(() =>
        prisma.$executeRawUnsafe(
          credentialInsertSql({ id, tenantId: SYSTEM_TENANT_ID, origin: 'NATIVE', storageUri: 'u2' }),
        ),
      );
      expect(duplicate).toContain(`Key (id)=(${id}) already exists`);

      // An ExternalCredential beside it cannot attach: its origin must be
      // EXTERNAL and this parent is NATIVE.
      const crossOrigin = await refusalOf(() =>
        prisma.externalCredential.create({
          data: {
            id,
            tenantId: SYSTEM_TENANT_ID,
            displayName: 'second child',
            declaredCredentialType: CoreCredentialType.DPP,
          },
        }),
      );
      expect(crossOrigin).toContain('ExternalCredential_id_tenantId_origin_fkey');

      expect(await prisma.credential.count()).toBe(1);
      expect(await prisma.externalCredential.count()).toBe(0);
    });
  });

  describe('IdempotencyKey_recordId_tenantId_fkey', () => {
    it('refuses a claim whose tenant disagrees with the record it points at', async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-claimed' });

      const message = await refusalOf(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "IdempotencyKey"("id", "tenantId", "operation", "key", "bodyDigest", "recordId")
             VALUES ('claim-mismatch', '${OTHER_TENANT_ID}', 'CREDENTIAL_ISSUE', 'k1', 'zBody', '${id}')`,
        ),
      );

      expect(message).toContain('IdempotencyKey_recordId_tenantId_fkey');
      expect(await prisma.idempotencyKey.count()).toBe(0);
    });

    it('admits a claim of the record own tenant', async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-claimed-ok' });

      await prisma.idempotencyKey.create({
        data: {
          tenantId: SYSTEM_TENANT_ID,
          operation: 'CREDENTIAL_ISSUE',
          key: 'k1',
          bodyDigest: 'zBody',
          recordId: id,
        },
      });

      expect(await prisma.idempotencyKey.count()).toBe(1);
    });
  });

  describe('Credential_link_change_touches_record', () => {
    it("moves the record's last-modified time when a linked entity is deleted", async () => {
      const organisation = await prisma.organisationEntity.create({
        data: { tenantId: SYSTEM_TENANT_ID, name: 'Org' },
      });
      const { id } = await insertNativeCredential(prisma, { id: 'rec-linked' });
      await prisma.credential.update({ where: { id }, data: { organisationId: organisation.id } });
      const before = (await prisma.libraryRecord.findUniqueOrThrow({ where: { id } })).updatedAt;
      await new Promise((resolve) => setTimeout(resolve, 20));

      await prisma.organisationEntity.delete({ where: { id: organisation.id } });

      const after = await prisma.libraryRecord.findUniqueOrThrow({ where: { id }, include: { credential: true } });
      expect(after.credential?.organisationId).toBeNull();
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    });

    it("leaves the record's last-modified time alone when only the stored key changes", async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-rewrapped' });
      const before = (await prisma.libraryRecord.findUniqueOrThrow({ where: { id } })).updatedAt;
      await new Promise((resolve) => setTimeout(resolve, 20));

      await prisma.credential.update({ where: { id }, data: { decryptionKey: '{"envelope":true}' } });

      const after = await prisma.libraryRecord.findUniqueOrThrow({ where: { id } });
      expect(after.updatedAt.getTime()).toBe(before.getTime());
    });
  });

  describe('CheckRun_generation_check and CheckRun_one_pending_per_record', () => {
    it('refuses generation 0, and admits generation 1', async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-generations' });

      const message = await refusalOf(() =>
        prisma.checkRun.create({
          data: { tenantId: SYSTEM_TENANT_ID, recordId: id, generation: 0, state: CheckRunState.COMPLETE },
        }),
      );
      expect(message).toContain('CheckRun_generation_check');

      await prisma.checkRun.create({
        data: { tenantId: SYSTEM_TENANT_ID, recordId: id, generation: 1, state: CheckRunState.COMPLETE },
      });
      expect(await prisma.checkRun.count()).toBe(1);
    });

    it('refuses a second PENDING run for one record, and admits one beside a COMPLETE run', async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-pending' });
      await prisma.checkRun.create({
        data: { tenantId: SYSTEM_TENANT_ID, recordId: id, generation: 2, state: CheckRunState.COMPLETE },
      });
      await prisma.checkRun.create({
        data: { tenantId: SYSTEM_TENANT_ID, recordId: id, generation: 3, state: CheckRunState.PENDING },
      });

      // Raw, because the typed client reports only the field list. The
      // reported key names recordId alone, which is the partial index: the
      // (recordId, generation) unique key would name both, and generation 4
      // does not collide with it anyway.
      const message = await refusalOf(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "CheckRun"("id", "recordId", "tenantId", "generation", "state")
             VALUES ('run-second-pending', '${id}', '${SYSTEM_TENANT_ID}', 4, 'PENDING')`,
        ),
      );

      expect(message).toContain(`Key ("recordId")=(${id}) already exists`);
      expect(await prisma.checkRun.count()).toBe(2);
    });

    it('refuses a run whose tenant disagrees with its record (CheckRun_recordId_tenantId_fkey)', async () => {
      const { id } = await insertNativeCredential(prisma, { id: 'rec-run-tenant' });
      await prisma.tenant.create({ data: { id: 'tenant-run-other', name: 'Other' } });

      const message = await refusalOf(() =>
        prisma.checkRun.create({
          data: { tenantId: 'tenant-run-other', recordId: id, generation: 2, state: CheckRunState.COMPLETE },
        }),
      );

      expect(message).toContain('CheckRun_recordId_tenantId_fkey');
      expect(await prisma.checkRun.count()).toBe(0);
    });

    it('admits a PENDING run for a second record while the first is pending', async () => {
      const first = await insertNativeCredential(prisma, { id: 'rec-pending-a' });
      const second = await insertNativeCredential(prisma, { id: 'rec-pending-b' });
      await prisma.checkRun.create({
        data: { tenantId: SYSTEM_TENANT_ID, recordId: first.id, generation: 2, state: CheckRunState.PENDING },
      });

      await prisma.checkRun.create({
        data: { tenantId: SYSTEM_TENANT_ID, recordId: second.id, generation: 2, state: CheckRunState.PENDING },
      });

      expect(await prisma.checkRun.count()).toBe(2);
    });
  });

  describe('the objects the Prisma schema cannot declare', () => {
    it('pins the triggers, checks and hand-written indexes the schema cannot declare, by name', async () => {
      const names = async (sql: string) => (await prisma.$queryRawUnsafe<{ name: string }[]>(sql)).map((r) => r.name);

      await expect(names(`SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal`)).resolves.toEqual(
        expect.arrayContaining([
          'LibraryRecord_has_one_child',
          'Credential_delete_via_parent',
          'ExternalCredential_delete_via_parent',
          'Credential_identity_immutable',
          'ExternalCredential_identity_immutable',
          'Credential_link_change_touches_record',
        ]),
      );
      await expect(names(`SELECT conname AS name FROM pg_constraint WHERE contype = 'c'`)).resolves.toEqual(
        expect.arrayContaining([
          'Credential_origin_check',
          'ExternalCredential_origin_check',
          'CheckRun_generation_check',
        ]),
      );
      await expect(names(`SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'`)).resolves.toEqual(
        expect.arrayContaining(['CheckRun_one_pending_per_record', 'LibraryRecord_tenantId_lower_issuerName_idx']),
      );
    });

    it('keeps the issuer-name index on the lower-cased expression the case-insensitive filter needs', async () => {
      // The only object here with no behavioural test of its own: a migration
      // that recreated it on `upper("issuerName")`, or on the bare column,
      // would keep the name and silently send the filter to a sequential scan.
      const [index] = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'LibraryRecord_tenantId_lower_issuerName_idx'`,
      );

      expect(index?.indexdef).toContain('lower("issuerName")');
    });
  });
});
