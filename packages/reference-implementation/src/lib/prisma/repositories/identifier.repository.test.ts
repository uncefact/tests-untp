import {
  createIdentifier,
  getIdentifierById,
  listIdentifiers,
  updateIdentifier,
  deleteIdentifier,
} from './identifier.repository';

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock('../prisma', () => ({
  prisma: {
    identifier: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    identifierScheme: {
      findFirst: jest.fn(),
    },
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockIdentifier = prisma.identifier as unknown as {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

const mockIdentifierScheme = (prisma as unknown as { identifierScheme: { findFirst: jest.Mock } }).identifierScheme;

describe('identifier.repository', () => {
  const TENANT_ID = 'tenant-1';
  const SCHEME_ID = 'scheme-1';
  const SCHEME_RECORD = {
    id: SCHEME_ID,
    tenantId: TENANT_ID,
    registrarId: 'reg-1',
    name: 'GTIN',
    primaryKey: 'gtin',
    validationPattern: '^\\d{13,14}$',
    namespace: 'gs1',
    idrServiceInstanceId: null,
    isDefault: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const IDENTIFIER_RECORD = {
    id: 'ident-1',
    tenantId: TENANT_ID,
    schemeId: SCHEME_ID,
    value: '1234567890123',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    scheme: SCHEME_RECORD,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createIdentifier', () => {
    it('creates an identifier after validating the value', async () => {
      mockIdentifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockIdentifier.create.mockResolvedValue(IDENTIFIER_RECORD);

      const result = await createIdentifier({
        tenantId: TENANT_ID,
        schemeId: SCHEME_ID,
        value: '1234567890123',
      });

      expect(mockIdentifierScheme.findFirst).toHaveBeenCalledWith({
        where: {
          id: SCHEME_ID,
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
        },
      });
      expect(mockIdentifier.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          schemeId: SCHEME_ID,
          value: '1234567890123',
        },
        include: {
          scheme: true,
        },
      });
      expect(result).toEqual(IDENTIFIER_RECORD);
    });

    it('throws NotFoundError if the scheme does not exist', async () => {
      mockIdentifierScheme.findFirst.mockResolvedValue(null);

      await expect(
        createIdentifier({
          tenantId: TENANT_ID,
          schemeId: 'nonexistent',
          value: '1234567890123',
        }),
      ).rejects.toThrow('Identifier scheme not found');
    });

    it('throws ValidationError if the value does not match the pattern', async () => {
      mockIdentifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);

      await expect(
        createIdentifier({
          tenantId: TENANT_ID,
          schemeId: SCHEME_ID,
          value: 'invalid-value',
        }),
      ).rejects.toThrow(/does not match scheme validation pattern/);
    });
  });

  describe('getIdentifierById', () => {
    it('returns the identifier if it belongs to the tenant', async () => {
      mockIdentifier.findFirst.mockResolvedValue(IDENTIFIER_RECORD);

      const result = await getIdentifierById('ident-1', TENANT_ID);

      expect(mockIdentifier.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'ident-1',
          tenantId: TENANT_ID,
        },
        include: {
          scheme: {
            include: {
              registrar: true,
              qualifiers: true,
            },
          },
        },
      });
      expect(result).toEqual(IDENTIFIER_RECORD);
    });

    it('returns null for an identifier from another tenant', async () => {
      mockIdentifier.findFirst.mockResolvedValue(null);

      const result = await getIdentifierById('ident-1', 'other-tenant');
      expect(result).toBeNull();
    });
  });

  describe('listIdentifiers', () => {
    it('lists identifiers for the tenant', async () => {
      mockIdentifier.findMany.mockResolvedValue([IDENTIFIER_RECORD]);

      const result = await listIdentifiers(TENANT_ID);

      expect(mockIdentifier.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
        },
        include: {
          scheme: true,
        },
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([IDENTIFIER_RECORD]);
    });

    it('filters by schemeId', async () => {
      mockIdentifier.findMany.mockResolvedValue([]);

      await listIdentifiers(TENANT_ID, { schemeId: SCHEME_ID });

      expect(mockIdentifier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            schemeId: SCHEME_ID,
          }),
        }),
      );
    });

    it('applies pagination', async () => {
      mockIdentifier.findMany.mockResolvedValue([]);

      await listIdentifiers(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockIdentifier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });
  });

  describe('updateIdentifier', () => {
    it('updates the value after re-validating', async () => {
      mockIdentifier.findFirst.mockResolvedValue(IDENTIFIER_RECORD);
      mockIdentifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockIdentifier.update.mockResolvedValue({ ...IDENTIFIER_RECORD, value: '9876543210123' });

      const result = await updateIdentifier('ident-1', TENANT_ID, { value: '9876543210123' });

      expect(mockIdentifier.findFirst).toHaveBeenCalledWith({
        where: { id: 'ident-1', tenantId: TENANT_ID },
      });
      expect(mockIdentifierScheme.findFirst).toHaveBeenCalledWith({
        where: {
          id: SCHEME_ID,
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
        },
      });
      expect(mockIdentifier.update).toHaveBeenCalledWith({
        where: { id: 'ident-1' },
        data: { value: '9876543210123' },
        include: {
          scheme: true,
        },
      });
      expect(result.value).toBe('9876543210123');
    });

    it('throws ValidationError if the new value does not match the pattern', async () => {
      mockIdentifier.findFirst.mockResolvedValue(IDENTIFIER_RECORD);
      mockIdentifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);

      await expect(updateIdentifier('ident-1', TENANT_ID, { value: 'invalid' })).rejects.toThrow(
        /does not match scheme validation pattern/,
      );
    });

    it('throws if identifier does not belong to the tenant', async () => {
      mockIdentifier.findFirst.mockResolvedValue(null);

      await expect(updateIdentifier('ident-1', 'other-tenant', { value: '123' })).rejects.toThrow(
        'Identifier not found or access denied',
      );
    });
  });

  describe('deleteIdentifier', () => {
    it('deletes an identifier owned by the tenant', async () => {
      mockIdentifier.findFirst.mockResolvedValue(IDENTIFIER_RECORD);
      mockIdentifier.delete.mockResolvedValue(IDENTIFIER_RECORD);

      const result = await deleteIdentifier('ident-1', TENANT_ID);

      expect(mockIdentifier.findFirst).toHaveBeenCalledWith({
        where: { id: 'ident-1', tenantId: TENANT_ID },
      });
      expect(mockIdentifier.delete).toHaveBeenCalledWith({
        where: { id: 'ident-1' },
      });
      expect(result).toEqual(IDENTIFIER_RECORD);
    });

    it('throws if identifier does not belong to the tenant', async () => {
      mockIdentifier.findFirst.mockResolvedValue(null);

      await expect(deleteIdentifier('ident-1', 'other-tenant')).rejects.toThrow(
        'Identifier not found or access denied',
      );
    });
  });
});
