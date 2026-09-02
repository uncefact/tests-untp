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
import {
  AdapterType,
  CoreCredentialType,
  IdempotencyOperation,
  LibraryRecordOrigin,
  ServiceType,
} from '../../src/lib/prisma/generated';
import { auditEncryption } from '../../src/lib/credentials/audit-encryption';
import { ENVELOPE_STORE_IDS } from '../../src/lib/credentials/envelope-stores';
import { prismaEnvelopeStores } from '../../src/lib/credentials/prisma-envelope-stores';
import { rotateEncryptionKey } from '../../src/lib/credentials/rotate-encryption-key';
import { validateEncryptionKeyAtStartup } from '../../src/lib/credentials/validate-encryption-key-startup';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertNativeCredential, seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';

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
  await insertNativeCredential(prisma, { id: 'cred-1', decryptionKey: envelopeUnder(OUTGOING_KEY, 'native-key') });
  // A legacy plaintext key and two null values, so the real queries' filters
  // and narrowing are exercised, not only their happy shape.
  await insertNativeCredential(prisma, { id: 'cred-plain', decryptionKey: 'b'.repeat(64) });
  await insertNativeCredential(prisma, { id: 'cred-nokey', decryptionKey: null });
  await prisma.$transaction(async (tx) => {
    const record = await tx.libraryRecord.create({
      data: { id: 'ext-1', tenantId: SYSTEM_TENANT_ID, origin: LibraryRecordOrigin.EXTERNAL },
    });
    await tx.externalCredential.create({
      data: {
        id: record.id,
        tenantId: SYSTEM_TENANT_ID,
        displayName: 'Supplier DCC',
        declaredCredentialType: CoreCredentialType.DCC,
        decryptionKey: envelopeUnder(OUTGOING_KEY, 'external-key'),
      },
    });
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
      recordId: 'cred-1',
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
    const revealed = async (
      id: 'serviceInstances' | 'credentials' | 'externalCredentials' | 'idempotencyResponses',
    ) => {
      const rows: string[] = [];
      for await (const row of stores[id].rows()) {
        if (row.value.startsWith('{')) rows.push(adapter(ACTIVE_KEY).decrypt(JSON.parse(row.value)));
      }
      return rows;
    };
    await expect(revealed('serviceInstances')).resolves.toEqual(['{"apiUrl":"https://storage.test"}']);
    await expect(revealed('credentials')).resolves.toEqual(['native-key']);
    await expect(revealed('externalCredentials')).resolves.toEqual(['external-key']);
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
    await insertNativeCredential(prisma, { id: 'cred-2', decryptionKey: envelopeUnder(OUTGOING_KEY, 'native-key-2') });
    await prisma.idempotencyKey.create({
      data: {
        id: 'claim-stale',
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.CREDENTIAL_ISSUE,
        key: 'k-stale',
        bodyDigest: 'zStale',
        recordId: 'cred-2',
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
      recordId: 'cred-2',
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

    // With the native credentials gone (a child row is only ever deleted through
    // its library record), the external credential keys are next in the walk.
    await prisma.libraryRecord.deleteMany({ where: { origin: LibraryRecordOrigin.NATIVE } });
    await expect(validateEncryptionKeyAtStartup(stores, adapter(OUTGOING_KEY))).resolves.toEqual({
      validated: true,
      source: 'externalCredentials',
      id: 'ext-1',
    });

    // Deleting the library records cascades their claims, so leave one replay
    // body that opens under the key with no record behind it: it is never
    // sampled, so there is nothing left to validate against.
    await prisma.libraryRecord.deleteMany();
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
