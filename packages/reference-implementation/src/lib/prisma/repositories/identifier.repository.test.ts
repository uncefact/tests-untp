import {
  createIdentifier,
  getIdentifierById,
  listIdentifiers,
  updateIdentifier,
  deleteIdentifier,
} from './identifier.repository';

// Transaction mock — functions called via $transaction callback
const mockTx = {
  identifier: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  identifierScheme: {
    findFirst: jest.fn(),
  },
};

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock('../prisma', () => ({
  prisma: {
    identifier: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockIdentifier = prisma.identifier as unknown as {
  findFirst: jest.Mock;
  findMany: jest.Mock;
};

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
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.identifier.create.mockResolvedValue(IDENTIFIER_RECORD);

      const result = await createIdentifier({
        tenantId: TENANT_ID,
        schemeId: SCHEME_ID,
        value: '1234567890123',
      });

      expect(mockTx.identifierScheme.findFirst).toHaveBeenCalledWith({
        where: {
          id: SCHEME_ID,
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
        },
      });
      expect(mockTx.identifier.create).toHaveBeenCalledWith({
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
      mockTx.identifierScheme.findFirst.mockResolvedValue(null);

      await expect(
        createIdentifier({
          tenantId: TENANT_ID,
          schemeId: 'nonexistent',
          value: '1234567890123',
        }),
      ).rejects.toThrow('Identifier scheme not found');
    });

    it('throws ValidationError if the value does not match the pattern', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);

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
      mockTx.identifier.findFirst.mockResolvedValue(IDENTIFIER_RECORD);
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.identifier.update.mockResolvedValue({ ...IDENTIFIER_RECORD, value: '9876543210123' });

      const result = await updateIdentifier('ident-1', TENANT_ID, { value: '9876543210123' });

      expect(mockTx.identifier.findFirst).toHaveBeenCalledWith({
        where: { id: 'ident-1', tenantId: TENANT_ID },
      });
      expect(mockTx.identifierScheme.findFirst).toHaveBeenCalledWith({
        where: {
          id: SCHEME_ID,
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
        },
      });
      expect(mockTx.identifier.update).toHaveBeenCalledWith({
        where: { id: 'ident-1' },
        data: { value: '9876543210123' },
        include: {
          scheme: true,
        },
      });
      expect(result.value).toBe('9876543210123');
    });

    it('throws ValidationError if the new value does not match the pattern', async () => {
      mockTx.identifier.findFirst.mockResolvedValue(IDENTIFIER_RECORD);
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);

      await expect(updateIdentifier('ident-1', TENANT_ID, { value: 'invalid' })).rejects.toThrow(
        /does not match scheme validation pattern/,
      );
    });

    it('throws if identifier does not belong to the tenant', async () => {
      mockTx.identifier.findFirst.mockResolvedValue(null);

      await expect(updateIdentifier('ident-1', 'other-tenant', { value: '123' })).rejects.toThrow(
        'Identifier not found or access denied',
      );
    });
  });

  describe('deleteIdentifier', () => {
    it('deletes an identifier owned by the tenant', async () => {
      mockTx.identifier.findFirst.mockResolvedValue(IDENTIFIER_RECORD);
      mockTx.identifier.delete.mockResolvedValue(IDENTIFIER_RECORD);

      const result = await deleteIdentifier('ident-1', TENANT_ID);

      expect(mockTx.identifier.findFirst).toHaveBeenCalledWith({
        where: { id: 'ident-1', tenantId: TENANT_ID },
      });
      expect(mockTx.identifier.delete).toHaveBeenCalledWith({
        where: { id: 'ident-1' },
      });
      expect(result).toEqual(IDENTIFIER_RECORD);
    });

    it('throws if identifier does not belong to the tenant', async () => {
      mockTx.identifier.findFirst.mockResolvedValue(null);

      await expect(deleteIdentifier('ident-1', 'other-tenant')).rejects.toThrow(
        'Identifier not found or access denied',
      );
    });
  });
});
