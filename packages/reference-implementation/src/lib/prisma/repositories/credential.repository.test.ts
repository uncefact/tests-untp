import { createCredential, listCredentials, updateCredentialPublished } from './credential.repository';
import { NotFoundError } from '@/lib/api/errors';
import { prismaError } from '../db-errors.fixtures';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

// Mock Prisma client. Use jest.fn() inside the factory to avoid hoisting issues.
jest.mock('../prisma', () => ({
  prisma: {
    credential: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockCredential = prisma.credential as unknown as {
  create: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
};

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
        }),
      ).rejects.toBe(other);
      expect(mockCredential.create).toHaveBeenCalledTimes(1);
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
