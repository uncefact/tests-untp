import { createRigClient, truncateApplicationTables } from './rig/db';
import { seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import { AdapterType, ServiceType, type PrismaClient } from '../../src/lib/prisma/generated/index.js';

/**
 * Integration coverage for the decryption-key backfill (#770; ADR-029
 * integration layer), against real Postgres through the rig.
 *
 * The unit suite runs the backfill against a hand-written client whose
 * `findMany` reimplements the production query: the not-null filter, the
 * `id > cursor` paging, the ordering, the batch limit, and a fabricated
 * P2025 error. Everything that fake asserts is therefore true of the fake.
 *
 * Two scenarios here carry weight the unit suite cannot: the paged walk,
 * which no fake can get wrong on the fake's own terms, and the concurrent
 * delete, which raises a real Prisma error rather than one the test built to
 * match its own expectation. The rest cover the behaviours #770 lists, and
 * their added value over the unit suite is narrower: that a value survives
 * the round trip through a Postgres text column and is visible to another
 * connection.
 *
 * The active key is fixed per module load; scenarios needing a second key
 * (an envelope written under a key the run does not hold) reset the module
 * registry so `getEncryptionService`'s cached adapter is rebuilt.
 */

const ACTIVE_KEY = 'a'.repeat(64);
const OTHER_KEY = 'd'.repeat(64);

const client = createRigClient();
/** A second connection, so a concurrent delete is a real one. */
const concurrent = createRigClient();

const originalEnv = process.env;

beforeEach(async () => {
  jest.resetModules();
  // The resolver rejects a deprecated SERVICE_ENCRYPTION_KEY that disagrees
  // with the active key, so an exported one in the runner's shell would fail
  // these suites before they reached the behaviour under test.
  process.env = { ...originalEnv, DATA_ENCRYPTION_KEY: ACTIVE_KEY };
  delete process.env.SERVICE_ENCRYPTION_KEY;
  await truncateApplicationTables(client);
  await seedSystemTenant(client);
});

afterAll(async () => {
  process.env = originalEnv;
  await client.$disconnect();
  await concurrent.$disconnect();
});

/**
 * Imports the backfill and its collaborators after the module registry has
 * been reset, so they bind to whichever DATA_ENCRYPTION_KEY is currently set.
 */
async function loadBackfill() {
  return import('../../src/lib/credentials/backfill-decryption-keys');
}

async function loadProtection() {
  return import('../../src/lib/credentials/decryption-key-protection');
}

/** Produces an envelope under `key`, leaving the active key untouched afterwards. */
async function envelopeUnder(key: string, plaintext: string): Promise<string> {
  const previous = process.env.DATA_ENCRYPTION_KEY;
  jest.resetModules();
  process.env.DATA_ENCRYPTION_KEY = key;
  const { protectDecryptionKey } = await loadProtection();
  const envelope = protectDecryptionKey(plaintext);
  jest.resetModules();
  process.env.DATA_ENCRYPTION_KEY = previous;
  return envelope;
}

async function createCredential(id: string, decryptionKey: string | null): Promise<void> {
  await client.credential.create({
    data: {
      id,
      tenantId: SYSTEM_TENANT_ID,
      storageUri: `https://storage.test/${id}`,
      digestMultibase: `zQm${id}`,
      credentialType: 'DigitalProductPassport',
      decryptionKey,
    },
  });
}

async function createServiceInstance(id: string, config: string): Promise<void> {
  await client.serviceInstance.create({
    data: {
      id,
      tenantId: SYSTEM_TENANT_ID,
      serviceType: ServiceType.STORAGE,
      adapterType: AdapterType.UNCEFACT_STORAGE,
      name: `storage-${id}`,
      config,
    },
  });
}

/** Reads the stored value back through a connection the run did not use. */
async function storedKey(id: string): Promise<string | null> {
  const row = await concurrent.credential.findUniqueOrThrow({ where: { id }, select: { decryptionKey: true } });
  return row.decryptionKey;
}

describe('decryption-key backfill against Postgres', () => {
  it('wraps plaintext, leaves envelopes and nulls, and skips values that only resemble an envelope', async () => {
    const { protectDecryptionKey, isProtectedDecryptionKey, revealDecryptionKey } = await loadProtection();
    const alreadyWrapped = protectDecryptionKey('already-protected-key');

    await createCredential('c-plaintext-1', 'plaintext-key-1');
    await createCredential('c-plaintext-2', 'plaintext-key-2');
    await createCredential('c-wrapped', alreadyWrapped);
    await createCredential('c-suspect', '{"v":1,"iv":"truncated"');
    await createCredential('c-null', null);

    const { backfillDecryptionKeys } = await loadBackfill();
    const result = await backfillDecryptionKeys(client);

    expect(result.wrapped).toBe(2);
    expect(result.alreadyProtected).toBe(1);
    expect(result.suspectRowIds).toEqual(['c-suspect']);
    expect(result.keyVerified).toBe(true);

    expect(revealDecryptionKey(await storedKey('c-plaintext-1'))).toBe('plaintext-key-1');
    expect(revealDecryptionKey(await storedKey('c-plaintext-2'))).toBe('plaintext-key-2');
    expect(await storedKey('c-wrapped')).toBe(alreadyWrapped);
    expect(await storedKey('c-suspect')).toBe('{"v":1,"iv":"truncated"');
    expect(await storedKey('c-null')).toBeNull();
    expect(isProtectedDecryptionKey((await storedKey('c-plaintext-1')) as string)).toBe(true);
  });

  it('wraps every row when there are more of them than one query returns', async () => {
    // The production walk pages with `id > cursor` at a batch size of 100.
    // Rows are inserted in reverse id order so the heap order differs from
    // the sort order, and a scan that returns rows as stored no longer
    // happens to match `ORDER BY id`. That is what makes a wrong ordering
    // leave rows behind here rather than pass by luck. Asserting nothing
    // was already protected guards against a duplicate-yielding cursor.
    // A `gte` cursor is a different matter: wrapping leaves the row still
    // eligible, so the walk never terminates and that mutation shows up as
    // a hang rather than as this assertion.
    const total = 250;
    const ids = Array.from({ length: total }, (_, i) => `c-page-${String(i).padStart(4, '0')}`);
    await client.credential.createMany({
      data: [...ids].reverse().map((id) => ({
        id,
        tenantId: SYSTEM_TENANT_ID,
        storageUri: `https://storage.test/${id}`,
        digestMultibase: `zQm${id}`,
        credentialType: 'DigitalProductPassport',
        decryptionKey: `plaintext-${id}`,
      })),
    });

    const { backfillDecryptionKeys } = await loadBackfill();
    const { revealDecryptionKey, isProtectedDecryptionKey } = await loadProtection();
    // Nothing encrypted exists yet, so this run is the unverified-key case.
    const result = await backfillDecryptionKeys(client, { force: true });

    expect(result.wrapped).toBe(total);
    expect(result.alreadyProtected).toBe(0);

    const rows = await concurrent.credential.findMany({ select: { id: true, decryptionKey: true } });
    expect(rows).toHaveLength(total);
    const unwrapped = rows.filter((row) => !isProtectedDecryptionKey(row.decryptionKey as string));
    expect(unwrapped).toEqual([]);
    // Spot-check both ends of the range, so a truncated walk is unmistakable.
    expect(revealDecryptionKey(await storedKey(ids[0]))).toBe(`plaintext-${ids[0]}`);
    expect(revealDecryptionKey(await storedKey(ids[total - 1]))).toBe(`plaintext-${ids[total - 1]}`);
  });

  it('refuses to write when nothing stored can prove the key, and wraps once forced', async () => {
    await createCredential('c-unproven', 'plaintext-key');

    const { backfillDecryptionKeys, KeyUnverifiedError } = await loadBackfill();
    await expect(backfillDecryptionKeys(client)).rejects.toBeInstanceOf(KeyUnverifiedError);
    expect(await storedKey('c-unproven')).toBe('plaintext-key');

    const forced = await backfillDecryptionKeys(client, { force: true });
    expect(forced.wrapped).toBe(1);
    expect(forced.keyVerified).toBe(false);
    const { revealDecryptionKey } = await loadProtection();
    expect(revealDecryptionKey(await storedKey('c-unproven'))).toBe('plaintext-key');
  });

  it('aborts before writing when a stored envelope does not open under the active key', async () => {
    const foreignConfig = await envelopeUnder(OTHER_KEY, JSON.stringify({ baseUrl: 'https://storage.test' }));
    await createServiceInstance('si-foreign', foreignConfig);
    await createCredential('c-untouched', 'plaintext-key');

    const { backfillDecryptionKeys } = await loadBackfill();
    await expect(backfillDecryptionKeys(client)).rejects.toThrow(
      /Preflight decrypt failed[\s\S]*aborting before any write/,
    );

    // The preflight exists so that a wrong key costs nothing.
    expect(await storedKey('c-untouched')).toBe('plaintext-key');
  });

  it('converges on a second run', async () => {
    const { protectDecryptionKey } = await loadProtection();
    await createServiceInstance('si-proof', await envelopeUnder(ACTIVE_KEY, JSON.stringify({ ok: true })));
    await createCredential('c-first', 'plaintext-key');
    await createCredential('c-already', protectDecryptionKey('other-key'));

    const { backfillDecryptionKeys } = await loadBackfill();
    const first = await backfillDecryptionKeys(client);
    expect(first.wrapped).toBe(1);
    const afterFirst = await storedKey('c-first');

    const second = await backfillDecryptionKeys(client);
    expect(second.wrapped).toBe(0);
    expect(second.alreadyProtected).toBe(2);
    expect(second.suspectRowIds).toEqual([]);
    expect(await storedKey('c-first')).toBe(afterFirst);
  });

  it('reports a row deleted between being read and being written, without failing the run', async () => {
    await createServiceInstance('si-proof', await envelopeUnder(ACTIVE_KEY, JSON.stringify({ ok: true })));
    await createCredential('c-survivor', 'plaintext-survivor');
    await createCredential('c-vanishes', 'plaintext-vanishes');

    // Deleting through a second connection after the walk has read the row
    // and before its update lands is the race the production code tolerates
    // by inspecting Prisma's record-not-found code. The unit suite throws a
    // hand-built object carrying that code, which proves nothing about what
    // Prisma actually raises. The hook deletes whichever row is about to be
    // updated, so the scenario does not depend on the production batch size
    // holding both rows in one page.
    let deletedId: string | null = null;
    const racing = new Proxy(client, {
      get(target, property, receiver) {
        if (property !== 'credential') return Reflect.get(target, property, receiver);
        const credential = target.credential;
        return new Proxy(credential, {
          get(credentialTarget, credentialProperty, credentialReceiver) {
            if (credentialProperty !== 'update') {
              return Reflect.get(credentialTarget, credentialProperty, credentialReceiver);
            }
            return async (args: { where: { id: string } }) => {
              if (deletedId === null) {
                deletedId = args.where.id;
                await concurrent.credential.delete({ where: { id: deletedId } });
              }
              return (credentialTarget.update as (a: unknown) => Promise<unknown>)(args);
            };
          },
        });
      },
    }) as PrismaClient;

    const { backfillDecryptionKeys } = await loadBackfill();
    const result = await backfillDecryptionKeys(racing);

    expect(deletedId).not.toBeNull();
    expect(result.deletedRowIds).toEqual([deletedId]);
    expect(result.wrapped).toBe(1);
    const survivor = deletedId === 'c-survivor' ? 'c-vanishes' : 'c-survivor';
    const { revealDecryptionKey } = await loadProtection();
    expect(revealDecryptionKey(await storedKey(survivor))).toBe(`plaintext-${survivor.replace('c-', '')}`);
  });
});
