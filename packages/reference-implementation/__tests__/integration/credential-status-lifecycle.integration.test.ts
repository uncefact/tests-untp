import { prisma } from '../../src/lib/prisma/prisma';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertNativeCredential, insertExternalCredential, seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import {
  listLibraryRecords,
  getLibraryRecordById,
  buildLibraryListQuery,
} from '../../src/lib/prisma/repositories/library-record.repository';
import { toNativeCredentialRecord, toCredentialRecordDetail } from '../../src/lib/library/credential-record-projection';
import type { CredentialLifecycle } from '../../src/lib/library/credential-record-projection';
const client = createRigClient();
beforeAll(() => client.$connect());
beforeEach(async () => {
  await truncateApplicationTables(client);
  await seedSystemTenant(client);
  await client.tenant.create({ data: { id: 'foreign', name: 'Foreign tenant' } });
});
afterAll(async () => {
  await client.$disconnect();
  await prisma.$disconnect();
});
async function native(
  id: string,
  capture: 'CAPTURED' | 'PENDING' | 'FAILED',
  entries: Array<[string, boolean | null]>,
  tenantId = SYSTEM_TENANT_ID,
) {
  await insertNativeCredential(client, { id, tenantId });
  await client.credential.update({
    where: { id },
    data: { statusCapture: capture, vcServiceInstanceId: 'attributed' },
  });
  for (const [purpose, value] of entries)
    await client.credentialStatusEntry.create({
      data: {
        id: `${id}-${purpose}`,
        credentialId: id,
        tenantId,
        type: 'BitstringStatusListEntry',
        statusPurpose: purpose,
        statusListCredential: 'https://issuer.example/status/1',
        statusListIndex: '1',
        statusListVcIssuer: 'did:web:issuer.example',
        descriptor: {},
        provenance: 'BACKFILL',
        value,
        observedAt: value === null ? null : new Date('2026-09-17T01:00:00Z'),
      },
    });
}
it('filters lifecycle before counts and pagination with independent expected records', async () => {
  await native('both', 'CAPTURED', [
    ['suspension', true],
    ['revocation', true],
  ]);
  await native('revoked', 'CAPTURED', [['revocation', true]]);
  await native('suspended', 'CAPTURED', [
    ['suspension', true],
    ['revocation', false],
  ]);
  await native('clear', 'CAPTURED', [['revocation', false]]);
  await native('message', 'CAPTURED', [['message', true]]);
  await native('none', 'CAPTURED', []);
  await native('unobserved', 'CAPTURED', [['revocation', null]]);
  await native('partial', 'CAPTURED', [
    ['revocation', null],
    ['suspension', false],
  ]);
  await native('pending-capture', 'PENDING', []);
  await native('failed-capture', 'FAILED', []);
  await native('foreign-revoked', 'CAPTURED', [['revocation', true]], 'foreign');
  const externalId = await insertExternalCredential(client, SYSTEM_TENANT_ID);
  const expected: Record<CredentialLifecycle, string[]> = {
    revoked: ['both', 'revoked'],
    suspended: ['suspended'],
    none: ['clear', 'message', 'none', 'partial'],
    unknown: ['failed-capture', 'pending-capture', 'unobserved'],
  };
  for (const [lifecycle, ids] of Object.entries(expected)) {
    const result = await listLibraryRecords({
      tenantId: SYSTEM_TENANT_ID,
      lifecycle: lifecycle as CredentialLifecycle,
      limit: 100,
    });
    expect(result.total).toBe(ids.length);
    expect(result.data.map((view) => view.record.id).sort()).toEqual(ids);
    const page = await listLibraryRecords({
      tenantId: SYSTEM_TENANT_ID,
      lifecycle: lifecycle as CredentialLifecycle,
      limit: 1,
      offset: 1,
    });
    expect(page.total).toBe(ids.length);
    expect(page.data).toHaveLength(ids.length > 1 ? 1 : 0);
  }
  const external = await getLibraryRecordById(externalId, SYSTEM_TENANT_ID);
  expect(external).not.toBeNull();
  expect(toCredentialRecordDetail(external!, { reveal: () => 'unused' })).toMatchObject({
    lifecycle: null,
    status: null,
    capabilities: { statusManageable: false },
  });
  const both = await getLibraryRecordById('both', SYSTEM_TENANT_ID);
  expect(both?.origin).toBe('NATIVE');
  if (both?.origin !== 'NATIVE') throw new Error('Expected native fixture');
  expect(toNativeCredentialRecord(both)).toMatchObject({
    lifecycle: 'revoked',
    status: { entries: [{ statusPurpose: 'revocation' }, { statusPurpose: 'suspension' }] },
  });
});
it('combines verification and lifecycle independently while retaining pending warnings', async () => {
  await native('failed-revoked', 'CAPTURED', [['revocation', true]]);
  await client.checkRun.create({
    data: {
      recordId: 'failed-revoked',
      tenantId: SYSTEM_TENANT_ID,
      generation: 2,
      state: 'FAILED',
      completedAt: new Date(),
      failureCode: 'VERIFICATION_UNAVAILABLE',
      failureMessage: 'Provider unavailable',
      failureRetryable: true,
    },
  });
  const failed = await listLibraryRecords({ tenantId: SYSTEM_TENANT_ID, status: 'failed', lifecycle: 'revoked' });
  expect(failed.total).toBe(1);
  expect(failed.data.map((view) => view.record.id)).toEqual(['failed-revoked']);
  await native('verified-pending-revoke', 'CAPTURED', [['revocation', false]]);
  await client.credentialStatusEntry.update({
    where: { id: 'verified-pending-revoke-revocation' },
    data: {
      pendingToken: 'pending',
      pendingValue: true,
      pendingSince: new Date(),
      pendingDeadline: new Date(Date.now() + 30000),
      pendingInstanceId: 'attributed',
      pendingConfigDigest: 'digest',
    },
  });
  const verified = await listLibraryRecords({ tenantId: SYSTEM_TENANT_ID, status: 'verified', lifecycle: 'none' });
  expect(verified.total).toBe(1);
  expect(verified.data[0].record.id).toBe('verified-pending-revoke');
  const detail = toCredentialRecordDetail(verified.data[0], { reveal: () => 'unused' });
  expect(detail).toMatchObject({
    lifecycle: 'none',
    verification: { summary: 'verified' },
    warnings: [{ code: 'STATUS_CHANGE_UNCONFIRMED' }],
  });
});
it('list and detail keep failed status verification after suspension is confirmed clear', async () => {
  await native('cleared-suspension', 'CAPTURED', [['suspension', true]]);
  const generation = await client.checkRun.create({
    data: {
      recordId: 'cleared-suspension',
      tenantId: SYSTEM_TENANT_ID,
      generation: 2,
      state: 'COMPLETE',
      proof: 'PASS',
      status: 'FAIL',
      completedAt: new Date('2026-09-16T12:00:00Z'),
    },
  });
  await client.credentialStatusEntry.update({
    where: { id: 'cleared-suspension-suspension' },
    data: { value: false, observedAt: new Date('2026-09-17T02:00:00Z'), version: 2 },
  });
  const page = await listLibraryRecords({
    tenantId: SYSTEM_TENANT_ID,
    status: 'not_conformant',
    lifecycle: 'none',
  });
  expect(page.total).toBe(1);
  expect(page.data.map((view) => view.record.id)).toEqual(['cleared-suspension']);
  const detail = await getLibraryRecordById('cleared-suspension', SYSTEM_TENANT_ID);
  if (page.data[0].origin !== 'NATIVE' || detail === null) throw new Error('Expected the native fixture');
  for (const record of [
    toNativeCredentialRecord(page.data[0]),
    toCredentialRecordDetail(detail, { reveal: () => 'unused' }),
  ]) {
    expect(record).toMatchObject({
      lifecycle: 'none',
      verification: { generation: 2, summary: 'not_conformant', checks: { status: 'fail' } },
      warnings: [
        {
          code: 'ISSUER_STATUS_OBSERVATIONS_DIFFER',
          generation: 2,
          verificationSettledAt: '2026-09-16T12:00:00.000Z',
          issuerObservedAt: '2026-09-17T02:00:00.000Z',
        },
      ],
    });
  }
  expect(await client.checkRun.findUniqueOrThrow({ where: { id: generation.id } })).toEqual(generation);
});
it('correlates status-entry existence to the parent tenant as well as its id', async () => {
  // The production composite foreign key prevents this mismatch. A CTE models it to test the SQL correlation itself.
  const query = buildLibraryListQuery({ tenantId: SYSTEM_TENANT_ID, lifecycle: 'revoked' });
  const text = query.text.replace(
    'WITH filtered AS (',
    `WITH "CredentialStatusEntry" AS (SELECT 'target'::text AS "credentialId", 'foreign'::text AS "tenantId", 'revocation'::text AS "statusPurpose", true AS "value"), filtered AS (`,
  );
  await native('target', 'CAPTURED', []);
  const rows = await client.$queryRawUnsafe<Array<{ total: bigint }>>(text, ...query.values);
  expect(Number(rows[0].total)).toBe(0);
  expect(query.values).toContain(SYSTEM_TENANT_ID);
});
