import {
  createRegistrar,
  getRegistrarById,
  listRegistrars,
  updateRegistrar,
  deleteRegistrar,
} from './registrar.repository';
import { ConflictError, NotFoundError, ServiceInstanceNotFoundError } from '@/lib/api/errors';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import { SYSTEM_TENANT_ID } from '../constants';

// Transaction mock — functions called via $transaction callback
const mockTx = {
  registrar: {
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock('../prisma', () => ({
  prisma: {
    registrar: {
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

const mockRegistrar = prisma.registrar as unknown as {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
};

function prismaRecordNotFoundError(): Error {
  const error = new Error(
    'An operation failed because it depends on one or more records that were required but not found.',
  );
  error.name = 'PrismaClientKnownRequestError';
  Object.assign(error, { code: 'P2025', clientVersion: '6.0.0' });
  return error;
}

// Mirrors Prisma's documented P2003 shape: the violated field is embedded in
// the message ("Foreign key constraint failed on the field: `{field_name}`",
// https://www.prisma.io/docs/orm/reference/error-reference#p2003) and carried
// in meta (on PostgreSQL as the constraint name). The column parameter lets a
// test fabricate a violation on either of the Registrar insert's two foreign
// keys, since the repository must attribute its message only to the
// idrServiceInstanceId one.
function prismaForeignKeyViolationError(column = 'idrServiceInstanceId'): Error {
  const error = new Error(`Foreign key constraint failed on the field: \`${column}\``);
  error.name = 'PrismaClientKnownRequestError';
  Object.assign(error, {
    code: 'P2003',
    clientVersion: '6.0.0',
    meta: { field_name: `Registrar_${column}_fkey (index)` },
  });
  return error;
}

describe('registrar.repository', () => {
  const TENANT_ID = 'tenant-1';
  const REGISTRAR_RECORD = {
    id: 'reg-1',
    tenantId: TENANT_ID,
    name: 'GS1',
    namespace: 'gs1',
    url: 'https://gs1.org',
    idrServiceInstanceId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    schemes: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createRegistrar', () => {
    it('creates a registrar with provided fields', async () => {
      mockRegistrar.create.mockResolvedValue(REGISTRAR_RECORD);

      const result = await createRegistrar({
        tenantId: TENANT_ID,
        name: 'GS1',
        namespace: 'gs1',
        url: 'https://gs1.org',
      });

      expect(mockRegistrar.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          name: 'GS1',
          namespace: 'gs1',
          url: 'https://gs1.org',
        }),
      });
      expect(result).toEqual(REGISTRAR_RECORD);
    });

    it('passes idrServiceInstanceId when provided', async () => {
      mockRegistrar.create.mockResolvedValue({ ...REGISTRAR_RECORD, idrServiceInstanceId: 'si-1' });

      await createRegistrar({
        tenantId: TENANT_ID,
        name: 'GS1',
        namespace: 'gs1',
        idrServiceInstanceId: 'si-1',
      });

      expect(mockRegistrar.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          idrServiceInstanceId: 'si-1',
        }),
      });
    });

    it('maps a foreign-key violation on idrServiceInstanceId to the 404 the pre-check produces', async () => {
      mockRegistrar.create.mockRejectedValue(prismaForeignKeyViolationError());

      const result = createRegistrar({
        tenantId: TENANT_ID,
        name: 'GS1',
        namespace: 'gs1',
        idrServiceInstanceId: 'nonexistent-si',
      });

      await expect(result).rejects.toThrow(ServiceInstanceNotFoundError);
      await expect(result).rejects.toThrow('Service instance not found: nonexistent-si');
    });

    it('rethrows a foreign-key violation on tenantId rather than blaming the IDR instance', async () => {
      // The insert carries two foreign keys; a violation on tenantId (a tenant
      // deleted between auth resolution and the insert) must not surface with
      // the idrServiceInstanceId-specific message.
      const tenantFkError = prismaForeignKeyViolationError('tenantId');
      mockRegistrar.create.mockRejectedValue(tenantFkError);

      const result = createRegistrar({
        tenantId: TENANT_ID,
        name: 'GS1',
        namespace: 'gs1',
      });

      // Identity assertion: the original engine error is rethrown unchanged,
      // not replaced by the instance-specific error.
      await expect(result).rejects.toBe(tenantFkError);
    });

    it('rethrows a non-database error unchanged', async () => {
      const connectionError = new Error('connection lost');
      mockRegistrar.create.mockRejectedValue(connectionError);

      await expect(createRegistrar({ tenantId: TENANT_ID, name: 'GS1', namespace: 'gs1' })).rejects.toThrow(
        connectionError,
      );
    });
  });

  describe('getRegistrarById', () => {
    it('returns the registrar if it belongs to the tenant', async () => {
      mockRegistrar.findFirst.mockResolvedValue(REGISTRAR_RECORD);

      const result = await getRegistrarById('reg-1', TENANT_ID);

      expect(mockRegistrar.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'reg-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
        include: {
          schemes: {
            include: {
              qualifiers: true,
            },
          },
        },
      });
      expect(result).toEqual(REGISTRAR_RECORD);
    });

    it('returns a system default registrar', async () => {
      const systemRegistrar = { ...REGISTRAR_RECORD, tenantId: SYSTEM_TENANT_ID };
      mockRegistrar.findFirst.mockResolvedValue(systemRegistrar);

      const result = await getRegistrarById('reg-1', TENANT_ID);
      expect(result).toEqual(systemRegistrar);
    });

    it('returns null when registrar does not exist', async () => {
      mockRegistrar.findFirst.mockResolvedValue(null);

      const result = await getRegistrarById('reg-1', 'other-tenant');
      expect(result).toBeNull();
    });
  });

  describe('listRegistrars', () => {
    it('lists registrars for the tenant including system defaults', async () => {
      mockRegistrar.findMany.mockResolvedValue([REGISTRAR_RECORD]);
      mockRegistrar.count.mockResolvedValue(1);

      const result = await listRegistrars(TENANT_ID);

      expect(mockRegistrar.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
        take: DEFAULT_PAGE_LIMIT,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockRegistrar.count).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
      });
      expect(result.data).toEqual([REGISTRAR_RECORD]);
      expect(result.total).toBe(1);
    });

    it('applies pagination', async () => {
      mockRegistrar.findMany.mockResolvedValue([]);
      mockRegistrar.count.mockResolvedValue(0);

      const result = await listRegistrars(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockRegistrar.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('updateRegistrar', () => {
    it('updates name and namespace', async () => {
      mockTx.registrar.findFirst.mockResolvedValue(REGISTRAR_RECORD);
      mockTx.registrar.update.mockResolvedValue({ ...REGISTRAR_RECORD, name: 'GS1 Updated', namespace: 'gs1-v2' });

      const result = await updateRegistrar('reg-1', TENANT_ID, {
        name: 'GS1 Updated',
        namespace: 'gs1-v2',
      });

      expect(mockTx.registrar.findFirst).toHaveBeenCalledWith({
        where: { id: 'reg-1', tenantId: TENANT_ID },
      });
      expect(mockTx.registrar.update).toHaveBeenCalledWith({
        where: { id: 'reg-1' },
        data: { name: 'GS1 Updated', namespace: 'gs1-v2' },
      });
      expect(result.name).toBe('GS1 Updated');
    });

    it('allows setting idrServiceInstanceId to null', async () => {
      mockTx.registrar.findFirst.mockResolvedValue({ ...REGISTRAR_RECORD, idrServiceInstanceId: 'si-1' });
      mockTx.registrar.update.mockResolvedValue({ ...REGISTRAR_RECORD, idrServiceInstanceId: null });

      await updateRegistrar('reg-1', TENANT_ID, { idrServiceInstanceId: null });

      expect(mockTx.registrar.update).toHaveBeenCalledWith({
        where: { id: 'reg-1' },
        data: { idrServiceInstanceId: null },
      });
    });

    it('throws if registrar does not belong to the tenant', async () => {
      mockTx.registrar.findFirst.mockResolvedValue(null);

      await expect(updateRegistrar('reg-1', 'other-tenant', { name: 'New' })).rejects.toThrow('Registrar not found');
    });

    it('does not allow updating system defaults', async () => {
      // findFirst with tenantId filter excludes system defaults
      mockTx.registrar.findFirst.mockResolvedValue(null);

      await expect(updateRegistrar('reg-1', TENANT_ID, { name: 'New' })).rejects.toThrow('Registrar not found');
    });

    it('maps a foreign-key violation on idrServiceInstanceId to the 404 the pre-check produces', async () => {
      mockTx.registrar.findFirst.mockResolvedValue(REGISTRAR_RECORD);
      mockTx.registrar.update.mockRejectedValue(prismaForeignKeyViolationError());

      const result = updateRegistrar('reg-1', TENANT_ID, { idrServiceInstanceId: 'nonexistent-si' });

      await expect(result).rejects.toThrow(ServiceInstanceNotFoundError);
      await expect(result).rejects.toThrow('Service instance not found: nonexistent-si');
    });

    it('rethrows a foreign-key violation on another column rather than blaming the IDR instance', async () => {
      mockTx.registrar.findFirst.mockResolvedValue(REGISTRAR_RECORD);
      const tenantFkError = prismaForeignKeyViolationError('tenantId');
      mockTx.registrar.update.mockRejectedValue(tenantFkError);

      const result = updateRegistrar('reg-1', TENANT_ID, { name: 'GS1 Updated' });

      await expect(result).rejects.toBe(tenantFkError);
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      mockTx.registrar.findFirst.mockResolvedValue(REGISTRAR_RECORD);
      mockTx.registrar.update.mockRejectedValue(prismaRecordNotFoundError());

      const result = updateRegistrar('reg-1', TENANT_ID, { name: 'GS1 Updated' });

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Registrar not found');
    });
  });

  describe('deleteRegistrar', () => {
    it('deletes a registrar owned by the tenant', async () => {
      mockTx.registrar.findFirst.mockResolvedValue(REGISTRAR_RECORD);
      mockTx.registrar.delete.mockResolvedValue(REGISTRAR_RECORD);

      const result = await deleteRegistrar('reg-1', TENANT_ID);

      expect(mockTx.registrar.findFirst).toHaveBeenCalledWith({
        where: { id: 'reg-1', tenantId: TENANT_ID },
      });
      expect(mockTx.registrar.delete).toHaveBeenCalledWith({
        where: { id: 'reg-1' },
      });
      expect(result).toEqual(REGISTRAR_RECORD);
    });

    it('throws if registrar does not belong to the tenant', async () => {
      mockTx.registrar.findFirst.mockResolvedValue(null);

      await expect(deleteRegistrar('reg-1', 'other-tenant')).rejects.toThrow('Registrar not found');
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      mockTx.registrar.findFirst.mockResolvedValue(REGISTRAR_RECORD);
      mockTx.registrar.delete.mockRejectedValue(prismaRecordNotFoundError());

      const result = deleteRegistrar('reg-1', TENANT_ID);

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Registrar not found');
    });

    it('maps a foreign-key violation to ConflictError when schemes still have identifiers', async () => {
      mockTx.registrar.findFirst.mockResolvedValue(REGISTRAR_RECORD);
      mockTx.registrar.delete.mockRejectedValue(prismaForeignKeyViolationError());

      const result = deleteRegistrar('reg-1', TENANT_ID);

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow('The registrar has schemes with identifiers and cannot be deleted');
    });
  });
});
