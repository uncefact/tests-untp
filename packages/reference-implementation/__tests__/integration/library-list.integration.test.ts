import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsStatus,
  LibraryRecordOrigin,
  ProductLevel,
} from '../../src/lib/prisma/generated';
import {
  credentialRecordSchema,
  toCredentialRecord,
  toNativeCredentialRecord,
} from '../../src/lib/library/credential-record-projection';
import {
  buildLibraryListQuery,
  listLibraryRecords,
  type ListLibraryRecordsOptions,
} from '../../src/lib/prisma/repositories/library-record.repository';
import { noChecksRun } from '../../src/lib/prisma/repositories/check-run.repository';
import { insertExternalCredential, insertNativeCredential } from './fixtures';
import { createRigClient, truncateApplicationTables } from './rig/db';

const OWNER_TENANT_ID = 'library-list-owner';
const OTHER_TENANT_ID = 'library-list-other';
const prisma = createRigClient();

async function appendFailedRun(recordId: string, generation: number): Promise<void> {
  await prisma.checkRun.create({
    data: {
      recordId,
      tenantId: OWNER_TENANT_ID,
      generation,
      state: CheckRunState.FAILED,
      ...noChecksRun(),
      retrieval: CheckResult.FAIL,
      failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
      failureMessage: 'The source could not be retrieved.',
      failureRetryable: true,
      completedAt: new Date('2026-08-02T00:00:00.000Z'),
    },
  });
}

async function summaries(options: Omit<ListLibraryRecordsOptions, 'tenantId'> = {}) {
  const result = await listLibraryRecords({ tenantId: OWNER_TENANT_ID, limit: 100, ...options });
  return {
    total: result.total,
    ids: result.data.map((view) => view.record.id),
    projected: result.data.map((view) =>
      view.origin === LibraryRecordOrigin.NATIVE ? toNativeCredentialRecord(view) : toCredentialRecord(view),
    ),
  };
}

async function idsWithSydneySession(options: Omit<ListLibraryRecordsOptions, 'tenantId'> = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Australia/Sydney'");
    const rows = await tx.$queryRaw<Array<{ id: string | null; total: bigint | number }>>(
      buildLibraryListQuery({ tenantId: OWNER_TENANT_ID, limit: 100, ...options }),
    );
    return {
      ids: rows.flatMap((row) => (row.id === null ? [] : [row.id])),
      total: Number(rows[0]?.total ?? 0),
    };
  });
}

