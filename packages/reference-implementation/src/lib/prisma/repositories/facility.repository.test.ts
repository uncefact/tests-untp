import {
  createFacilities,
  getFacilityById,
  listFacilities,
  updateFacility,
  deleteFacility,
} from './facility.repository';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import {
  prismaForeignKeyViolationError,
  prismaRecordNotFoundError,
  prismaUniqueConstraintError,
} from '@/lib/prisma/db-errors.fixtures';

// Mock Prisma client. Use jest.fn() inside the factory to avoid hoisting issues.
const mockTx = {
  identifier: {
    findFirst: jest.fn(),
  },
  organisationEntity: {
    findFirst: jest.fn(),
  },
  facility: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  facilitySecondaryIdentifier: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};

const mockTransaction = jest.fn().mockImplementation((cb) => cb(mockTx));

jest.mock('../prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    facility: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockFacility = prisma.facility as unknown as {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
};

describe('facility.repository', () => {
  const TENANT_ID = 'tenant-1';
  const OTHER_TENANT = 'other-tenant';
  const ORG_ID = 'org-1';
  const PRIMARY_ID = 'ident-1';
  const SECONDARY_ID_A = 'ident-2';
  const SECONDARY_ID_B = 'ident-3';

  const FACILITY_RECORD = {
    id: 'facility-1',
    tenantId: TENANT_ID,
    name: 'Main Warehouse',
    description: 'Central distribution warehouse',
    location: { address: { streetAddress: '123 High Street' } },
    operatingOrganisationId: ORG_ID,
    primaryIdentifierId: PRIMARY_ID,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    primaryIdentifier: {
      id: PRIMARY_ID,
      tenantId: TENANT_ID,
      schemeId: 'scheme-1',
      value: '1234567890123',
      scheme: { id: 'scheme-1', name: 'GLN' },
    },
    secondaryIdentifiers: [
      {
        facilityId: 'facility-1',
        identifierId: SECONDARY_ID_A,
        identifier: {
          id: SECONDARY_ID_A,
          tenantId: TENANT_ID,
          schemeId: 'scheme-2',
          value: 'SEC-001',
          scheme: { id: 'scheme-2', name: 'Internal' },
        },
      },
    ],
    operatingOrganisation: {
      id: ORG_ID,
      tenantId: TENANT_ID,
      name: 'Acme Corp',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createFacilities', () => {
    it('creates a single facility', async () => {
      mockTx.organisationEntity.findFirst.mockResolvedValue({ id: ORG_ID, tenantId: TENANT_ID });
      mockTx.identifier.findFirst.mockResolvedValue({ id: PRIMARY_ID, tenantId: TENANT_ID });
      mockTx.facility.create.mockResolvedValue(FACILITY_RECORD);

      const result = await createFacilities(TENANT_ID, [
        {
          name: 'Main Warehouse',
          description: 'Central distribution warehouse',
          location: { address: { streetAddress: '123 High Street' } },
          operatingOrganisationId: ORG_ID,
          primaryIdentifierId: PRIMARY_ID,
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(FACILITY_RECORD);
      expect(mockTx.organisationEntity.findFirst).toHaveBeenCalledWith({
        where: { id: ORG_ID, tenantId: TENANT_ID },
      });
      expect(mockTx.facility.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            name: 'Main Warehouse',
          }),
          include: expect.objectContaining({
            primaryIdentifier: expect.any(Object),
            secondaryIdentifiers: expect.any(Object),
            operatingOrganisation: true,
          }),
        }),
      );
    });

    it('creates a facility with primary and secondary identifiers', async () => {
      mockTx.organisationEntity.findFirst.mockResolvedValue({ id: ORG_ID, tenantId: TENANT_ID });
      mockTx.identifier.findFirst
        .mockResolvedValueOnce({ id: PRIMARY_ID, tenantId: TENANT_ID }) // primary
        .mockResolvedValueOnce({ id: SECONDARY_ID_A, tenantId: TENANT_ID }); // secondary

      const createdFacility = { ...FACILITY_RECORD, secondaryIdentifiers: [] };
      mockTx.facility.create.mockResolvedValue(createdFacility);
      mockTx.facilitySecondaryIdentifier.createMany.mockResolvedValue({ count: 1 });
      mockTx.facility.findUniqueOrThrow.mockResolvedValue(FACILITY_RECORD);

      const result = await createFacilities(TENANT_ID, [
        {
          name: 'Main Warehouse',
          operatingOrganisationId: ORG_ID,
          primaryIdentifierId: PRIMARY_ID,
          secondaryIdentifierIds: [SECONDARY_ID_A],
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(FACILITY_RECORD);
      expect(mockTx.facilitySecondaryIdentifier.createMany).toHaveBeenCalledWith({
        data: [{ facilityId: 'facility-1', identifierId: SECONDARY_ID_A }],
      });
      expect(mockTx.facility.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'facility-1' },
        include: {
          primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: { include: { registrar: true } } } } } },
          operatingOrganisation: true,
        },
      });
    });

    it('creates multiple facilities', async () => {
      mockTx.facility.create.mockResolvedValue(FACILITY_RECORD);

      const result = await createFacilities(TENANT_ID, [{ name: 'Warehouse A' }, { name: 'Warehouse B' }]);

      expect(result).toHaveLength(2);
      expect(mockTx.facility.create).toHaveBeenCalledTimes(2);
    });

    it('validates primary identifier belongs to tenant', async () => {
      mockTx.identifier.findFirst.mockResolvedValue(null);

      await expect(
        createFacilities(TENANT_ID, [{ name: 'Warehouse', primaryIdentifierId: 'nonexistent' }]),
      ).rejects.toThrow('Primary identifier not found: nonexistent');
    });

    it('validates secondary identifiers belong to tenant', async () => {
      mockTx.identifier.findFirst
        .mockResolvedValueOnce({ id: PRIMARY_ID, tenantId: TENANT_ID }) // primary passes
        .mockResolvedValueOnce(null); // secondary fails

      await expect(
        createFacilities(TENANT_ID, [
          {
            name: 'Warehouse',
            primaryIdentifierId: PRIMARY_ID,
            secondaryIdentifierIds: ['nonexistent-sec'],
          },
        ]),
      ).rejects.toThrow('Secondary identifier not found: nonexistent-sec');
    });

    it('validates operatingOrganisationId belongs to tenant', async () => {
      mockTx.organisationEntity.findFirst.mockResolvedValue(null);

      await expect(
        createFacilities(TENANT_ID, [{ name: 'Warehouse', operatingOrganisationId: 'bad-org' }]),
      ).rejects.toThrow('Organisation not found: bad-org');
    });

    it('rejects primary and secondary identifier overlap', async () => {
      mockTx.organisationEntity.findFirst.mockResolvedValue({ id: ORG_ID, tenantId: TENANT_ID });
      mockTx.identifier.findFirst.mockResolvedValue({ id: PRIMARY_ID, tenantId: TENANT_ID });

      await expect(
        createFacilities(TENANT_ID, [
          {
            name: 'Warehouse',
            primaryIdentifierId: PRIMARY_ID,
            secondaryIdentifierIds: [PRIMARY_ID],
          },
        ]),
      ).rejects.toThrow('Primary identifier must not also appear in secondary identifiers');
    });

    it('rejects duplicate secondary identifiers', async () => {
      const result = createFacilities(TENANT_ID, [
        { name: 'Warehouse', secondaryIdentifierIds: [SECONDARY_ID_A, SECONDARY_ID_A] },
      ]);

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('Secondary identifiers must not contain duplicates');
    });

    it('maps a unique-constraint violation to ConflictError with a clean message', async () => {
      mockTx.facility.create.mockRejectedValue(prismaUniqueConstraintError());

      const result = createFacilities(TENANT_ID, [{ name: 'Warehouse' }]);

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow(
        'An identifier in this request is already the primary identifier of another facility',
      );
    });

    it('rethrows a non-database error unchanged', async () => {
      const nonDatabaseError = new Error('connection lost');
      mockTx.facility.create.mockRejectedValue(nonDatabaseError);

      await expect(createFacilities(TENANT_ID, [{ name: 'Warehouse' }])).rejects.toThrow(nonDatabaseError);
    });

    it('maps a foreign-key violation on facility creation to ValidationError', async () => {
      mockTx.facility.create.mockRejectedValue(prismaForeignKeyViolationError());

      const result = createFacilities(TENANT_ID, [{ name: 'Warehouse' }]);

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('The referenced organisation or identifier no longer exists');
    });

    it('maps a foreign-key violation on secondary-identifier join creation to ValidationError', async () => {
      mockTx.identifier.findFirst.mockResolvedValue({ id: SECONDARY_ID_A, tenantId: TENANT_ID });
      mockTx.facility.create.mockResolvedValue(FACILITY_RECORD);
      mockTx.facilitySecondaryIdentifier.createMany.mockRejectedValue(prismaForeignKeyViolationError());

      const result = createFacilities(TENANT_ID, [{ name: 'Warehouse', secondaryIdentifierIds: [SECONDARY_ID_A] }]);

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('One or more secondary identifiers no longer exist');
    });
  });

  describe('getFacilityById', () => {
    it('returns the facility with includes if it belongs to the tenant', async () => {
      mockFacility.findFirst.mockResolvedValue(FACILITY_RECORD);

      const result = await getFacilityById('facility-1', TENANT_ID);

      expect(mockFacility.findFirst).toHaveBeenCalledWith({
        where: { id: 'facility-1', tenantId: TENANT_ID },
        include: {
          primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: { include: { registrar: true } } } } } },
          operatingOrganisation: true,
        },
      });
      expect(result).toEqual(FACILITY_RECORD);
    });

    it('returns null for a facility from another tenant', async () => {
      mockFacility.findFirst.mockResolvedValue(null);

      const result = await getFacilityById('facility-1', OTHER_TENANT);
      expect(result).toBeNull();
    });
  });

  describe('listFacilities', () => {
    const LIST_ROW = {
      id: 'facility-1',
      tenantId: TENANT_ID,
      name: 'Main Warehouse',
      description: 'Central distribution warehouse',
      location: { address: { streetAddress: '123 High Street' } },
      operatingOrganisationId: ORG_ID,
      primaryIdentifierId: PRIMARY_ID,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      secondaryIdentifiers: [{ identifierId: SECONDARY_ID_A }],
    };

    it('lists facilities with default pagination and flattens secondary identifiers', async () => {
      mockFacility.findMany.mockResolvedValue([LIST_ROW]);
      mockFacility.count.mockResolvedValue(1);

      const result = await listFacilities(TENANT_ID);

      expect(mockFacility.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        include: {
          secondaryIdentifiers: { select: { identifierId: true } },
        },
        take: DEFAULT_PAGE_LIMIT,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockFacility.count).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
      expect(result.data).toEqual([
        expect.objectContaining({
          id: 'facility-1',
          secondaryIdentifierIds: [SECONDARY_ID_A],
        }),
      ]);
      expect(result.data[0]).not.toHaveProperty('secondaryIdentifiers');
      expect(result.total).toBe(1);
    });

    it('applies custom pagination', async () => {
      mockFacility.findMany.mockResolvedValue([]);
      mockFacility.count.mockResolvedValue(0);

      await listFacilities(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockFacility.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });

    it('searches by name', async () => {
      mockFacility.findMany.mockResolvedValue([]);
      mockFacility.count.mockResolvedValue(0);

      await listFacilities(TENANT_ID, { search: 'warehouse' });

      expect(mockFacility.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            OR: [
              { name: { contains: 'warehouse', mode: 'insensitive' } },
              { primaryIdentifier: { value: { contains: 'warehouse', mode: 'insensitive' } } },
              {
                secondaryIdentifiers: {
                  some: {
                    identifier: { value: { contains: 'warehouse', mode: 'insensitive' } },
                  },
                },
              },
            ],
          }),
        }),
      );
    });

    it('filters by organisationId', async () => {
      mockFacility.findMany.mockResolvedValue([]);
      mockFacility.count.mockResolvedValue(0);

      await listFacilities(TENANT_ID, { organisationId: ORG_ID });

      expect(mockFacility.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            operatingOrganisationId: ORG_ID,
          }),
        }),
      );
    });

    it('returns empty data array when no facilities match', async () => {
      mockFacility.findMany.mockResolvedValue([]);
      mockFacility.count.mockResolvedValue(0);

      const result = await listFacilities(TENANT_ID, { search: 'nonexistent' });
      expect(result).toEqual({ data: [], total: 0 });
    });
  });

  describe('updateFacility', () => {
    it('performs a partial update (name only)', async () => {
      const updatedRecord = { ...FACILITY_RECORD, name: 'Renamed Warehouse' };
      mockTx.facility.findFirst.mockResolvedValue(FACILITY_RECORD);
      mockTx.facility.update.mockResolvedValue(updatedRecord);

      const result = await updateFacility('facility-1', TENANT_ID, { name: 'Renamed Warehouse' });

      expect(mockTx.facility.findFirst).toHaveBeenCalledWith({
        where: { id: 'facility-1', tenantId: TENANT_ID },
      });
      expect(mockTx.facility.update).toHaveBeenCalledWith({
        where: { id: 'facility-1' },
        data: { name: 'Renamed Warehouse' },
        include: {
          primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: { include: { registrar: true } } } } } },
          operatingOrganisation: true,
        },
      });
      expect(result.name).toBe('Renamed Warehouse');
    });

    it('validates operatingOrganisationId FK', async () => {
      mockTx.facility.findFirst.mockResolvedValue(FACILITY_RECORD);
      mockTx.organisationEntity.findFirst.mockResolvedValue(null);

      await expect(updateFacility('facility-1', TENANT_ID, { operatingOrganisationId: 'bad-org' })).rejects.toThrow(
        'Organisation not found: bad-org',
      );
    });

    it('replaces secondary identifiers', async () => {
      mockTx.facility.findFirst.mockResolvedValue(FACILITY_RECORD);
      mockTx.identifier.findFirst
        .mockResolvedValueOnce({ id: SECONDARY_ID_A, tenantId: TENANT_ID })
        .mockResolvedValueOnce({ id: SECONDARY_ID_B, tenantId: TENANT_ID });
      mockTx.facilitySecondaryIdentifier.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.facilitySecondaryIdentifier.createMany.mockResolvedValue({ count: 2 });
      mockTx.facility.update.mockResolvedValue(FACILITY_RECORD);

      await updateFacility('facility-1', TENANT_ID, {
        secondaryIdentifierIds: [SECONDARY_ID_A, SECONDARY_ID_B],
      });

      expect(mockTx.facilitySecondaryIdentifier.deleteMany).toHaveBeenCalledWith({
        where: { facilityId: 'facility-1' },
      });
      expect(mockTx.facilitySecondaryIdentifier.createMany).toHaveBeenCalledWith({
        data: [
          { facilityId: 'facility-1', identifierId: SECONDARY_ID_A },
          { facilityId: 'facility-1', identifierId: SECONDARY_ID_B },
        ],
      });
    });

    it('maps a foreign-key violation on secondary-identifier replacement to ValidationError', async () => {
      mockTx.facility.findFirst.mockResolvedValue(FACILITY_RECORD);
      mockTx.identifier.findFirst
        .mockResolvedValueOnce({ id: SECONDARY_ID_A, tenantId: TENANT_ID })
        .mockResolvedValueOnce({ id: SECONDARY_ID_B, tenantId: TENANT_ID });
      mockTx.facilitySecondaryIdentifier.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.facilitySecondaryIdentifier.createMany.mockRejectedValue(prismaForeignKeyViolationError());

      const result = updateFacility('facility-1', TENANT_ID, {
        secondaryIdentifierIds: [SECONDARY_ID_A, SECONDARY_ID_B],
      });

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('The facility or one or more secondary identifiers no longer exist');
      expect(mockTx.facility.update).not.toHaveBeenCalled();
    });

    it('maps a unique-constraint violation on secondary-identifier replacement to ConflictError', async () => {
      mockTx.facility.findFirst.mockResolvedValue(FACILITY_RECORD);
      mockTx.identifier.findFirst
        .mockResolvedValueOnce({ id: SECONDARY_ID_A, tenantId: TENANT_ID })
        .mockResolvedValueOnce({ id: SECONDARY_ID_B, tenantId: TENANT_ID });
      mockTx.facilitySecondaryIdentifier.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.facilitySecondaryIdentifier.createMany.mockRejectedValue(prismaUniqueConstraintError());

      const result = updateFacility('facility-1', TENANT_ID, {
        secondaryIdentifierIds: [SECONDARY_ID_A, SECONDARY_ID_B],
      });

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow(
        'One or more secondary identifiers were concurrently linked to this facility; retry the request',
      );
      expect(mockTx.facility.update).not.toHaveBeenCalled();
    });

    it('clears secondary identifiers with empty array', async () => {
      mockTx.facility.findFirst.mockResolvedValue(FACILITY_RECORD);
      mockTx.facilitySecondaryIdentifier.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.facility.update.mockResolvedValue({ ...FACILITY_RECORD, secondaryIdentifiers: [] });

      await updateFacility('facility-1', TENANT_ID, { secondaryIdentifierIds: [] });

      expect(mockTx.facilitySecondaryIdentifier.deleteMany).toHaveBeenCalledWith({
        where: { facilityId: 'facility-1' },
      });
      expect(mockTx.facilitySecondaryIdentifier.createMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundError for ownership check failure', async () => {
      mockTx.facility.findFirst.mockResolvedValue(null);

      await expect(updateFacility('facility-1', OTHER_TENANT, { name: 'Nope' })).rejects.toThrow('Facility not found');
    });

    it('rejects duplicate secondary identifiers', async () => {
      mockTx.facility.findFirst.mockResolvedValue(FACILITY_RECORD);

      const result = updateFacility('facility-1', TENANT_ID, {
        secondaryIdentifierIds: [SECONDARY_ID_A, SECONDARY_ID_A],
      });

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('Secondary identifiers must not contain duplicates');
    });

    it('maps a unique-constraint violation to ConflictError with a clean message', async () => {
      mockTx.facility.findFirst.mockResolvedValue(FACILITY_RECORD);
      mockTx.facility.update.mockRejectedValue(prismaUniqueConstraintError());

      const result = updateFacility('facility-1', TENANT_ID, { name: 'Renamed Warehouse' });

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow('The identifier is already the primary identifier of another facility');
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      mockTx.facility.findFirst.mockResolvedValue(FACILITY_RECORD);
      mockTx.facility.update.mockRejectedValue(prismaRecordNotFoundError());

      const result = updateFacility('facility-1', TENANT_ID, { name: 'Renamed Warehouse' });

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Facility or a referenced resource not found');
    });
  });

  describe('deleteFacility', () => {
    it('deletes a facility owned by the tenant', async () => {
      mockTx.facility.findFirst.mockResolvedValue(FACILITY_RECORD);
      mockTx.facility.delete.mockResolvedValue(FACILITY_RECORD);

      const result = await deleteFacility('facility-1', TENANT_ID);

      expect(mockTx.facility.findFirst).toHaveBeenCalledWith({
        where: { id: 'facility-1', tenantId: TENANT_ID },
      });
      expect(mockTx.facility.delete).toHaveBeenCalledWith({
        where: { id: 'facility-1' },
      });
      expect(result).toEqual(FACILITY_RECORD);
    });

    it('throws NotFoundError for a facility from another tenant', async () => {
      mockTx.facility.findFirst.mockResolvedValue(null);

      await expect(deleteFacility('facility-1', OTHER_TENANT)).rejects.toThrow('Facility not found');
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      mockTx.facility.findFirst.mockResolvedValue(FACILITY_RECORD);
      mockTx.facility.delete.mockRejectedValue(prismaRecordNotFoundError());

      const result = deleteFacility('facility-1', TENANT_ID);

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Facility not found');
    });
  });
});
