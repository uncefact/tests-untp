import {
  createOrganisations,
  getOrganisationById,
  listOrganisations,
  updateOrganisation,
  deleteOrganisation,
} from './organisation.repository';

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock('../prisma', () => ({
  prisma: {
    organisationEntity: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organisationSecondaryIdentifier: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    identifier: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockOrganisationEntity = prisma.organisationEntity as unknown as {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
};

const mockTransaction = prisma.$transaction as unknown as jest.Mock;

describe('organisation.repository', () => {
  const TENANT_ID = 'tenant-1';
  const OTHER_TENANT_ID = 'other-tenant';
  const SCHEME_RECORD = {
    id: 'scheme-1',
    tenantId: TENANT_ID,
    registrarId: 'reg-1',
    name: 'GTIN',
    primaryKey: 'gtin',
    validationPattern: '^\\d{13,14}$',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const IDENTIFIER_RECORD = {
    id: 'ident-1',
    tenantId: TENANT_ID,
    schemeId: 'scheme-1',
    value: '1234567890123',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    scheme: SCHEME_RECORD,
  };
  const IDENTIFIER_RECORD_2 = {
    id: 'ident-2',
    tenantId: TENANT_ID,
    schemeId: 'scheme-1',
    value: '9876543210123',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    scheme: SCHEME_RECORD,
  };
  const ORG_RECORD = {
    id: 'org-1',
    tenantId: TENANT_ID,
    name: 'Acme Corp',
    description: 'A test organisation',
    location: { address: { streetAddress: '123 Main St' } },
    primaryIdentifierId: 'ident-1',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    primaryIdentifier: IDENTIFIER_RECORD,
    secondaryIdentifiers: [],
  };
  const ORG_RECORD_2 = {
    id: 'org-2',
    tenantId: TENANT_ID,
    name: 'Beta Ltd',
    description: null,
    location: null,
    primaryIdentifierId: null,
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
    primaryIdentifier: null,
    secondaryIdentifiers: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrganisations', () => {
    it('creates a single organisation with primary and secondary identifiers', async () => {
      const mockTx = {
        identifier: { findFirst: jest.fn() },
        organisationEntity: {
          create: jest.fn(),
          findUniqueOrThrow: jest.fn(),
        },
        organisationSecondaryIdentifier: { createMany: jest.fn() },
      };

      // Primary identifier ownership check
      mockTx.identifier.findFirst
        .mockResolvedValueOnce(IDENTIFIER_RECORD) // primary
        .mockResolvedValueOnce(IDENTIFIER_RECORD_2); // secondary

      const createdOrg = { ...ORG_RECORD, secondaryIdentifiers: [] };
      mockTx.organisationEntity.create.mockResolvedValue(createdOrg);
      mockTx.organisationSecondaryIdentifier.createMany.mockResolvedValue({ count: 1 });

      const refetchedOrg = {
        ...ORG_RECORD,
        secondaryIdentifiers: [{ organisationId: 'org-1', identifierId: 'ident-2', identifier: IDENTIFIER_RECORD_2 }],
      };
      mockTx.organisationEntity.findUniqueOrThrow.mockResolvedValue(refetchedOrg);

      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      const result = await createOrganisations(TENANT_ID, [
        {
          name: 'Acme Corp',
          description: 'A test organisation',
          location: { address: { streetAddress: '123 Main St' } },
          primaryIdentifierId: 'ident-1',
          secondaryIdentifierIds: ['ident-2'],
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(refetchedOrg);
      expect(mockTx.identifier.findFirst).toHaveBeenCalledTimes(2);
      expect(mockTx.organisationEntity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          name: 'Acme Corp',
          description: 'A test organisation',
          primaryIdentifierId: 'ident-1',
        }),
        include: {
          primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: { include: { registrar: true } } } } } },
        },
      });
      expect(mockTx.organisationSecondaryIdentifier.createMany).toHaveBeenCalledWith({
        data: [{ organisationId: 'org-1', identifierId: 'ident-2' }],
      });
    });

    it('creates multiple organisations', async () => {
      const mockTx = {
        identifier: { findFirst: jest.fn() },
        organisationEntity: {
          create: jest.fn(),
          findUniqueOrThrow: jest.fn(),
        },
        organisationSecondaryIdentifier: { createMany: jest.fn() },
      };

      // No identifiers to validate
      mockTx.organisationEntity.create.mockResolvedValueOnce(ORG_RECORD).mockResolvedValueOnce(ORG_RECORD_2);

      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      const result = await createOrganisations(TENANT_ID, [{ name: 'Acme Corp' }, { name: 'Beta Ltd' }]);

      expect(result).toHaveLength(2);
      expect(mockTx.organisationEntity.create).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundError if primary identifier does not belong to tenant', async () => {
      const mockTx = {
        identifier: { findFirst: jest.fn() },
        organisationEntity: {
          create: jest.fn(),
          findUniqueOrThrow: jest.fn(),
        },
        organisationSecondaryIdentifier: { createMany: jest.fn() },
      };

      mockTx.identifier.findFirst.mockResolvedValue(null);
      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      await expect(
        createOrganisations(TENANT_ID, [{ name: 'Acme Corp', primaryIdentifierId: 'nonexistent' }]),
      ).rejects.toThrow('Identifier not found: nonexistent');
    });

    it('throws NotFoundError if secondary identifier does not belong to tenant', async () => {
      const mockTx = {
        identifier: { findFirst: jest.fn() },
        organisationEntity: {
          create: jest.fn(),
          findUniqueOrThrow: jest.fn(),
        },
        organisationSecondaryIdentifier: { createMany: jest.fn() },
      };

      // Primary passes but secondary fails
      mockTx.identifier.findFirst
        .mockResolvedValueOnce(IDENTIFIER_RECORD) // primary valid
        .mockResolvedValueOnce(null); // secondary invalid

      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      await expect(
        createOrganisations(TENANT_ID, [
          {
            name: 'Acme Corp',
            primaryIdentifierId: 'ident-1',
            secondaryIdentifierIds: ['nonexistent'],
          },
        ]),
      ).rejects.toThrow('Identifier not found: nonexistent');
    });

    it('throws ValidationError when primary identifier is also a secondary identifier', async () => {
      const mockTx = {
        identifier: { findFirst: jest.fn() },
        organisationEntity: {
          create: jest.fn(),
          findUniqueOrThrow: jest.fn(),
        },
        organisationSecondaryIdentifier: { createMany: jest.fn() },
      };

      // Both ownership checks pass
      mockTx.identifier.findFirst
        .mockResolvedValueOnce(IDENTIFIER_RECORD) // primary
        .mockResolvedValueOnce(IDENTIFIER_RECORD); // secondary (same id)

      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      await expect(
        createOrganisations(TENANT_ID, [
          {
            name: 'Acme Corp',
            primaryIdentifierId: 'ident-1',
            secondaryIdentifierIds: ['ident-1'],
          },
        ]),
      ).rejects.toThrow('Primary identifier cannot also be a secondary identifier');
    });

    it('rolls back the entire batch on validation failure', async () => {
      const mockTx = {
        identifier: { findFirst: jest.fn() },
        organisationEntity: {
          create: jest.fn(),
          findUniqueOrThrow: jest.fn(),
        },
        organisationSecondaryIdentifier: { createMany: jest.fn() },
      };

      // First org succeeds
      mockTx.organisationEntity.create.mockResolvedValueOnce(ORG_RECORD);
      // Second org fails validation — primary identifier not found
      mockTx.identifier.findFirst.mockResolvedValue(null);

      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      await expect(
        createOrganisations(TENANT_ID, [
          { name: 'Acme Corp' }, // no identifiers, passes
          { name: 'Beta Ltd', primaryIdentifierId: 'nonexistent' }, // fails
        ]),
      ).rejects.toThrow('Identifier not found: nonexistent');

      // The transaction callback threw, so Prisma would roll back.
      // First org was created inside the transaction but will be rolled back.
      expect(mockTx.organisationEntity.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOrganisationById', () => {
    it('returns the organisation with includes if it belongs to the tenant', async () => {
      mockOrganisationEntity.findFirst.mockResolvedValue(ORG_RECORD);

      const result = await getOrganisationById('org-1', TENANT_ID);

      expect(mockOrganisationEntity.findFirst).toHaveBeenCalledWith({
        where: { id: 'org-1', tenantId: TENANT_ID },
        include: {
          primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: { include: { registrar: true } } } } } },
        },
      });
      expect(result).toEqual(ORG_RECORD);
    });

    it('returns null for an organisation from another tenant', async () => {
      mockOrganisationEntity.findFirst.mockResolvedValue(null);

      const result = await getOrganisationById('org-1', OTHER_TENANT_ID);
      expect(result).toBeNull();
    });
  });

  describe('listOrganisations', () => {
    const LIST_ROW = {
      id: 'org-1',
      tenantId: TENANT_ID,
      name: 'Acme Corp',
      description: 'A test organisation',
      location: { address: { streetAddress: '123 Main St' } },
      primaryIdentifierId: 'ident-1',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      secondaryIdentifiers: [{ identifierId: 'ident-2' }],
    };

    it('lists organisations with default pagination and flattened secondaryIdentifierIds', async () => {
      mockOrganisationEntity.findMany.mockResolvedValue([LIST_ROW]);
      mockOrganisationEntity.count.mockResolvedValue(1);

      const result = await listOrganisations(TENANT_ID);

      expect(mockOrganisationEntity.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        include: {
          secondaryIdentifiers: { select: { identifierId: true } },
        },
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockOrganisationEntity.count).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          id: 'org-1',
          secondaryIdentifierIds: ['ident-2'],
        }),
      );
      // Should not contain raw secondaryIdentifiers
      expect(result.data[0]).not.toHaveProperty('secondaryIdentifiers');
    });

    it('applies custom pagination', async () => {
      mockOrganisationEntity.findMany.mockResolvedValue([]);
      mockOrganisationEntity.count.mockResolvedValue(0);

      await listOrganisations(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockOrganisationEntity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });

    it('searches by name', async () => {
      mockOrganisationEntity.findMany.mockResolvedValue([]);
      mockOrganisationEntity.count.mockResolvedValue(0);

      await listOrganisations(TENANT_ID, { search: 'Acme' });

      expect(mockOrganisationEntity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            OR: expect.arrayContaining([{ name: { contains: 'Acme', mode: 'insensitive' } }]),
          }),
        }),
      );
    });

    it('searches by identifier value with OR clause', async () => {
      mockOrganisationEntity.findMany.mockResolvedValue([]);
      mockOrganisationEntity.count.mockResolvedValue(0);

      await listOrganisations(TENANT_ID, { search: '12345' });

      expect(mockOrganisationEntity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: '12345', mode: 'insensitive' } },
              { primaryIdentifier: { value: { contains: '12345', mode: 'insensitive' } } },
              {
                secondaryIdentifiers: {
                  some: {
                    identifier: { value: { contains: '12345', mode: 'insensitive' } },
                  },
                },
              },
            ],
          }),
        }),
      );
    });

    it('returns empty data array when no matches', async () => {
      mockOrganisationEntity.findMany.mockResolvedValue([]);
      mockOrganisationEntity.count.mockResolvedValue(0);

      const result = await listOrganisations(TENANT_ID, { search: 'nonexistent' });
      expect(result).toEqual({ data: [], total: 0 });
    });
  });

  describe('updateOrganisation', () => {
    it('performs a partial update (name only)', async () => {
      const updatedOrg = { ...ORG_RECORD, name: 'Acme Industries' };
      const mockTx = {
        organisationEntity: {
          findFirst: jest.fn().mockResolvedValue(ORG_RECORD),
          update: jest.fn().mockResolvedValue(updatedOrg),
        },
        identifier: { findFirst: jest.fn() },
        organisationSecondaryIdentifier: {
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      };

      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      const result = await updateOrganisation('org-1', TENANT_ID, { name: 'Acme Industries' });

      expect(mockTx.organisationEntity.findFirst).toHaveBeenCalledWith({
        where: { id: 'org-1', tenantId: TENANT_ID },
      });
      expect(mockTx.organisationEntity.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { name: 'Acme Industries' },
        include: {
          primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: { include: { registrar: true } } } } } },
        },
      });
      expect(result.name).toBe('Acme Industries');
    });

    it('replaces secondary identifiers via deleteMany + createMany in transaction', async () => {
      const updatedOrg = {
        ...ORG_RECORD,
        secondaryIdentifiers: [{ organisationId: 'org-1', identifierId: 'ident-2', identifier: IDENTIFIER_RECORD_2 }],
      };

      const mockTx = {
        organisationEntity: {
          findFirst: jest.fn().mockResolvedValue(ORG_RECORD),
          update: jest.fn().mockResolvedValue(updatedOrg),
        },
        identifier: {
          findFirst: jest.fn().mockResolvedValue(IDENTIFIER_RECORD_2),
        },
        organisationSecondaryIdentifier: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };

      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      const result = await updateOrganisation('org-1', TENANT_ID, {
        secondaryIdentifierIds: ['ident-2'],
      });

      expect(mockTx.organisationSecondaryIdentifier.deleteMany).toHaveBeenCalledWith({
        where: { organisationId: 'org-1' },
      });
      expect(mockTx.organisationSecondaryIdentifier.createMany).toHaveBeenCalledWith({
        data: [{ organisationId: 'org-1', identifierId: 'ident-2' }],
      });
      expect(mockTx.organisationEntity.update).toHaveBeenCalled();
      expect(result.secondaryIdentifiers).toHaveLength(1);
    });

    it('clears all secondary identifiers with empty array', async () => {
      const orgWithSecondaries = {
        ...ORG_RECORD,
        secondaryIdentifiers: [{ organisationId: 'org-1', identifierId: 'ident-2', identifier: IDENTIFIER_RECORD_2 }],
      };
      const clearedOrg = { ...ORG_RECORD, secondaryIdentifiers: [] };
      const mockTx = {
        organisationEntity: {
          findFirst: jest.fn().mockResolvedValue(orgWithSecondaries),
          update: jest.fn().mockResolvedValue(clearedOrg),
        },
        identifier: { findFirst: jest.fn() },
        organisationSecondaryIdentifier: {
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          createMany: jest.fn(),
        },
      };

      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      const result = await updateOrganisation('org-1', TENANT_ID, {
        secondaryIdentifierIds: [],
      });

      expect(mockTx.organisationSecondaryIdentifier.deleteMany).toHaveBeenCalledWith({
        where: { organisationId: 'org-1' },
      });
      expect(mockTx.organisationSecondaryIdentifier.createMany).not.toHaveBeenCalled();
      expect(result.secondaryIdentifiers).toHaveLength(0);
    });

    it('throws NotFoundError if organisation does not belong to tenant', async () => {
      const mockTx = {
        organisationEntity: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
        identifier: { findFirst: jest.fn() },
        organisationSecondaryIdentifier: {
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      };

      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      await expect(updateOrganisation('org-1', OTHER_TENANT_ID, { name: 'Updated' })).rejects.toThrow(
        'Organisation not found or access denied',
      );
    });
  });

  describe('deleteOrganisation', () => {
    it('deletes an organisation owned by the tenant', async () => {
      const mockTx = {
        organisationEntity: {
          findFirst: jest.fn().mockResolvedValue(ORG_RECORD),
          delete: jest.fn().mockResolvedValue(ORG_RECORD),
        },
      };

      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      const result = await deleteOrganisation('org-1', TENANT_ID);

      expect(mockTx.organisationEntity.findFirst).toHaveBeenCalledWith({
        where: { id: 'org-1', tenantId: TENANT_ID },
      });
      expect(mockTx.organisationEntity.delete).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        include: {
          primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: { include: { registrar: true } } } } } },
        },
      });
      expect(result).toEqual(ORG_RECORD);
    });

    it('throws NotFoundError if organisation does not belong to tenant', async () => {
      const mockTx = {
        organisationEntity: {
          findFirst: jest.fn().mockResolvedValue(null),
          delete: jest.fn(),
        },
      };

      mockTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      await expect(deleteOrganisation('org-1', OTHER_TENANT_ID)).rejects.toThrow(
        'Organisation not found or access denied',
      );
    });
  });
});
