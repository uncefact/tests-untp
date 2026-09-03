/**
 * The 20260902000000_library_records data move, run the way a deployment
 * runs it: against a database at the previous migration that already holds
 * credential, data-model and idempotency rows. The rig's own database has
 * every migration applied before any suite runs, so it cannot exercise this.
 * This suite creates a second database on the rig's server, walks it to the
 * previous migration through the Prisma CLI, seeds it with raw SQL (the
 * generated client only knows the new shape), applies the migration file,
 * and reads the result back.
 */
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '../../src/lib/prisma/generated/index.js';
import { createRigClient } from './rig/db';

const MIGRATION = '20260902000000_library_records';
const SYSTEM_TENANT = 'caq0ibyulrnh85itqtbgusfp3';
const UPGRADE_DB = 'ri_library_records_upgrade';
const DEPLOY_FAILURE_DB = 'ri_library_records_deploy_failure';
/** The columns the migration moves from the child to the parent. */
const MOVED_COLUMNS = [
  'name',
  'issuerName',
  'issuerDid',
  'subjectName',
  'subjectId',
  'validFrom',
  'validUntil',
  'detailsStatus',
  'detailsError',
  'coreDataModelVersion',
  'credentialType',
];
/** Stands for a key wrapped by protectDecryptionKey (#697); only its bytes matter here. */
const ENVELOPE_KEY = 'v1.aaaabbbbccccdddd.eeeeffff00001111.2222333344445555';
/** Stands for a pre-#697 key held in plaintext. */
const PLAINTEXT_KEY = 'b'.repeat(64);
const packageRoot = path.resolve(__dirname, '../..');

interface CliOutcome {
  failed: boolean;
  stdout: string;
  stderr: string;
}

/** Runs the Prisma CLI and reports the outcome, for the paths that expect a failure. */
function runPrismaCli(args: string[], url: string): CliOutcome {
  const options: ExecFileSyncOptions = {
    cwd: packageRoot,
    env: { ...process.env, RI_DATABASE_URL: url },
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  try {
    const stdout = execFileSync('pnpm', ['exec', 'prisma', ...args], options);
    return { failed: false, stdout: stdout.toString(), stderr: '' };
  } catch (err) {
    const streams = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      failed: true,
      stdout: streams.stdout?.toString() ?? '',
      stderr: streams.stderr?.toString() ?? '',
    };
  }
}

function prismaCli(args: string[], url: string): void {
  const outcome = runPrismaCli(args, url);
  if (!outcome.failed) return;
  const detail = `${outcome.stdout}${outcome.stderr}`.trim();
  throw new Error(`prisma ${args.slice(0, 2).join(' ')} failed${detail ? `:\n${detail}` : ''}`);
}

