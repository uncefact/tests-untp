/**
 * The key lifecycle across every registered encrypted store, against a real
 * Postgres: one envelope per store written under an outgoing key, audited,
 * rotated to the active key, audited again under both keys, and sampled by
 * the startup validation. The unit suites prove each operation's logic on
 * fakes; this proves the registry's queries and compare-and-swap writes
 * against the real Prisma client for every store at once, so a store that
 * only a fake ever satisfied cannot pass.
 */
import { AesGcmEncryptionAdapter, EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import { AdapterType, IdempotencyOperation, ServiceType } from '../../src/lib/prisma/generated';
import { auditEncryption } from '../../src/lib/credentials/audit-encryption';
import { ENVELOPE_STORE_IDS } from '../../src/lib/credentials/envelope-stores';
import { prismaEnvelopeStores } from '../../src/lib/credentials/prisma-envelope-stores';
import { rotateEncryptionKey } from '../../src/lib/credentials/rotate-encryption-key';
import { validateEncryptionKeyAtStartup } from '../../src/lib/credentials/validate-encryption-key-startup';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';

const OUTGOING_KEY = 'a'.repeat(64);
const ACTIVE_KEY = 'b'.repeat(64);

const prisma = createRigClient();

function adapter(key: string): AesGcmEncryptionAdapter {
  const logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => logger };
  return new AesGcmEncryptionAdapter(key, logger as never);
}

function envelopeUnder(key: string, plaintext: string): string {
  return JSON.stringify(adapter(key).encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM));
}

/** One row per store, each holding a value encrypted under the outgoing key. */
async function seedOneEnvelopePerStore(): Promise<void> {
  await prisma.serviceInstance.create({
    data: {
      id: 'svc-1',
      tenantId: SYSTEM_TENANT_ID,
      serviceType: ServiceType.STORAGE,
      adapterType: AdapterType.UNCEFACT_STORAGE,
      name: 'storage',
      config: envelopeUnder(OUTGOING_KEY, '{"apiUrl":"https://storage.test"}'),
    },
  });
  await prisma.credential.create({
    data: {
      id: 'cred-1',
      tenantId: SYSTEM_TENANT_ID,
      storageUri: 'https://storage.test/cred-1',
      digestMultibase: 'zCred1',
      credentialType: 'DigitalProductPassport',
      decryptionKey: envelopeUnder(OUTGOING_KEY, 'native-key'),
    },
  });
  // A legacy plaintext key and two null values, so the real queries' filters
  // and narrowing are exercised, not only their happy shape.
  await prisma.credential.createMany({
    data: [
      {
        id: 'cred-plain',
        tenantId: SYSTEM_TENANT_ID,
        storageUri: 'u',
        digestMultibase: 'zPlain',
        credentialType: 'DigitalProductPassport',
        decryptionKey: 'b'.repeat(64),
      },
      {
        id: 'cred-nokey',
        tenantId: SYSTEM_TENANT_ID,
        storageUri: 'u',
        digestMultibase: 'zNoKey',
        credentialType: 'DigitalProductPassport',
        decryptionKey: null,
      },
    ],
  });
  await prisma.idempotencyKey.create({
    data: {
      id: 'claim-null',
      tenantId: SYSTEM_TENANT_ID,
      operation: IdempotencyOperation.CREDENTIAL_ISSUE,
      key: 'k0',
      bodyDigest: 'zBody0',
      responseBody: null,
    },
  });
  await prisma.idempotencyKey.create({
    data: {
      id: 'claim-1',
      tenantId: SYSTEM_TENANT_ID,
      operation: IdempotencyOperation.CREDENTIAL_ISSUE,
      key: 'k1',
      bodyDigest: 'zBody',
      credentialId: 'cred-1',
      responseBody: envelopeUnder(OUTGOING_KEY, '["warning"]'),
    },
  });
}

