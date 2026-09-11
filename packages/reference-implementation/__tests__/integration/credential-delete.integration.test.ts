import {
  CheckResult,
  CheckRunState,
  IdempotencyOperation,
  LibraryRecordOrigin,
  ProductLevel,
} from '../../src/lib/prisma/generated/index.js';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertExternalCredential, insertNativeCredential, seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import { createCredential, deleteNativeCredential } from '../../src/lib/prisma/repositories/credential.repository';
import { claimIdempotencyKey } from '../../src/lib/prisma/repositories/idempotency-key.repository';
import { prisma } from '../../src/lib/prisma/prisma';

const OTHER_TENANT_ID = 'credential-delete-other';
const client = createRigClient();

const COORDINATES = {
  storageServiceInstanceId: 'storage-instance-1',
  storageExternalId: 'object-1',
  storageBucket: 'bucket-1',
};

beforeAll(async () => {
  await client.$connect();
});

beforeEach(async () => {
  await truncateApplicationTables(client);
  await seedSystemTenant(client);
  await client.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Other tenant' } });
});

afterAll(async () => {
  await prisma.$disconnect();
  await client.$disconnect();
});

async function nativeWithCoordinates(id: string, tenantId = SYSTEM_TENANT_ID): Promise<void> {
  await insertNativeCredential(client, {
    id,
    tenantId,
    storageUri: `https://storage.test/${id}`,
    checkRun: { state: CheckRunState.COMPLETE, proof: CheckResult.PASS },
  });
  await client.credential.update({ where: { id }, data: COORDINATES });
}

describe('deleteNativeCredential', () => {
  it('deletes the record, its child, its check runs and its idempotency claim, and returns the recorded coordinates', async () => {
    await nativeWithCoordinates('native-1');
    const claim = await claimIdempotencyKey({
      tenantId: SYSTEM_TENANT_ID,
      key: 'issue-key-1',
      operation: IdempotencyOperation.CREDENTIAL_ISSUE,
      bodyDigest: 'digest-1',
    });
    if (claim.outcome !== 'claimed') throw new Error(`expected a claimed key, got ${claim.outcome}`);
    await client.idempotencyKey.update({ where: { id: claim.claimId }, data: { recordId: 'native-1' } });

    const result = await deleteNativeCredential({ recordId: 'native-1', tenantId: SYSTEM_TENANT_ID });

    expect(result).toEqual({
      outcome: 'deleted',
      storage: { storageUri: 'https://storage.test/native-1', ...COORDINATES },
    });
    expect(await client.libraryRecord.findUnique({ where: { id: 'native-1' } })).toBeNull();
    expect(await client.credential.findUnique({ where: { id: 'native-1' } })).toBeNull();
    expect(await client.checkRun.count({ where: { recordId: 'native-1' } })).toBe(0);
    expect(await client.idempotencyKey.count({ where: { tenantId: SYSTEM_TENANT_ID, key: 'issue-key-1' } })).toBe(0);
  });

  it('returns null coordinates beside the URI for a credential issued before they were recorded', async () => {
    await insertNativeCredential(client, { id: 'native-legacy', storageUri: 'https://storage.test/legacy' });

    const result = await deleteNativeCredential({ recordId: 'native-legacy', tenantId: SYSTEM_TENANT_ID });

    expect(result).toEqual({
      outcome: 'deleted',
      storage: {
        storageUri: 'https://storage.test/legacy',
        storageServiceInstanceId: null,
        storageExternalId: null,
        storageBucket: null,
      },
    });
    expect(await client.libraryRecord.findUnique({ where: { id: 'native-legacy' } })).toBeNull();
  });

  it('reports a record that exists only in another tenant as missing and leaves it in place', async () => {
    await nativeWithCoordinates('native-other', OTHER_TENANT_ID);

    await expect(deleteNativeCredential({ recordId: 'native-other', tenantId: SYSTEM_TENANT_ID })).resolves.toEqual({
      outcome: 'missing',
    });
    expect(await client.credential.findUnique({ where: { id: 'native-other' } })).not.toBeNull();
  });

  it('reports an absent id as missing, and a second delete of a deleted record the same way', async () => {
    await nativeWithCoordinates('native-twice');

    await expect(deleteNativeCredential({ recordId: 'never-existed', tenantId: SYSTEM_TENANT_ID })).resolves.toEqual({
      outcome: 'missing',
    });
    await deleteNativeCredential({ recordId: 'native-twice', tenantId: SYSTEM_TENANT_ID });
    await expect(deleteNativeCredential({ recordId: 'native-twice', tenantId: SYSTEM_TENANT_ID })).resolves.toEqual({
      outcome: 'missing',
    });
  });

  it('refuses an external record of the same tenant and leaves it in place', async () => {
    const externalId = await insertExternalCredential(client, SYSTEM_TENANT_ID);

    await expect(deleteNativeCredential({ recordId: externalId, tenantId: SYSTEM_TENANT_ID })).resolves.toEqual({
      outcome: 'external',
    });
    const record = await client.libraryRecord.findUnique({ where: { id: externalId } });
    expect(record?.origin).toBe(LibraryRecordOrigin.EXTERNAL);
  });

  it("leaves the tenant's other credential and the linked product in place", async () => {
    const product = await client.product.create({
      data: { tenantId: SYSTEM_TENANT_ID, name: 'Product kept by delete', level: ProductLevel.MODEL },
    });
    await insertNativeCredential(client, { id: 'native-doomed', productId: product.id });
    await insertNativeCredential(client, { id: 'native-kept', productId: product.id });

    await expect(
      deleteNativeCredential({ recordId: 'native-doomed', tenantId: SYSTEM_TENANT_ID }),
    ).resolves.toMatchObject({
      outcome: 'deleted',
    });

    expect(await client.libraryRecord.findUnique({ where: { id: 'native-doomed' } })).toBeNull();
    expect(await client.credential.findUnique({ where: { id: 'native-kept' } })).toMatchObject({
      productId: product.id,
    });
    expect(await client.product.findUnique({ where: { id: product.id } })).not.toBeNull();
  });
});

describe('createCredential', () => {
  it('persists the storage coordinates issuance supplies, distinct per column', async () => {
    const { credential } = await createCredential({
      tenantId: SYSTEM_TENANT_ID,
      storageUri: 'https://storage.test/api/v4/private-data/object-7.json',
      digestMultibase: 'zObject7',
      storageServiceInstanceId: 'instance-7',
      storageExternalId: 'object-7',
      storageBucket: 'private-data',
      credentialType: 'DigitalProductPassport',
      coreDataModelVersion: '0.6.1',
    });

    const row = await client.credential.findUniqueOrThrow({ where: { id: credential.id } });
    expect(row).toMatchObject({
      storageServiceInstanceId: 'instance-7',
      storageExternalId: 'object-7',
      storageBucket: 'private-data',
    });
    expect(await deleteNativeCredential({ recordId: credential.id, tenantId: SYSTEM_TENANT_ID })).toEqual({
      outcome: 'deleted',
      storage: {
        storageUri: 'https://storage.test/api/v4/private-data/object-7.json',
        storageServiceInstanceId: 'instance-7',
        storageExternalId: 'object-7',
        storageBucket: 'private-data',
      },
    });
  });
});