describe('library records migration on a populated database', () => {
  const admin = createRigClient();
  let upgrade: PrismaClient;

  beforeAll(async () => {
    const url = new URL(process.env.RI_DATABASE_URL as string);
    url.pathname = `/${UPGRADE_DB}`;
    const upgradeUrl = url.toString();

    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${UPGRADE_DB}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${UPGRADE_DB}"`);
    // Marking this migration applied makes deploy stop at the previous one;
    // the file itself is applied below, once the rows exist.
    prismaCli(['migrate', 'resolve', '--applied', MIGRATION, '--config', 'prisma/prisma.config.ts'], upgradeUrl);
    prismaCli(['migrate', 'deploy', '--config', 'prisma/prisma.config.ts'], upgradeUrl);

    upgrade = new PrismaClient({ datasources: { db: { url: upgradeUrl } } });
    await upgrade.$executeRawUnsafe(
      `INSERT INTO "Tenant"(id, name, "updatedAt") VALUES
         ('${SYSTEM_TENANT}', 'system', now()), ('tenant-a', 'A', now()), ('tenant-b', 'B', now())`,
    );
    // Three core models and one whose type name is not a core one, then the
    // same extension name registered under different tenants with different
    // parents: agreeing core parents, disagreeing core parents, and a core
    // parent beside the non-core one.
    await upgrade.$executeRawUnsafe(
      `INSERT INTO "DataModel"(id, "tenantId", name, "credentialType", version, "isExtension", "parentConfigId", "schemaUrl", "contextUrl", "updatedAt") VALUES
         ('dpp', '${SYSTEM_TENANT}', 'DPP', 'DigitalProductPassport', '0.6.1', false, NULL, 's', 'c', now()),
         ('dcc', '${SYSTEM_TENANT}', 'DCC', 'DigitalConformityCredential', '0.7.0', false, NULL, 's', 'c', now()),
         ('dfr', '${SYSTEM_TENANT}', 'DFR', 'DigitalFacilityRecord', '0.6.1', false, NULL, 's', 'c', now()),
         ('legacy', 'tenant-a', 'Legacy', 'LegacyThing', '9.9.9', false, NULL, 's', 'c', now()),
         ('agree-a', 'tenant-a', 'X', 'AgreeingExtension', '1.0.0', true, 'dpp', 's', 'c', now()),
         ('agree-sys', '${SYSTEM_TENANT}', 'X', 'AgreeingExtension', '2.0.0', true, 'dpp', 's', 'c', now()),
         ('disagree-a', 'tenant-a', 'Y', 'DisagreeingExtension', '1.0.0', true, 'dpp', 's', 'c', now()),
         ('disagree-sys', '${SYSTEM_TENANT}', 'Y', 'DisagreeingExtension', '1.0.0', true, 'dcc', 's', 'c', now()),
         ('other-b', 'tenant-b', 'Z', 'OtherTenantExtension', '1.0.0', true, 'dfr', 's', 'c', now()),
         ('legacy-parent-a', 'tenant-a', 'L1', 'LegacyParentExtension', '1.0.0', true, 'legacy', 's', 'c', now()),
         ('legacy-parent-sys', '${SYSTEM_TENANT}', 'L1', 'LegacyParentExtension', '1.0.0', true, 'dpp', 's', 'c', now()),
         ('legacy-match-a', 'tenant-a', 'L2', 'LegacyVersionMatchExtension', '1.0.0', true, 'legacy', 's', 'c', now()),
         ('legacy-match-sys', '${SYSTEM_TENANT}', 'L2', 'LegacyVersionMatchExtension', '1.0.0', true, 'dpp', 's', 'c', now())`,
    );
    // One row with every moved column non-null and distinct, so a migration
    // that dropped a column on the way across is visible rather than
    // indistinguishable from the implicit nulls the other rows carry. Its
    // timestamps sit in the past for the same reason: the parent's `now()`
    // default would otherwise pass for a carried value.
    await upgrade.$executeRawUnsafe(
      `INSERT INTO "Credential"(
         id, "storageUri", "digestMultibase", "tenantId", "decryptionKey",
         name, "issuerName", "issuerDid", "subjectName", "subjectId",
         "validFrom", "validUntil", "credentialType", "coreDataModelVersion",
         "detailsStatus", "detailsError", "createdAt", "updatedAt")
       VALUES (
         'c-populated', 'https://storage.test/populated', 'zPopulated', 'tenant-a', '${ENVELOPE_KEY}',
         'Populated passport', 'Populated Issuer', 'did:web:issuer.example', 'Merino batch',
         'https://example.com/product/1',
         TIMESTAMP '2023-03-04 05:06:07', TIMESTAMP '2024-08-09 10:11:12',
         'DigitalProductPassport', '0.6.1',
         'EXTRACTION_FAILED', 'BRIDGE_ERROR',
         TIMESTAMP '2022-01-02 03:04:05', TIMESTAMP '2022-02-03 04:05:06')`,
    );
    // A legacy plaintext key beside the wrapped one above. The migration does
    // not touch decryptionKey, and both are asserted byte-identical after it.
    await upgrade.$executeRawUnsafe(
      `INSERT INTO "Credential"(id, "storageUri", "digestMultibase", "credentialType", "tenantId", "updatedAt", name, "detailsStatus", "coreDataModelVersion", "decryptionKey") VALUES
         ('c-plaintext-key', 'u', 'd', 'DigitalProductPassport', 'tenant-a', now(), 'plaintext key', 'EXTRACTED', '0.6.1', '${PLAINTEXT_KEY}')`,
    );
    await upgrade.$executeRawUnsafe(
      `INSERT INTO "Credential"(id, "storageUri", "digestMultibase", "credentialType", "tenantId", "updatedAt", name, "issuerName", "detailsStatus", "coreDataModelVersion") VALUES
         ('c-core', 'u', 'd', 'DigitalProductPassport', 'tenant-a', now(), 'core passport', 'Issuer A', 'EXTRACTED', '0.6.1'),
         ('c-agree', 'u', 'd', 'AgreeingExtension', 'tenant-a', now(), 'agreeing', NULL, 'EXTRACTED', '0.6.1'),
         ('c-disagree-versioned', 'u', 'd', 'DisagreeingExtension', 'tenant-a', now(), 'versioned', NULL, 'EXTRACTED', '0.7.0'),
         ('c-disagree-unversioned', 'u', 'd', 'DisagreeingExtension', 'tenant-a', now(), 'unversioned', NULL, 'EXTRACTED', NULL),
         ('c-other-a', 'u', 'd', 'OtherTenantExtension', 'tenant-a', now(), 'not visible', NULL, 'EXTRACTED', '0.6.1'),
         ('c-other-b', 'u', 'd', 'OtherTenantExtension', 'tenant-b', now(), 'visible', NULL, 'EXTRACTED', '0.6.1'),
         ('c-legacy-parent', 'u', 'd', 'LegacyParentExtension', 'tenant-a', now(), 'legacy parent', NULL, 'EXTRACTED', '5.5.5'),
         ('c-legacy-version-match', 'u', 'd', 'LegacyVersionMatchExtension', 'tenant-a', now(), 'legacy match', NULL, 'EXTRACTED', '9.9.9'),
         ('c-unregistered', 'u', 'd', 'NobodyRegisteredThis', 'tenant-a', now(), NULL, NULL, 'EXTRACTION_PENDING', NULL)`,
    );
    // A finalised claim pointing at a credential, and the in-flight case: a
    // claim with no credential yet, which must survive the rename with a null
    // record rather than failing the new composite foreign key.
    await upgrade.$executeRawUnsafe(
      `INSERT INTO "IdempotencyKey"(id, "tenantId", operation, key, "bodyDigest", "credentialId") VALUES
         ('claim-1', 'tenant-a', 'CREDENTIAL_ISSUE', 'k1', 'zBody', 'c-core'),
         ('claim-empty', 'tenant-a', 'CREDENTIAL_ISSUE', 'k2', 'zBody2', NULL)`,
    );

    prismaCli(
      ['db', 'execute', '--url', upgradeUrl, '--file', path.join('prisma', 'migrations', MIGRATION, 'migration.sql')],
      upgradeUrl,
    );
  }, 180_000);

  afterAll(async () => {
    await upgrade?.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${UPGRADE_DB}" WITH (FORCE)`);
    await admin.$disconnect();
  }, 60_000);

  it('gives every credential a native parent that carries its fields and keeps its id', async () => {
    const parents = await upgrade.$queryRawUnsafe<
      { id: string; origin: string; name: string | null; issuerName: string | null; detailsStatus: string }[]
    >(`SELECT id, origin, name, "issuerName", "detailsStatus" FROM "LibraryRecord" ORDER BY id`);
    expect(parents).toHaveLength(11);
    expect(parents.every((p) => p.origin === 'NATIVE')).toBe(true);
    expect(parents.find((p) => p.id === 'c-core')).toMatchObject({
      name: 'core passport',
      issuerName: 'Issuer A',
      detailsStatus: 'EXTRACTED',
    });

    const children = await upgrade.$queryRawUnsafe<{ id: string; origin: string }[]>(
      `SELECT id, origin FROM "Credential" ORDER BY id`,
    );
    expect(children.map((c) => c.id)).toEqual(parents.map((p) => p.id));
    expect(children.every((c) => c.origin === 'NATIVE')).toBe(true);
  });

  it('derives the core kind from the type name, or from extension models the tenant can see when they agree', async () => {
    const rows = await upgrade.$queryRawUnsafe<{ id: string; coreCredentialType: string | null }[]>(
      `SELECT id, "coreCredentialType" FROM "LibraryRecord"`,
    );
    const kinds = Object.fromEntries(rows.map((r) => [r.id, r.coreCredentialType]));
    expect(kinds).toEqual({
      'c-core': 'DPP',
      'c-populated': 'DPP',
      'c-plaintext-key': 'DPP',
      // Own-tenant and system registrations both extend DPP.
      'c-agree': 'DPP',
      // Own-tenant extends DPP at 0.6.1, system extends DCC at 0.7.0; the row
      // recorded core version 0.7.0, so the candidate at that version wins.
      'c-disagree-versioned': 'DCC',
      // The same two candidates with no recorded version disagree, so no guess.
      'c-disagree-unversioned': null,
      // Registered only under another tenant, so not visible to this one.
      'c-other-a': null,
      'c-other-b': 'DFR',
      // Own-tenant extends a model whose type name is not a core one, system
      // extends DPP, and neither parent is at the row's recorded version. The
      // unrecognised parent is a candidate like any other, so the two do not
      // agree and the row keeps no kind rather than taking the DPP one.
      'c-legacy-parent': null,
      // The only candidate at the row's recorded version has that same
      // unrecognised parent. Preferring it is the whole point of the version
      // rule, so the recognised candidate at another version is not a
      // fallback and the row keeps no kind.
      'c-legacy-version-match': null,
      'c-unregistered': null,
    });
  });

  it('moves the descriptive columns off the child and re-points the idempotency claim at the parent', async () => {
    const childColumns = await upgrade.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Credential'`,
    );
    const names = childColumns.map((c) => c.column_name);
    for (const moved of MOVED_COLUMNS) {
      expect(names).not.toContain(moved);
    }
    expect(names).toEqual(expect.arrayContaining(['id', 'tenantId', 'origin', 'storageUri', 'isPublished']));

    const claims = await upgrade.$queryRawUnsafe<{ id: string; recordId: string | null }[]>(
      `SELECT id, "recordId" FROM "IdempotencyKey" ORDER BY id`,
    );
    expect(claims).toEqual([
      { id: 'claim-1', recordId: 'c-core' },
      // The in-flight claim keeps its null and survives the new composite
      // foreign key, which a null record id does not have to satisfy.
      { id: 'claim-empty', recordId: null },
    ]);
  });

  it('carries every one of the eleven moved columns, and the two timestamps, onto the parent', async () => {
    const [parent] = await upgrade.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT "name", "issuerName", "issuerDid", "subjectName", "subjectId", "validFrom", "validUntil",
              "credentialType", "coreDataModelVersion", "detailsStatus", "detailsError", "createdAt", "updatedAt"
         FROM "LibraryRecord" WHERE id = 'c-populated'`,
    );

    expect(parent).toEqual({
      name: 'Populated passport',
      issuerName: 'Populated Issuer',
      issuerDid: 'did:web:issuer.example',
      subjectName: 'Merino batch',
      subjectId: 'https://example.com/product/1',
      validFrom: new Date('2023-03-04T05:06:07.000Z'),
      validUntil: new Date('2024-08-09T10:11:12.000Z'),
      credentialType: 'DigitalProductPassport',
      coreDataModelVersion: '0.6.1',
      detailsStatus: 'EXTRACTION_FAILED',
      detailsError: 'BRIDGE_ERROR',
      createdAt: new Date('2022-01-02T03:04:05.000Z'),
      updatedAt: new Date('2022-02-03T04:05:06.000Z'),
    });
  });

  it('leaves every decryption key on the child byte-identical, wrapped or plaintext', async () => {
    const rows = await upgrade.$queryRawUnsafe<{ id: string; decryptionKey: string | null }[]>(
      `SELECT id, "decryptionKey" FROM "Credential" WHERE id IN ('c-populated', 'c-plaintext-key', 'c-core') ORDER BY id`,
    );

    expect(rows).toEqual([
      { id: 'c-core', decryptionKey: null },
      { id: 'c-plaintext-key', decryptionKey: PLAINTEXT_KEY },
      { id: 'c-populated', decryptionKey: ENVELOPE_KEY },
    ]);
  });
});

/**
 * The deployment path when the data cannot satisfy the new composite foreign
 * key. The old single-column key let a claim name a credential another tenant
 * owns; the new one pins the pair, so such a row stops the upgrade. This runs
 * the real `prisma migrate deploy` rather than the migration file, because
 * what is under test is what an operator sees and does: the failure, the
 * rollback, and the roll-forward recovery.
 */
describe('deploying against a claim that names another tenant credential', () => {
  const admin = createRigClient();
  let target: PrismaClient;
  let targetUrl: string;
  let attempt: CliOutcome;

  beforeAll(async () => {
    const url = new URL(process.env.RI_DATABASE_URL as string);
    url.pathname = `/${DEPLOY_FAILURE_DB}`;
    targetUrl = url.toString();

    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DEPLOY_FAILURE_DB}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${DEPLOY_FAILURE_DB}"`);
    prismaCli(['migrate', 'resolve', '--applied', MIGRATION, '--config', 'prisma/prisma.config.ts'], targetUrl);
    prismaCli(['migrate', 'deploy', '--config', 'prisma/prisma.config.ts'], targetUrl);

    target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
    // That marker stopped deploy at the previous migration. Dropping it makes
    // this migration pending again, so the deploy below is a real first run
    // of it rather than a replay of a recorded one.
    await target.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE migration_name = '${MIGRATION}'`);

    await target.$executeRawUnsafe(
      `INSERT INTO "Tenant"(id, name, "updatedAt") VALUES ('tenant-a', 'A', now()), ('tenant-b', 'B', now())`,
    );
    await target.$executeRawUnsafe(
      `INSERT INTO "Credential"(id, "storageUri", "digestMultibase", "credentialType", "tenantId", "updatedAt", "detailsStatus") VALUES
         ('c-owned-by-a', 'u', 'd', 'DigitalProductPassport', 'tenant-a', now(), 'EXTRACTED')`,
    );
    await target.$executeRawUnsafe(
      `INSERT INTO "IdempotencyKey"(id, "tenantId", operation, key, "bodyDigest", "credentialId") VALUES
         ('claim-wrong-tenant', 'tenant-b', 'CREDENTIAL_ISSUE', 'k1', 'zBody', 'c-owned-by-a')`,
    );

    attempt = runPrismaCli(['migrate', 'deploy', '--config', 'prisma/prisma.config.ts'], targetUrl);
  }, 180_000);

  afterAll(async () => {
    await target?.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DEPLOY_FAILURE_DB}" WITH (FORCE)`);
    await admin.$disconnect();
  }, 60_000);

  it('fails, naming the foreign key the claim violates', () => {
    expect(attempt.failed).toBe(true);
    expect(attempt.stderr).toContain('IdempotencyKey_recordId_tenantId_fkey');
  });

  it('leaves the previous schema and data whole, because the whole migration rolls back', async () => {
    const columns = await target.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Credential'`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(expect.arrayContaining(MOVED_COLUMNS));

    const tables = await target.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('LibraryRecord', 'ExternalCredential', 'CheckRun')`,
    );
    expect(tables).toEqual([]);

    const claims = await target.$queryRawUnsafe<{ id: string; credentialId: string | null }[]>(
      `SELECT id, "credentialId" FROM "IdempotencyKey"`,
    );
    expect(claims).toEqual([{ id: 'claim-wrong-tenant', credentialId: 'c-owned-by-a' }]);
  });

  it('records the attempt as started and unfinished, so a later deploy stops on it', async () => {
    const rows = await target.$queryRawUnsafe<
      { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
    >(
      `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = '${MIGRATION}'`,
    );

    expect(rows).toEqual([{ migration_name: MIGRATION, finished_at: null, rolled_back_at: null }]);
  });

  describe('once the operator marks the attempt rolled back and corrects the claim', () => {
    beforeAll(async () => {
      prismaCli(['migrate', 'resolve', '--rolled-back', MIGRATION, '--config', 'prisma/prisma.config.ts'], targetUrl);
      await target.$executeRawUnsafe(
        `UPDATE "IdempotencyKey" SET "tenantId" = 'tenant-a' WHERE id = 'claim-wrong-tenant'`,
      );
      prismaCli(['migrate', 'deploy', '--config', 'prisma/prisma.config.ts'], targetUrl);
    }, 180_000);

    it('applies, giving the credential its parent and re-pointing the claim at it', async () => {
      const records = await target.$queryRawUnsafe<{ id: string; tenantId: string; origin: string }[]>(
        `SELECT id, "tenantId", origin FROM "LibraryRecord"`,
      );
      expect(records).toEqual([{ id: 'c-owned-by-a', tenantId: 'tenant-a', origin: 'NATIVE' }]);

      const claims = await target.$queryRawUnsafe<{ id: string; recordId: string | null; tenantId: string }[]>(
        `SELECT id, "recordId", "tenantId" FROM "IdempotencyKey"`,
      );
      expect(claims).toEqual([{ id: 'claim-wrong-tenant', recordId: 'c-owned-by-a', tenantId: 'tenant-a' }]);

      const finished = await target.$queryRawUnsafe<{ migration_name: string }[]>(
        `SELECT migration_name FROM "_prisma_migrations"
          WHERE migration_name = '${MIGRATION}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      );
      expect(finished).toHaveLength(1);
    });
  });
});