describe('encryption key lifecycle across every registered store', () => {
  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await seedSystemTenant(prisma);
    await seedOneEnvelopePerStore();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('audits, rotates, re-audits and samples one envelope in each store through the real client', async () => {
    const stores = prismaEnvelopeStores(prisma);
    const before = await auditEncryption(stores, adapter(OUTGOING_KEY));
    for (const id of ENVELOPE_STORE_IDS) {
      expect(before.stores[id]).toMatchObject({ okCount: 1, decryptFailedIds: [], corruptedIds: [] });
    }
    expect(before.keyVerified).toBe(true);
    // The plaintext key is counted, the null key and the null body are not seen at all.
    expect(before.stores.credentials.plaintextCount).toBe(1);

    const rotation = await rotateEncryptionKey(stores, {
      activeService: adapter(ACTIVE_KEY),
      outgoingService: adapter(OUTGOING_KEY),
    });
    expect(rotation.blocked).toBe(false);
    for (const id of ENVELOPE_STORE_IDS) {
      expect(rotation.stores[id]).toMatchObject({
        outgoingOpened: 1,
        rotated: 1,
        conflictIds: [],
        deletedIds: [],
      });
    }

    const underActive = await auditEncryption(stores, adapter(ACTIVE_KEY));
    const underOutgoing = await auditEncryption(stores, adapter(OUTGOING_KEY));
    for (const id of ENVELOPE_STORE_IDS) {
      expect(underActive.stores[id]).toMatchObject({ okCount: 1, decryptFailedIds: [] });
      expect(underOutgoing.stores[id].decryptFailedIds).toHaveLength(1);
    }

    // The plaintexts survive the rotation in every store.
    const revealed = async (id: 'serviceInstances' | 'credentials' | 'idempotencyResponses') => {
      const rows: string[] = [];
      for await (const row of stores[id].rows()) {
        if (row.value.startsWith('{')) rows.push(adapter(ACTIVE_KEY).decrypt(JSON.parse(row.value)));
      }
      return rows;
    };
    await expect(revealed('serviceInstances')).resolves.toEqual(['{"apiUrl":"https://storage.test"}']);
    await expect(revealed('credentials')).resolves.toEqual(['native-key']);
    await expect(revealed('idempotencyResponses')).resolves.toEqual(['["warning"]']);

    // A re-run converges: everything is already under the active key.
    const again = await rotateEncryptionKey(stores, {
      activeService: adapter(ACTIVE_KEY),
      outgoingService: adapter(OUTGOING_KEY),
    });
    for (const id of ENVELOPE_STORE_IDS) {
      expect(again.stores[id]).toMatchObject({ alreadyActive: 1, outgoingOpened: 0, rotated: 0 });
    }

    await expect(validateEncryptionKeyAtStartup(stores, adapter(ACTIVE_KEY))).resolves.toEqual({
      validated: true,
      source: 'serviceInstances',
      id: 'svc-1',
    });
  });

  it('clears a replay body that opens under neither key and keeps its claim and credential', async () => {
    const stores = prismaEnvelopeStores(prisma);
    // A claim maps to exactly one credential, so the stale claim gets its own.
    await prisma.credential.create({
      data: {
        id: 'cred-2',
        tenantId: SYSTEM_TENANT_ID,
        storageUri: 'u',
        digestMultibase: 'zCred2',
        credentialType: 'DigitalProductPassport',
        decryptionKey: envelopeUnder(OUTGOING_KEY, 'native-key-2'),
      },
    });
    await prisma.idempotencyKey.create({
      data: {
        id: 'claim-stale',
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.CREDENTIAL_ISSUE,
        key: 'k-stale',
        bodyDigest: 'zStale',
        credentialId: 'cred-2',
        responseBody: envelopeUnder('c'.repeat(64), '["old"]'),
      },
    });

    const rotation = await rotateEncryptionKey(stores, {
      activeService: adapter(ACTIVE_KEY),
      outgoingService: adapter(OUTGOING_KEY),
    });

    expect(rotation.blocked).toBe(false);
    expect(rotation.stores.idempotencyResponses).toMatchObject({
      rotated: 1,
      neitherKeyIds: ['claim-stale'],
      clearedIds: ['claim-stale'],
    });
    await expect(prisma.idempotencyKey.findUnique({ where: { id: 'claim-stale' } })).resolves.toMatchObject({
      credentialId: 'cred-2',
      responseBody: null,
    });
  });

  it('samples credentials at startup when there is no service instance, and never samples replay bodies', async () => {
    const stores = prismaEnvelopeStores(prisma);
    await prisma.serviceInstance.deleteMany();
    await expect(validateEncryptionKeyAtStartup(stores, adapter(OUTGOING_KEY))).resolves.toEqual({
      validated: true,
      source: 'credentials',
      id: 'cred-1',
    });

    await prisma.credential.deleteMany();
    // Deleting the credentials cascades their claims, so leave one replay
    // body that opens under the key with no credential behind it: it is
    // never sampled, so there is nothing left to validate against.
    await prisma.idempotencyKey.create({
      data: {
        id: 'claim-orphan',
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.CREDENTIAL_ISSUE,
        key: 'k-orphan',
        bodyDigest: 'zOrphan',
        responseBody: envelopeUnder(OUTGOING_KEY, '[]'),
      },
    });
    await expect(validateEncryptionKeyAtStartup(stores, adapter(OUTGOING_KEY))).resolves.toEqual({ validated: false });
  });
});
