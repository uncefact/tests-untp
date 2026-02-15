import {
  createIdentifierScheme,
  getIdentifierSchemeById,
  listIdentifierSchemes,
  updateIdentifierScheme,
  deleteIdentifierScheme,
} from './identifier-scheme.repository';

// Transaction mock helper — wraps the callback with the same mock methods
const mockTx = {
  identifierScheme: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  schemeQualifier: {
    deleteMany: jest.fn(),
  },
};

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock('../prisma', () => ({
  prisma: {
    identifierScheme: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockIdentifierScheme = prisma.identifierScheme as unknown as {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  delete: jest.Mock;
};

describe('identifier-scheme.repository', () => {
  const TENANT_ID = 'tenant-1';
  const REGISTRAR_ID = 'reg-1';
  const SCHEME_RECORD = {
    id: 'scheme-1',
    tenantId: TENANT_ID,
    registrarId: REGISTRAR_ID,
    name: 'GTIN',
    primaryKey: 'gtin',
    validationPattern: '^\\d{13,14}$',
    namespace: 'gs1',
    idrServiceInstanceId: null,
    isDefault: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    qualifiers: [
      {
        id: 'qual-1',
        schemeId: 'scheme-1',
        key: 'batch',
        description: 'Batch number',
        validationPattern: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      },
    ],
    registrar: {
      id: REGISTRAR_ID,
      tenantId: TENANT_ID,
      name: 'GS1',
      namespace: 'gs1',
      url: 'https://gs1.org',
      idrServiceInstanceId: null,
      isDefault: false,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createIdentifierScheme', () => {
    it('creates a scheme with qualifiers', async () => {
      mockIdentifierScheme.create.mockResolvedValue(SCHEME_RECORD);

      const result = await createIdentifierScheme({
        tenantId: TENANT_ID,
        registrarId: REGISTRAR_ID,
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{13,14}$',
        namespace: 'gs1',
        qualifiers: [{ key: 'batch', description: 'Batch number', validationPattern: '^[A-Za-z0-9]{1,20}$' }],
      });

      expect(mockIdentifierScheme.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          registrarId: REGISTRAR_ID,
          name: 'GTIN',
          primaryKey: 'gtin',
          validationPattern: '^\\d{13,14}$',
          namespace: 'gs1',
          isDefault: false,
          qualifiers: {
            create: [{ key: 'batch', description: 'Batch number', validationPattern: '^[A-Za-z0-9]{1,20}$' }],
          },
        }),
        include: {
          qualifiers: true,
          registrar: true,
        },
      });
      expect(result).toEqual(SCHEME_RECORD);
    });

    it('creates a scheme without qualifiers', async () => {
      const recordWithoutQualifiers = { ...SCHEME_RECORD, qualifiers: [] };
      mockIdentifierScheme.create.mockResolvedValue(recordWithoutQualifiers);

      await createIdentifierScheme({
        tenantId: TENANT_ID,
        registrarId: REGISTRAR_ID,
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{13,14}$',
      });

      expect(mockIdentifierScheme.create).toHaveBeenCalledWith({
        data: expect.not.objectContaining({
          qualifiers: expect.anything(),
        }),
        include: {
          qualifiers: true,
          registrar: true,
        },
      });
    });

    it('defaults isDefault to false when not provided', async () => {
      mockIdentifierScheme.create.mockResolvedValue(SCHEME_RECORD);

      await createIdentifierScheme({
        tenantId: TENANT_ID,
        registrarId: REGISTRAR_ID,
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{13,14}$',
      });

      expect(mockIdentifierScheme.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isDefault: false,
        }),
        include: expect.anything(),
      });
    });
  });

  describe('getIdentifierSchemeById', () => {
    it('returns the scheme if it belongs to the tenant', async () => {
      mockIdentifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);

      const result = await getIdentifierSchemeById('scheme-1', TENANT_ID);

      expect(mockIdentifierScheme.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'scheme-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
        },
        include: {
          qualifiers: true,
          registrar: true,
        },
      });
      expect(result).toEqual(SCHEME_RECORD);
    });

    it('returns a system default scheme', async () => {
      const systemScheme = { ...SCHEME_RECORD, tenantId: 'system', isDefault: true };
      mockIdentifierScheme.findFirst.mockResolvedValue(systemScheme);

      const result = await getIdentifierSchemeById('scheme-1', TENANT_ID);
      expect(result).toEqual(systemScheme);
    });

    it('returns null when scheme does not exist', async () => {
      mockIdentifierScheme.findFirst.mockResolvedValue(null);

      const result = await getIdentifierSchemeById('scheme-1', 'other-tenant');
      expect(result).toBeNull();
    });
  });

  describe('listIdentifierSchemes', () => {
    it('lists schemes for the tenant including system defaults', async () => {
      mockIdentifierScheme.findMany.mockResolvedValue([SCHEME_RECORD]);

      const result = await listIdentifierSchemes(TENANT_ID);

      expect(mockIdentifierScheme.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
        },
        include: {
          qualifiers: true,
          registrar: true,
        },
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([SCHEME_RECORD]);
    });

    it('filters by registrarId', async () => {
      mockIdentifierScheme.findMany.mockResolvedValue([]);

      await listIdentifierSchemes(TENANT_ID, { registrarId: REGISTRAR_ID });

      expect(mockIdentifierScheme.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            registrarId: REGISTRAR_ID,
          }),
        }),
      );
    });

    it('applies pagination', async () => {
      mockIdentifierScheme.findMany.mockResolvedValue([]);

      await listIdentifierSchemes(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockIdentifierScheme.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });
  });

  describe('updateIdentifierScheme', () => {
    it('updates name and validation pattern', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.identifierScheme.update.mockResolvedValue({
        ...SCHEME_RECORD,
        name: 'GTIN-14',
        validationPattern: '^\\d{14}$',
      });

      const result = await updateIdentifierScheme('scheme-1', TENANT_ID, {
        name: 'GTIN-14',
        validationPattern: '^\\d{14}$',
      });

      expect(mockTx.identifierScheme.findFirst).toHaveBeenCalledWith({
        where: { id: 'scheme-1', tenantId: TENANT_ID },
      });
      expect(mockTx.identifierScheme.update).toHaveBeenCalledWith({
        where: { id: 'scheme-1' },
        data: { name: 'GTIN-14', validationPattern: '^\\d{14}$' },
        include: {
          qualifiers: true,
          registrar: true,
        },
      });
      expect(result.name).toBe('GTIN-14');
    });

    it('replaces qualifiers when provided', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.schemeQualifier.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.identifierScheme.update.mockResolvedValue({
        ...SCHEME_RECORD,
        qualifiers: [
          {
            id: 'qual-2',
            schemeId: 'scheme-1',
            key: 'serial',
            description: 'Serial number',
            validationPattern: '^[A-Z0-9]+$',
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-01'),
          },
        ],
      });

      await updateIdentifierScheme('scheme-1', TENANT_ID, {
        qualifiers: [{ key: 'serial', description: 'Serial number', validationPattern: '^[A-Z0-9]+$' }],
      });

      expect(mockTx.schemeQualifier.deleteMany).toHaveBeenCalledWith({
        where: { schemeId: 'scheme-1' },
      });
      expect(mockTx.identifierScheme.update).toHaveBeenCalledWith({
        where: { id: 'scheme-1' },
        data: {
          qualifiers: {
            create: [{ key: 'serial', description: 'Serial number', validationPattern: '^[A-Z0-9]+$' }],
          },
        },
        include: {
          qualifiers: true,
          registrar: true,
        },
      });
    });

    it('allows setting idrServiceInstanceId to null', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue({ ...SCHEME_RECORD, idrServiceInstanceId: 'si-1' });
      mockTx.identifierScheme.update.mockResolvedValue({ ...SCHEME_RECORD, idrServiceInstanceId: null });

      await updateIdentifierScheme('scheme-1', TENANT_ID, { idrServiceInstanceId: null });

      expect(mockTx.identifierScheme.update).toHaveBeenCalledWith({
        where: { id: 'scheme-1' },
        data: { idrServiceInstanceId: null },
        include: {
          qualifiers: true,
          registrar: true,
        },
      });
    });

    it('throws if scheme does not belong to the tenant', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(null);

      await expect(updateIdentifierScheme('scheme-1', 'other-tenant', { name: 'New' })).rejects.toThrow(
        'Identifier scheme not found or access denied',
      );
    });
  });

  describe('deleteIdentifierScheme', () => {
    it('deletes a scheme owned by the tenant', async () => {
      mockIdentifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockIdentifierScheme.delete.mockResolvedValue(SCHEME_RECORD);

      const result = await deleteIdentifierScheme('scheme-1', TENANT_ID);

      expect(mockIdentifierScheme.findFirst).toHaveBeenCalledWith({
        where: { id: 'scheme-1', tenantId: TENANT_ID },
      });
      expect(mockIdentifierScheme.delete).toHaveBeenCalledWith({
        where: { id: 'scheme-1' },
      });
      expect(result).toEqual(SCHEME_RECORD);
    });

    it('throws if scheme does not belong to the tenant', async () => {
      mockIdentifierScheme.findFirst.mockResolvedValue(null);

      await expect(deleteIdentifierScheme('scheme-1', 'other-tenant')).rejects.toThrow(
        'Identifier scheme not found or access denied',
      );
    });
  });
});