beforeEach(async () => {
  await truncateApplicationTables(prisma);
  await prisma.tenant.create({ data: { id: OWNER_TENANT_ID, name: 'Library list owner' } });
  await prisma.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Library list other' } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /library repository query against migrated Postgres', () => {
  it('combines native and external records, keeps the total on a beyond-end page, and excludes another tenant', async () => {
    await insertNativeCredential(prisma, {
      id: 'library-list-native',
      tenantId: OWNER_TENANT_ID,
      coreCredentialType: CoreCredentialType.DPP,
      details: {
        name: 'Native credential',
        issuerName: 'Owner issuer',
        issuerDid: 'did:web:owner.example',
        validFrom: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
    const receivedId = await insertExternalCredential(prisma, OWNER_TENANT_ID);
    await insertNativeCredential(prisma, { id: 'library-list-foreign', tenantId: OTHER_TENANT_ID });

    const page = await summaries({ sort: 'createdAt:asc' });
    expect(page.total).toBe(2);
    expect(page.ids).toEqual(['library-list-native', receivedId]);
    expect(page.projected).toHaveLength(2);
    for (const row of page.projected) {
      expect(credentialRecordSchema.safeParse(row).success).toBe(true);
      expect(row).not.toHaveProperty('decryptionKey');
      expect(row).not.toHaveProperty('storageUri');
      expect(row).not.toHaveProperty('digestMultibase');
      expect(row).not.toHaveProperty('tenantId');
    }

    expect((await summaries({ origin: 'native' })).ids).toEqual(['library-list-native']);
    expect((await summaries({ origin: 'external' })).ids).toEqual([receivedId]);

    await expect(summaries({ offset: 2 })).resolves.toMatchObject({ total: 2, ids: [], projected: [] });
    await expect(summaries({ offset: 3 })).resolves.toMatchObject({ total: 2, ids: [], projected: [] });
  });

  it('applies type authority, issuer semantics, and excludes an unobserved encrypted value', async () => {
    const extractedDppDeclaredDcc = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      declaredCredentialType: CoreCredentialType.DCC,
      coreCredentialType: CoreCredentialType.DPP,
      issuerName: 'Acme Supplier',
      issuerDid: 'did:web:acme.example',
    });
    const pendingDeclaredDcc = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      declaredCredentialType: CoreCredentialType.DCC,
      coreCredentialType: null,
      detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
      encrypted: null,
    });
    const other = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      declaredCredentialType: CoreCredentialType.DFR,
      coreCredentialType: CoreCredentialType.DFR,
    });

    expect((await summaries({ type: [CoreCredentialType.DPP] })).ids).toEqual([extractedDppDeclaredDcc]);
    const repeatedTypePage = await summaries({ type: [CoreCredentialType.DPP, CoreCredentialType.DFR] });
    expect(repeatedTypePage.ids).toHaveLength(2);
    expect(repeatedTypePage.ids).toEqual(expect.arrayContaining([extractedDppDeclaredDcc, other]));
    expect((await summaries({ type: [CoreCredentialType.DIA] })).ids).toEqual([]);
    expect((await summaries({ type: [CoreCredentialType.DCC] })).ids).toEqual([pendingDeclaredDcc]);
    expect((await summaries({ type: [CoreCredentialType.DFR] })).ids).toEqual([other]);
    expect((await summaries({ issuer: 'acme supplier' })).ids).toEqual([extractedDppDeclaredDcc]);
    expect((await summaries({ issuer: 'did:web:acme.example' })).ids).toEqual([extractedDppDeclaredDcc]);
    expect((await summaries({ issuer: 'acme' })).ids).toEqual([]);
    expect((await summaries({ encrypted: false })).ids).toEqual([extractedDppDeclaredDcc, other]);
    const encryptedExternal = await insertExternalCredential(prisma, OWNER_TENANT_ID, { encrypted: true });
    expect((await summaries({ encrypted: true })).ids).toEqual([encryptedExternal]);
  });

  it('mirrors all four public status summaries, including the native mask', async () => {
    const nativeId = 'library-list-native-status';
    await insertNativeCredential(prisma, { id: nativeId, tenantId: OWNER_TENANT_ID });
    const pendingId = await insertExternalCredential(prisma, OWNER_TENANT_ID, { run: 'pending' });
    const verifiedId = await insertExternalCredential(prisma, OWNER_TENANT_ID, { run: 'complete' });
    const notConformantId = await insertExternalCredential(prisma, OWNER_TENANT_ID, { run: 'notConformant' });
    const nothingRanId = await insertExternalCredential(prisma, OWNER_TENANT_ID, { run: 'nothingRan' });
    const failedId = await insertExternalCredential(prisma, OWNER_TENANT_ID, { run: 'failed' });
    const severalGenerationsId = await insertExternalCredential(prisma, OWNER_TENANT_ID, { run: 'complete' });
    await appendFailedRun(severalGenerationsId, 2);

    const all = await summaries();
    const statusCounts = await Promise.all(
      (['pending', 'verified', 'not_conformant', 'failed'] as const).map(async (status) => {
        const page = await summaries({ status });
        expect(page.projected.length).toBeGreaterThan(0);
        expect(page.projected.every((row) => row.verification.summary === status)).toBe(true);
        return page.total;
      }),
    );
    expect((await summaries({ status: 'verified' })).ids).toEqual(expect.arrayContaining([nativeId, verifiedId]));
    expect((await summaries({ status: 'pending' })).ids).toEqual([pendingId]);
    const notConformantPage = await summaries({ status: 'not_conformant' });
    expect(notConformantPage.ids).toEqual(expect.arrayContaining([notConformantId, nothingRanId]));
    const failedPage = await summaries({ status: 'failed' });
    expect(failedPage.ids).toEqual(expect.arrayContaining([failedId, severalGenerationsId]));
    const newestFailed = failedPage.projected.find((row) => row.id === severalGenerationsId);
    expect(newestFailed).toEqual(
      expect.objectContaining({
        verification: expect.objectContaining({ generation: 2, state: 'failed', summary: 'failed' }),
      }),
    );
    expect((await summaries({ status: 'verified' })).ids).not.toContain(severalGenerationsId);
    expect(statusCounts.reduce((sum, count) => sum + count, 0)).toBe(all.total);
  });

  it('applies the native status mask to executed native checks', async () => {
    const maskedFailure = 'library-list-native-masked-failure';
    await insertNativeCredential(prisma, {
      id: maskedFailure,
      tenantId: OWNER_TENANT_ID,
      checkRun: { retrieval: CheckResult.PASS },
    });
    const verified = 'library-list-native-executed';
    await insertNativeCredential(prisma, {
      id: verified,
      tenantId: OWNER_TENANT_ID,
      checkRun: { retrieval: CheckResult.PASS, proof: CheckResult.PASS, status: CheckResult.PASS },
    });

    expect((await summaries({ status: 'not_conformant' })).ids).toEqual([maskedFailure]);
    expect((await summaries({ status: 'verified' })).ids).toEqual([verified]);
  });

  it('filters native associations exactly, requires all association filters, and excludes external rows', async () => {
    await prisma.organisationEntity.create({
      data: { id: 'organisation-a', tenantId: OWNER_TENANT_ID, name: 'Organisation A' },
    });
    await prisma.facility.create({
      data: {
        id: 'facility-a',
        tenantId: OWNER_TENANT_ID,
        name: 'Facility A',
        operatingOrganisationId: 'organisation-a',
      },
    });
    await prisma.product.create({
      data: { id: 'product-a', tenantId: OWNER_TENANT_ID, name: 'Product A', level: ProductLevel.MODEL },
    });
    const all = await insertNativeCredential(prisma, {
      id: 'library-list-association-all',
      tenantId: OWNER_TENANT_ID,
      organisationId: 'organisation-a',
      facilityId: 'facility-a',
      productId: 'product-a',
    });
    const organisationOnly = await insertNativeCredential(prisma, {
      id: 'library-list-association-organisation',
      tenantId: OWNER_TENANT_ID,
      organisationId: 'organisation-a',
    });
    const facilityOnly = await insertNativeCredential(prisma, {
      id: 'library-list-association-facility',
      tenantId: OWNER_TENANT_ID,
      facilityId: 'facility-a',
    });
    const productOnly = await insertNativeCredential(prisma, {
      id: 'library-list-association-product',
      tenantId: OWNER_TENANT_ID,
      productId: 'product-a',
    });
    const externalId = await insertExternalCredential(prisma, OWNER_TENANT_ID);

    const organisationPage = await summaries({ organisationId: 'organisation-a' });
    expect(organisationPage.ids).toHaveLength(2);
    expect(organisationPage.ids).toEqual(expect.arrayContaining([all.id, organisationOnly.id]));
    const facilityPage = await summaries({ facilityId: 'facility-a' });
    expect(facilityPage.ids).toHaveLength(2);
    expect(facilityPage.ids).toEqual(expect.arrayContaining([all.id, facilityOnly.id]));
    const productPage = await summaries({ productId: 'product-a' });
    expect(productPage.ids).toHaveLength(2);
    expect(productPage.ids).toEqual(expect.arrayContaining([all.id, productOnly.id]));
    expect((await summaries({ organisationId: 'unknown' })).total).toBe(0);
    expect((await summaries({ facilityId: 'unknown' })).total).toBe(0);
    expect((await summaries({ productId: 'unknown' })).total).toBe(0);
    expect((await summaries({ organisationId: 'organisation-a', facilityId: 'facility-a' })).ids).toEqual([all.id]);
    expect((await summaries({ organisationId: 'organisation-a' })).ids).not.toContain(externalId);
  });

  it('filters native durable-copy encryption state', async () => {
    const keyed = await insertNativeCredential(prisma, {
      id: 'library-list-native-keyed',
      tenantId: OWNER_TENANT_ID,
      decryptionKey: 'a'.repeat(64),
    });
    const keyless = await insertNativeCredential(prisma, {
      id: 'library-list-native-keyless',
      tenantId: OWNER_TENANT_ID,
    });

    expect((await summaries({ encrypted: true })).ids).toEqual([keyed.id]);
    expect((await summaries({ encrypted: false })).ids).toEqual([keyless.id]);
  });

  it('uses the effective date for inclusive UTC bounds and a deterministic id tie-break', async () => {
    await insertNativeCredential(prisma, {
      id: 'library-list-date-fallback',
      tenantId: OWNER_TENANT_ID,
      details: { validFrom: null },
    });
    await prisma.libraryRecord.update({
      where: { id_tenantId: { id: 'library-list-date-fallback', tenantId: OWNER_TENANT_ID } },
      data: { createdAt: new Date('2026-05-15T12:00:00.000Z') },
    });
    const first = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      validFrom: new Date('2026-05-15T12:00:00.000Z'),
    });
    const second = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      validFrom: new Date('2026-05-15T12:00:00.000Z'),
    });

    const page = await summaries({
      issuedFrom: new Date('2026-05-15T00:00:00.000Z'),
      issuedTo: new Date('2026-05-15T23:59:59.999Z'),
      sort: 'issuedAt:asc',
    });
    expect(page.ids).toEqual(expect.arrayContaining([first, second, 'library-list-date-fallback']));
    expect(page.ids.indexOf(first)).toBeLessThan(page.ids.indexOf(second));
  });

  it('sorts three distinct effective issued dates in ascending order', async () => {
    const early = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      validFrom: new Date('2026-05-11T00:00:00.000Z'),
    });
    const middle = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      validFrom: new Date('2026-05-12T00:00:00.000Z'),
    });
    const late = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      validFrom: new Date('2026-05-13T00:00:00.000Z'),
    });

    expect((await summaries({ sort: 'issuedAt:asc' })).ids).toEqual([early, middle, late]);
  });

  it('keeps UTC date bounds stable in a non-UTC database session', async () => {
    const start = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      validFrom: new Date('2026-05-15T00:00:00.000Z'),
    });
    const end = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      validFrom: new Date('2026-05-15T23:59:59.999Z'),
    });
    const included = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      validFrom: new Date('2026-05-15T23:30:00.000Z'),
    });
    const before = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      validFrom: new Date('2026-05-14T23:59:59.999Z'),
    });
    const excluded = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      validFrom: new Date('2026-05-16T00:30:00.000Z'),
    });

    const page = await idsWithSydneySession({
      issuedFrom: new Date('2026-05-15T00:00:00.000Z'),
      issuedTo: new Date('2026-05-15T23:59:59.999Z'),
    });
    expect(page.ids).toHaveLength(3);
    expect(page.ids).toEqual(expect.arrayContaining([start, end, included]));
    expect(page.ids).not.toContain(before);
    expect(page.ids).not.toContain(excluded);
  });

  it('returns descending partial pages and preserves the total beyond the end', async () => {
    const ids = await Promise.all(
      ['library-list-page-a', 'library-list-page-b', 'library-list-page-c'].map((id, index) =>
        insertNativeCredential(prisma, {
          id,
          tenantId: OWNER_TENANT_ID,
          details: { validFrom: new Date(`2026-05-1${index + 1}T00:00:00.000Z`) },
        }).then((record) => record.id),
      ),
    );
    const expected = [...ids].reverse();
    await expect(summaries({ sort: 'issuedAt:desc', limit: 2 })).resolves.toMatchObject({
      total: 3,
      ids: expected.slice(0, 2),
    });
    await expect(summaries({ sort: 'issuedAt:desc', limit: 2, offset: 2 })).resolves.toMatchObject({
      total: 3,
      ids: expected.slice(2),
    });
  });

  it('uses the id as the exact page-boundary tie-breaker', async () => {
    for (const id of ['library-list-tie-a', 'library-list-tie-b', 'library-list-tie-c']) {
      await insertNativeCredential(prisma, {
        id,
        tenantId: OWNER_TENANT_ID,
        details: { validFrom: new Date('2026-05-20T00:00:00.000Z') },
      });
    }
    const first = await summaries({ sort: 'issuedAt:asc', limit: 2 });
    const second = await summaries({ sort: 'issuedAt:asc', limit: 2, offset: 2 });
    expect(first.ids).toEqual(['library-list-tie-a', 'library-list-tie-b']);
    expect(second.ids).toEqual(['library-list-tie-c']);
  });

  it('sorts by createdAt in both directions', async () => {
    for (const [id, createdAt] of [
      ['library-list-created-a', '2026-05-21T00:00:00.000Z'],
      ['library-list-created-b', '2026-05-23T00:00:00.000Z'],
      ['library-list-created-c', '2026-05-22T00:00:00.000Z'],
    ] as const) {
      await insertNativeCredential(prisma, { id, tenantId: OWNER_TENANT_ID, details: { validFrom: null } });
      await prisma.libraryRecord.update({
        where: { id_tenantId: { id, tenantId: OWNER_TENANT_ID } },
        data: { createdAt: new Date(createdAt) },
      });
    }
    expect((await summaries({ sort: 'createdAt:asc' })).ids).toEqual([
      'library-list-created-a',
      'library-list-created-c',
      'library-list-created-b',
    ]);
    expect((await summaries({ sort: 'createdAt:desc' })).ids).toEqual([
      'library-list-created-b',
      'library-list-created-c',
      'library-list-created-a',
    ]);
  });

  it('matches issuer names without folding DIDs and returns duplicate records', async () => {
    const issuerId = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      issuerName: 'Acme Supplier',
      issuerDid: 'did:web:Acme.example',
    });
    const duplicateId = await insertExternalCredential(prisma, OWNER_TENANT_ID, {
      duplicateOfRecordId: issuerId,
    });

    expect((await summaries({ issuer: 'ACME SUPPLIER' })).ids).toEqual([issuerId]);
    expect((await summaries({ issuer: 'did:web:acme.example' })).ids).toEqual([]);
    expect((await summaries()).ids).toEqual(expect.arrayContaining([issuerId, duplicateId]));
  });

  it('ANDs combined filters when different rows satisfy different subsets', async () => {
    await prisma.organisationEntity.create({
      data: { id: 'organisation-combined', tenantId: OWNER_TENANT_ID, name: 'Combined organisation' },
    });
    await prisma.organisationEntity.create({
      data: { id: 'other-organisation', tenantId: OWNER_TENANT_ID, name: 'Other organisation' },
    });
    const match = await insertNativeCredential(prisma, {
      id: 'library-list-combined-match',
      tenantId: OWNER_TENANT_ID,
      coreCredentialType: CoreCredentialType.DPP,
      organisationId: 'organisation-combined',
      details: { issuerName: 'Combined Issuer' },
    });
    await insertNativeCredential(prisma, {
      id: 'library-list-combined-type-only',
      tenantId: OWNER_TENANT_ID,
      coreCredentialType: CoreCredentialType.DPP,
      organisationId: 'other-organisation',
      details: { issuerName: 'Combined Issuer' },
    });
    await insertNativeCredential(prisma, {
      id: 'library-list-combined-association-only',
      tenantId: OWNER_TENANT_ID,
      coreCredentialType: CoreCredentialType.DFR,
      organisationId: 'organisation-combined',
      details: { issuerName: 'Other Issuer' },
    });

    expect(
      (
        await summaries({
          type: [CoreCredentialType.DPP],
          organisationId: 'organisation-combined',
          issuer: 'combined issuer',
        })
      ).ids,
    ).toEqual([match.id]);
  });
});
