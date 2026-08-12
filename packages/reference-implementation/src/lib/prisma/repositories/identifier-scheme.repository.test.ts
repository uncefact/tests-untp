import {
  createIdentifierScheme,
  getIdentifierSchemeById,
  listIdentifierSchemes,
  updateIdentifierScheme,
  deleteIdentifierScheme,
} from './identifier-scheme.repository';
import { ConflictError, NotFoundError, ServiceInstanceNotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import { SYSTEM_TENANT_ID } from '../constants';

// Transaction mock helper — wraps the callback with the same mock methods
const mockTx = {
  identifierScheme: {
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  schemeQualifier: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock('../prisma', () => ({
  prisma: {
    identifierScheme: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';
import {
  prismaUniqueConstraintError,
  prismaForeignKeyViolationError,
  prismaRecordNotFoundError,
} from '../db-errors.fixtures';

const mockIdentifierScheme = prisma.identifierScheme as unknown as {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
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
    linkTemplate: '/{primaryKey}/{value}',
    idrServiceInstanceId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    qualifiers: [
      {
        id: 'qual-1',
        schemeId: 'scheme-1',
        key: 'batch',
        description: 'Batch number',
        validationPattern: null,
        order: 0,
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
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [{ key: 'batch', description: 'Batch number', validationPattern: '^[A-Za-z0-9]{1,20}$' }],
      });

      expect(mockIdentifierScheme.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          registrarId: REGISTRAR_ID,
          name: 'GTIN',
          primaryKey: 'gtin',
          validationPattern: '^\\d{13,14}$',
          linkTemplate: '/{primaryKey}/{value}',
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
        linkTemplate: '/{primaryKey}/{value}',
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

    it('maps a unique-constraint violation to ConflictError with a clean message', async () => {
      mockIdentifierScheme.create.mockRejectedValue(prismaUniqueConstraintError());

      const result = createIdentifierScheme({
        tenantId: TENANT_ID,
        registrarId: REGISTRAR_ID,
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{13,14}$',
        linkTemplate: '/{primaryKey}/{value}',
      });

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow(
        'An identifier scheme with this primary key already exists for the registrar',
      );
    });

    it('maps a foreign-key violation on registrarId to the 404 the pre-check produces', async () => {
      mockIdentifierScheme.create.mockRejectedValue(
        prismaForeignKeyViolationError('Foreign key constraint failed on the field: `registrarId`'),
      );

      const result = createIdentifierScheme({
        tenantId: TENANT_ID,
        registrarId: 'nonexistent-registrar',
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{13,14}$',
        linkTemplate: '/{primaryKey}/{value}',
      });

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Registrar not found');
    });

    it('maps a foreign-key violation on idrServiceInstanceId to the 404 the pre-check produces', async () => {
      mockIdentifierScheme.create.mockRejectedValue(
        prismaForeignKeyViolationError('Foreign key constraint failed on the field: `idrServiceInstanceId`'),
      );

      const result = createIdentifierScheme({
        tenantId: TENANT_ID,
        registrarId: REGISTRAR_ID,
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{13,14}$',
        linkTemplate: '/{primaryKey}/{value}',
        idrServiceInstanceId: 'nonexistent-si',
      });

      await expect(result).rejects.toThrow(ServiceInstanceNotFoundError);
      await expect(result).rejects.toThrow('Service instance not found: nonexistent-si');
    });

    it('rethrows a foreign-key violation on tenantId rather than blaming a reference', async () => {
      const tenantFkError = prismaForeignKeyViolationError('Foreign key constraint failed on the field: `tenantId`');
      mockIdentifierScheme.create.mockRejectedValue(tenantFkError);

      const result = createIdentifierScheme({
        tenantId: TENANT_ID,
        registrarId: REGISTRAR_ID,
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{13,14}$',
        linkTemplate: '/{primaryKey}/{value}',
      });

      await expect(result).rejects.toBe(tenantFkError);
    });

    it('rejects duplicate qualifier keys without hitting the database', async () => {
      const result = createIdentifierScheme({
        tenantId: TENANT_ID,
        registrarId: REGISTRAR_ID,
        name: 'GTIN',
        primaryKey: 'gtin',
        validationPattern: '^\\d{13,14}$',
        linkTemplate: '/{primaryKey}/{value}',
        qualifiers: [
          { key: 'batch', description: 'Batch number', validationPattern: '^[A-Za-z0-9]{1,20}$' },
          { key: 'batch', description: 'Duplicate batch', validationPattern: '^[A-Za-z0-9]{1,20}$' },
        ],
      });

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('Qualifier keys must be unique');
      expect(mockIdentifierScheme.create).not.toHaveBeenCalled();
    });

    it('rethrows a non-database error unchanged', async () => {
      const connectionError = new Error('connection lost');
      mockIdentifierScheme.create.mockRejectedValue(connectionError);

      await expect(
        createIdentifierScheme({
          tenantId: TENANT_ID,
          registrarId: REGISTRAR_ID,
          name: 'GTIN',
          primaryKey: 'gtin',
          validationPattern: '^\\d{13,14}$',
          linkTemplate: '/{primaryKey}/{value}',
        }),
      ).rejects.toThrow(connectionError);
    });
  });

  describe('getIdentifierSchemeById', () => {
    it('returns the scheme if it belongs to the tenant', async () => {
      mockIdentifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);

      const result = await getIdentifierSchemeById('scheme-1', TENANT_ID);

      expect(mockIdentifierScheme.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'scheme-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
        include: {
          qualifiers: true,
          registrar: true,
        },
      });
      expect(result).toEqual(SCHEME_RECORD);
    });

    it('returns a system default scheme', async () => {
      const systemScheme = { ...SCHEME_RECORD, tenantId: SYSTEM_TENANT_ID };
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
      mockIdentifierScheme.count.mockResolvedValue(1);

      const result = await listIdentifierSchemes(TENANT_ID);

      expect(mockIdentifierScheme.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
        include: {
          qualifiers: true,
        },
        take: DEFAULT_PAGE_LIMIT,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockIdentifierScheme.count).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
      });
      expect(result).toEqual({ data: [SCHEME_RECORD], total: 1 });
    });

    it('filters by registrarId', async () => {
      mockIdentifierScheme.findMany.mockResolvedValue([]);
      mockIdentifierScheme.count.mockResolvedValue(0);

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
      mockIdentifierScheme.count.mockResolvedValue(0);

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
      mockTx.schemeQualifier.createMany.mockResolvedValue({ count: 1 });
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
      expect(mockTx.schemeQualifier.createMany).toHaveBeenCalledWith({
        data: [{ schemeId: 'scheme-1', key: 'serial', description: 'Serial number', validationPattern: '^[A-Z0-9]+$' }],
      });
      expect(mockTx.identifierScheme.update).toHaveBeenCalledWith({
        where: { id: 'scheme-1' },
        data: {},
        include: {
          qualifiers: true,
          registrar: true,
        },
      });
    });

    it('does not call schemeQualifier.createMany when qualifiers is an empty array', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.schemeQualifier.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.identifierScheme.update.mockResolvedValue({ ...SCHEME_RECORD, qualifiers: [] });

      await updateIdentifierScheme('scheme-1', TENANT_ID, { qualifiers: [] });

      expect(mockTx.schemeQualifier.deleteMany).toHaveBeenCalledWith({
        where: { schemeId: 'scheme-1' },
      });
      expect(mockTx.schemeQualifier.createMany).not.toHaveBeenCalled();
    });

    it('maps a unique-constraint violation on qualifier creation to ConflictError with a clean message', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.schemeQualifier.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.schemeQualifier.createMany.mockRejectedValue(prismaUniqueConstraintError());

      const result = updateIdentifierScheme('scheme-1', TENANT_ID, {
        qualifiers: [{ key: 'serial', description: 'Serial number', validationPattern: '^[A-Z0-9]+$' }],
      });

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow('A qualifier with this key already exists for the scheme');
      expect(mockTx.identifierScheme.update).not.toHaveBeenCalled();
    });

    it('maps a foreign-key violation on qualifier creation to the 404 the pre-check produces', async () => {
      // The scheme passed the findFirst pre-check but was deleted by a
      // concurrent request before the qualifier insert.
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.schemeQualifier.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.schemeQualifier.createMany.mockRejectedValue(prismaForeignKeyViolationError());

      const result = updateIdentifierScheme('scheme-1', TENANT_ID, {
        qualifiers: [{ key: 'serial', description: 'Serial number', validationPattern: '^[A-Z0-9]+$' }],
      });

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Identifier scheme not found');
      expect(mockTx.identifierScheme.update).not.toHaveBeenCalled();
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
        'Identifier scheme not found',
      );
    });

    it('maps a unique-constraint violation to ConflictError with a clean message', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.identifierScheme.update.mockRejectedValue(prismaUniqueConstraintError());

      const result = updateIdentifierScheme('scheme-1', TENANT_ID, { primaryKey: 'gtin-14' });

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow(
        'An identifier scheme with this primary key already exists for the registrar',
      );
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.identifierScheme.update.mockRejectedValue(prismaRecordNotFoundError());

      const result = updateIdentifierScheme('scheme-1', TENANT_ID, { name: 'GTIN-14' });

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Identifier scheme not found');
    });

    it('maps a foreign-key violation on idrServiceInstanceId to the 404 the pre-check produces', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.identifierScheme.update.mockRejectedValue(
        prismaForeignKeyViolationError('Foreign key constraint failed on the field: `idrServiceInstanceId`'),
      );

      const result = updateIdentifierScheme('scheme-1', TENANT_ID, { idrServiceInstanceId: 'nonexistent-si' });

      await expect(result).rejects.toThrow(ServiceInstanceNotFoundError);
      await expect(result).rejects.toThrow('Service instance not found: nonexistent-si');
    });

    it('rejects duplicate qualifier keys without hitting the database', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);

      const result = updateIdentifierScheme('scheme-1', TENANT_ID, {
        qualifiers: [
          { key: 'serial', description: 'Serial number', validationPattern: '^[A-Z0-9]+$' },
          { key: 'serial', description: 'Duplicate serial', validationPattern: '^[A-Z0-9]+$' },
        ],
      });

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('Qualifier keys must be unique');
      expect(mockTx.schemeQualifier.deleteMany).not.toHaveBeenCalled();
      expect(mockTx.schemeQualifier.createMany).not.toHaveBeenCalled();
      expect(mockTx.identifierScheme.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteIdentifierScheme', () => {
    it('deletes a scheme owned by the tenant', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.identifierScheme.delete.mockResolvedValue(SCHEME_RECORD);

      const result = await deleteIdentifierScheme('scheme-1', TENANT_ID);

      expect(mockTx.identifierScheme.findFirst).toHaveBeenCalledWith({
        where: { id: 'scheme-1', tenantId: TENANT_ID },
      });
      expect(mockTx.identifierScheme.delete).toHaveBeenCalledWith({
        where: { id: 'scheme-1' },
      });
      expect(result).toEqual(SCHEME_RECORD);
    });

    it('throws if scheme does not belong to the tenant', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(null);

      await expect(deleteIdentifierScheme('scheme-1', 'other-tenant')).rejects.toThrow('Identifier scheme not found');
    });

    it('maps a foreign-key violation to ConflictError when identifiers still reference the scheme', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.identifierScheme.delete.mockRejectedValue(prismaForeignKeyViolationError());

      const result = deleteIdentifierScheme('scheme-1', TENANT_ID);

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow('The identifier scheme has identifiers and cannot be deleted');
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      mockTx.identifierScheme.delete.mockRejectedValue(prismaRecordNotFoundError());

      const result = deleteIdentifierScheme('scheme-1', TENANT_ID);

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Identifier scheme not found');
    });

    it('rejects a unique-constraint violation with the original error (uncovered code)', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      const dbError = prismaUniqueConstraintError();
      mockTx.identifierScheme.delete.mockRejectedValue(dbError);

      await expect(deleteIdentifierScheme('scheme-1', TENANT_ID)).rejects.toBe(dbError);
    });

    it('rethrows a non-database error unchanged', async () => {
      mockTx.identifierScheme.findFirst.mockResolvedValue(SCHEME_RECORD);
      const dbError = new Error('connection lost');
      mockTx.identifierScheme.delete.mockRejectedValue(dbError);

      await expect(deleteIdentifierScheme('scheme-1', TENANT_ID)).rejects.toBe(dbError);
    });
  });
});
