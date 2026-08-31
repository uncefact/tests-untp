import { createCredential, listCredentials, updateCredentialPublished } from './credential.repository';
import { IdempotencyClaimLostError } from './idempotency-key.repository';
import { NotFoundError } from '@/lib/api/errors';
import { prismaError } from '../db-errors.fixtures';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

// Mock Prisma client. Use jest.fn() inside the factory to avoid hoisting issues.
jest.mock('../prisma', () => {
  const prismaMock: {
    credential: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    idempotencyKey: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  } = {
    credential: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    idempotencyKey: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prismaMock.$transaction.mockImplementation((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockCredential = prisma.credential as unknown as {
  create: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
};

const mockIdempotencyKey = prisma.idempotencyKey as unknown as {
  updateMany: jest.Mock;
};

const mockTransaction = prisma.$transaction as unknown as jest.Mock;

describe('credential.repository', () => {
  const TENANT_ID = 'tenant-1';

  // More than DEFAULT_PAGE_LIMIT so an unbounded query is distinguishable
  // from a correctly-paged one.
  const SEED_CREDENTIALS = Array.from({ length: DEFAULT_PAGE_LIMIT + 5 }, (_, i) => ({
    id: `credential-${i}`,
    tenantId: TENANT_ID,
    storageUri: `https://storage.example/credential-${i}`,
    digestMultibase: `z${i}`,
    decryptionKey: null,
    credentialType: 'DigitalConformityCredential',
    coreDataModelVersion: '0.6.1',
    isPublished: false,
    organisationId: null,
    facilityId: null,
    productId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  }));

  beforeEach(() => {
    jest.clearAllMocks();
    // Mirrors Prisma's own take/skip semantics (an undefined take is
    // unbounded), so this catches the repository omitting the default
    // rather than merely asserting the call shape.
    mockCredential.findMany.mockImplementation(({ take, skip }: { take?: number; skip?: number } = {}) => {
      const start = skip ?? 0;
      const end = take !== undefined ? start + take : undefined;
      return Promise.resolve(SEED_CREDENTIALS.slice(start, end));
    });
    mockCredential.count.mockResolvedValue(SEED_CREDENTIALS.length);
  });

  describe('listCredentials', () => {
    it('bounds the result to DEFAULT_PAGE_LIMIT when limit is omitted', async () => {
      const result = await listCredentials({ tenantId: TENANT_ID });

      expect(mockCredential.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: DEFAULT_PAGE_LIMIT }));
      expect(result.data).toHaveLength(DEFAULT_PAGE_LIMIT);
    });

    it('still pages as requested when a limit is supplied', async () => {
      const result = await listCredentials({ tenantId: TENANT_ID, limit: 5, offset: 10 });

      expect(mockCredential.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5, skip: 10 }));
      expect(result.data).toHaveLength(5);
    });
  });

  describe('createCredential', () => {
    it.each(['organisationId', 'facilityId', 'productId'])(
      'retries without entity links when %s vanished, so a stored credential is never lost',
      async (column) => {
        // ADR-044: the credential is already signed and stored externally by
        // this point, so an entity that disappeared mid-request must not fail
        // the write. The retry drops only the links and says so.
        const created = { ...SEED_CREDENTIALS[0], organisationId: null, facilityId: null, productId: null };
        mockCredential.create
          .mockRejectedValueOnce(prismaError('P2003', `Foreign key constraint failed on the field: \`${column}\``))
          .mockResolvedValueOnce(created);

        const result = await createCredential({
          tenantId: TENANT_ID,
          storageUri: 'https://storage.example/credential-new',
          digestMultibase: 'zNew',
          credentialType: 'DigitalProductPassport',
          coreDataModelVersion: '0.6.1',
          organisationId: 'org-1',
          facilityId: 'fac-1',
          productId: 'prod-1',
        });

        expect(result).toEqual({ credential: created, entityLinkFailed: true });
        expect(mockCredential.create).toHaveBeenCalledTimes(2);
        const retryData = mockCredential.create.mock.calls[1][0].data;
        expect(retryData).not.toHaveProperty('organisationId');
        expect(retryData).not.toHaveProperty('facilityId');
        expect(retryData).not.toHaveProperty('productId');
      },
    );

    it('rethrows a foreign-key violation on a column that is not an entity link', async () => {
      // Only the optional enrichment columns are retried; a tenant that
      // vanished is a real failure and stays fatal under ADR-036.
      const fkError = prismaError('P2003', 'Foreign key constraint failed on the field: `tenantId`');
      mockCredential.create.mockRejectedValue(fkError);

      await expect(
        createCredential({
          tenantId: TENANT_ID,
          storageUri: 'https://storage.example/credential-new',
          digestMultibase: 'zNew',
          credentialType: 'DigitalProductPassport',
          coreDataModelVersion: '0.6.1',
          organisationId: 'org-1',
        }),
      ).rejects.toBe(fkError);
      expect(mockCredential.create).toHaveBeenCalledTimes(1);
    });

    it('rethrows an unrelated database failure without retrying', async () => {
      const other = prismaError('P2002', 'Unique constraint failed');
      mockCredential.create.mockRejectedValue(other);

      await expect(
        createCredential({
          tenantId: TENANT_ID,
          storageUri: 'https://storage.example/credential-new',
          digestMultibase: 'zNew',
          credentialType: 'DigitalProductPassport',
          coreDataModelVersion: '0.6.1',
        }),
      ).rejects.toBe(other);
      expect(mockCredential.create).toHaveBeenCalledTimes(1);
    });

    it('writes the resolved data model version on the first create', async () => {
      mockCredential.create.mockResolvedValue({ ...SEED_CREDENTIALS[0], coreDataModelVersion: '0.6.1' });

      await createCredential({
        tenantId: TENANT_ID,
        storageUri: 'https://storage.example/credential-new',
        digestMultibase: 'zNew',
        credentialType: 'DigitalProductPassport',
        coreDataModelVersion: '0.6.1',
      });

      expect(mockCredential.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ coreDataModelVersion: '0.6.1' }),
      );
    });

    it('writes captured descriptive fields on the first create', async () => {
      const details = {
        name: 'Wool Passport',
        issuerName: 'Example Issuer',
        issuerDid: 'did:web:issuer.example',
        subjectName: 'Merino batch',
        subjectId: 'https://example.com/product/1',
        validFrom: new Date('2024-01-15T00:00:00.000Z'),
        validUntil: new Date('2025-01-15T00:00:00.000Z'),
      };
      // What the row must carry: the bundle flattened onto its columns.
      const captured = { ...details, detailsStatus: 'EXTRACTED' as const };
      mockCredential.create.mockResolvedValue({ ...SEED_CREDENTIALS[0], ...captured });

      await createCredential({
        tenantId: TENANT_ID,
        storageUri: 'https://storage.example/credential-new',
        digestMultibase: 'zNew',
        credentialType: 'DigitalProductPassport',
        coreDataModelVersion: '0.6.1',
        organisationId: 'org-1',
        details,
        detailsStatus: 'EXTRACTED',
      });

      expect(mockCredential.create).toHaveBeenCalledTimes(1);
      expect(mockCredential.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          ...captured,
          organisationId: 'org-1',
        }),
      );
    });

    it('writes the failure reason when the details could not be read', async () => {
      mockCredential.create.mockResolvedValue(SEED_CREDENTIALS[0]);

      await createCredential({
        tenantId: TENANT_ID,
        storageUri: 'https://storage.example/credential-new',
        digestMultibase: 'zNew',
        credentialType: 'DigitalProductPassport',
        coreDataModelVersion: '0.6.1',
        detailsStatus: 'EXTRACTION_FAILED',
        detailsError: 'UNREADABLE_ENVELOPE',
      });

      expect(mockCredential.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ detailsStatus: 'EXTRACTION_FAILED', detailsError: 'UNREADABLE_ENVELOPE' }),
      );
    });

    it('keeps captured descriptive fields on the entity-link retry', async () => {
      const details = {
        name: 'Wool Passport',
        issuerName: 'Example Issuer',
        issuerDid: 'did:web:issuer.example',
        subjectName: 'Merino batch',
        subjectId: 'https://example.com/product/1',
        validFrom: new Date('2024-01-15T00:00:00.000Z'),
        validUntil: new Date('2025-01-15T00:00:00.000Z'),
      };
      // What the row must carry: the bundle flattened onto its columns.
      const captured = { ...details, detailsStatus: 'EXTRACTED' as const };
      mockCredential.create
        .mockRejectedValueOnce(prismaError('P2003', 'Foreign key constraint failed on the field: `organisationId`'))
        .mockResolvedValueOnce({ ...SEED_CREDENTIALS[0], ...captured });

      await createCredential({
        tenantId: TENANT_ID,
        storageUri: 'https://storage.example/credential-new',
        digestMultibase: 'zNew',
        credentialType: 'DigitalProductPassport',
        coreDataModelVersion: '0.6.1',
        organisationId: 'org-1',
        details,
        detailsStatus: 'EXTRACTED',
      });

      expect(mockCredential.create).toHaveBeenCalledTimes(2);
      expect(mockCredential.create.mock.calls[0][0].data).toEqual(expect.objectContaining(captured));
      expect(mockCredential.create.mock.calls[1][0].data).toEqual(expect.objectContaining(captured));
      expect(mockCredential.create.mock.calls[1][0].data).not.toHaveProperty('organisationId');
    });

    it('associates the idempotency claim in the same transaction as the credential row', async () => {
      const created = { ...SEED_CREDENTIALS[0], id: 'cred-new' };
      mockCredential.create.mockResolvedValue(created);
      mockIdempotencyKey.updateMany.mockResolvedValue({ count: 1 });

      const result = await createCredential({
        tenantId: TENANT_ID,
        storageUri: 'https://storage.example/credential-new',
        digestMultibase: 'zNew',
        credentialType: 'DigitalProductPassport',
        coreDataModelVersion: '0.6.1',
        idempotencyClaimId: 'claim-1',
      });

      expect(result).toEqual({ credential: created, entityLinkFailed: false });
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockIdempotencyKey.updateMany).toHaveBeenCalledWith({
        where: { id: 'claim-1', credentialId: null },
        data: { credentialId: 'cred-new', resultRecordedAt: expect.any(Date) },
      });
    });

    it('throws IdempotencyClaimLostError inside the transaction when the association matches zero rows', async () => {
      const created = { ...SEED_CREDENTIALS[0], id: 'cred-new' };
      mockCredential.create.mockResolvedValue(created);
      mockIdempotencyKey.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        createCredential({
          tenantId: TENANT_ID,
          storageUri: 'https://storage.example/credential-new',
          digestMultibase: 'zNew',
          credentialType: 'DigitalProductPassport',
          coreDataModelVersion: '0.6.1',
          idempotencyClaimId: 'claim-1',
        }),
      ).rejects.toBeInstanceOf(IdempotencyClaimLostError);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      await expect(mockTransaction.mock.calls[0][0](prisma)).rejects.toBeInstanceOf(IdempotencyClaimLostError);
    });

    it('keeps the idempotency association on the entity-link retry', async () => {
      const created = { ...SEED_CREDENTIALS[0], id: 'cred-new', organisationId: null };
      mockCredential.create
        .mockRejectedValueOnce(prismaError('P2003', 'Foreign key constraint failed on the field: `organisationId`'))
        .mockResolvedValueOnce(created);
      mockIdempotencyKey.updateMany.mockResolvedValue({ count: 1 });

      const result = await createCredential({
        tenantId: TENANT_ID,
        storageUri: 'https://storage.example/credential-new',
        digestMultibase: 'zNew',
        credentialType: 'DigitalProductPassport',
        coreDataModelVersion: '0.6.1',
        organisationId: 'org-1',
        idempotencyClaimId: 'claim-1',
      });

      expect(result).toEqual({ credential: created, entityLinkFailed: true });
      expect(mockTransaction).toHaveBeenCalledTimes(2);
      expect(mockIdempotencyKey.updateMany).toHaveBeenCalledWith({
        where: { id: 'claim-1', credentialId: null },
        data: { credentialId: 'cred-new', resultRecordedAt: expect.any(Date) },
      });
      expect(mockCredential.create.mock.calls[1][0].data).not.toHaveProperty('organisationId');
    });
  });

  describe('updateCredentialPublished', () => {
    it('updates the published flag scoped to the tenant', async () => {
      const updated = { ...SEED_CREDENTIALS[0], isPublished: true };
      mockCredential.update.mockResolvedValue(updated);

      const result = await updateCredentialPublished('credential-0', TENANT_ID, true);

      expect(mockCredential.update).toHaveBeenCalledWith({
        where: { id: 'credential-0', tenantId: TENANT_ID },
        data: { isPublished: true },
      });
      expect(result).toEqual(updated);
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      mockCredential.update.mockRejectedValue(prismaError('P2025'));

      const result = updateCredentialPublished('credential-0', TENANT_ID, true);

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Credential not found');
    });

    it('rethrows a non-database error unchanged', async () => {
      const connectionError = new Error('connection lost');
      mockCredential.update.mockRejectedValue(connectionError);

      await expect(updateCredentialPublished('credential-0', TENANT_ID, true)).rejects.toBe(connectionError);
    });
  });
});
