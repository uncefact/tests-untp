import { createRigClient, truncateApplicationTables } from './rig/db';
import { seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import { CredentialDetailsStatus } from '../../src/lib/prisma/generated/index.js';
import { createCredential } from '../../src/lib/prisma/repositories/credential.repository';

/**
 * Postgres round-trip for credential descriptive fields (#952).
 *
 * Unit tests cover extraction and the create payload. This suite is the
 * layer that can fail if the migration default is not EXTRACTION_PENDING, or
 * if createCredential does not persist the captured columns.
 */
describe('credential descriptive fields', () => {
  const prisma = createRigClient();

  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await seedSystemTenant(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reads EXTRACTION_PENDING for a row inserted without captured fields', async () => {
    const created = await prisma.credential.create({
      data: {
        tenantId: SYSTEM_TENANT_ID,
        storageUri: 'https://storage.test/legacy',
        digestMultibase: 'zLegacy',
        credentialType: 'DigitalProductPassport',
      },
    });

    const row = await prisma.credential.findUnique({ where: { id: created.id } });

    expect(row).not.toBeNull();
    expect(row?.detailsStatus).toBe(CredentialDetailsStatus.EXTRACTION_PENDING);
    expect(row?.name).toBeNull();
    expect(row?.issuerName).toBeNull();
    expect(row?.issuerDid).toBeNull();
    expect(row?.subjectName).toBeNull();
    expect(row?.subjectId).toBeNull();
    expect(row?.validFrom).toBeNull();
    expect(row?.validUntil).toBeNull();
  });

  it('reads captured fields and EXTRACTED for a row written through createCredential', async () => {
    const captured = {
      name: 'Wool Passport',
      issuerName: 'Example Issuer',
      issuerDid: 'did:web:issuer.example',
      subjectName: 'Merino batch',
      subjectId: 'https://example.com/product/1',
      validFrom: new Date('2024-01-15T00:00:00.000Z'),
      validUntil: new Date('2025-01-15T00:00:00.000Z'),
    };

    const { credential } = await createCredential({
      tenantId: SYSTEM_TENANT_ID,
      storageUri: 'https://storage.test/captured',
      digestMultibase: 'zCaptured',
      credentialType: 'DigitalProductPassport',
      details: captured,
      detailsStatus: CredentialDetailsStatus.EXTRACTED,
    });

    const row = await prisma.credential.findUnique({ where: { id: credential.id } });

    expect(row).not.toBeNull();
    expect(row?.name).toBe(captured.name);
    expect(row?.issuerName).toBe(captured.issuerName);
    expect(row?.issuerDid).toBe(captured.issuerDid);
    expect(row?.subjectName).toBe(captured.subjectName);
    expect(row?.subjectId).toBe(captured.subjectId);
    expect(row?.validFrom).toEqual(captured.validFrom);
    expect(row?.validUntil).toEqual(captured.validUntil);
    expect(row?.detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
  });
});
