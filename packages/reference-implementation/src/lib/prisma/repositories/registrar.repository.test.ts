import {
  createRegistrar,
  getRegistrarById,
  listRegistrars,
  updateRegistrar,
  deleteRegistrar,
} from './registrar.repository';

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock('../prisma', () => ({
  prisma: {
    registrar: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockRegistrar = prisma.registrar as unknown as {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

describe('registrar.repository', () => {
  const TENANT_ID = 'tenant-1';
  const REGISTRAR_RECORD = {
    id: 'reg-1',
    tenantId: TENANT_ID,
    name: 'GS1',
    namespace: 'gs1',
    url: 'https://gs1.org',
    idrServiceInstanceId: null,
    isDefault: false,
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
          isDefault: false,
        }),
      });
      expect(result).toEqual(REGISTRAR_RECORD);
    });

    it('defaults isDefault to false when not provided', async () => {
      mockRegistrar.create.mockResolvedValue(REGISTRAR_RECORD);

      await createRegistrar({
        tenantId: TENANT_ID,
        name: 'GS1',
        namespace: 'gs1',
      });

      expect(mockRegistrar.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isDefault: false,
        }),
      });
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
  });

  describe('getRegistrarById', () => {
    it('returns the registrar if it belongs to the tenant', async () => {
      mockRegistrar.findFirst.mockResolvedValue(REGISTRAR_RECORD);

      const result = await getRegistrarById('reg-1', TENANT_ID);

      expect(mockRegistrar.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'reg-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
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
      const systemRegistrar = { ...REGISTRAR_RECORD, tenantId: 'system', isDefault: true };
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

      const result = await listRegistrars(TENANT_ID);

      expect(mockRegistrar.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
        },
        include: {
          schemes: {
            include: {
              qualifiers: true,
            },
          },
        },
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([REGISTRAR_RECORD]);
    });

    it('applies pagination', async () => {
      mockRegistrar.findMany.mockResolvedValue([]);

      await listRegistrars(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockRegistrar.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });
  });

  describe('updateRegistrar', () => {
    it('updates name and namespace', async () => {
      mockRegistrar.findFirst.mockResolvedValue(REGISTRAR_RECORD);
      mockRegistrar.update.mockResolvedValue({ ...REGISTRAR_RECORD, name: 'GS1 Updated', namespace: 'gs1-v2' });

      const result = await updateRegistrar('reg-1', TENANT_ID, {
        name: 'GS1 Updated',
        namespace: 'gs1-v2',
      });

      expect(mockRegistrar.findFirst).toHaveBeenCalledWith({
        where: { id: 'reg-1', tenantId: TENANT_ID },
      });
      expect(mockRegistrar.update).toHaveBeenCalledWith({
        where: { id: 'reg-1' },
        data: { name: 'GS1 Updated', namespace: 'gs1-v2' },
      });
      expect(result.name).toBe('GS1 Updated');
    });

    it('allows setting idrServiceInstanceId to null', async () => {
      mockRegistrar.findFirst.mockResolvedValue({ ...REGISTRAR_RECORD, idrServiceInstanceId: 'si-1' });
      mockRegistrar.update.mockResolvedValue({ ...REGISTRAR_RECORD, idrServiceInstanceId: null });

      await updateRegistrar('reg-1', TENANT_ID, { idrServiceInstanceId: null });

      expect(mockRegistrar.update).toHaveBeenCalledWith({
        where: { id: 'reg-1' },
        data: { idrServiceInstanceId: null },
      });
    });

    it('throws if registrar does not belong to the tenant', async () => {
      mockRegistrar.findFirst.mockResolvedValue(null);

      await expect(updateRegistrar('reg-1', 'other-tenant', { name: 'New' })).rejects.toThrow(
        'Registrar not found or access denied',
      );
    });

    it('does not allow updating system defaults', async () => {
      // findFirst with tenantId filter excludes system defaults
      mockRegistrar.findFirst.mockResolvedValue(null);

      await expect(updateRegistrar('reg-1', TENANT_ID, { name: 'New' })).rejects.toThrow(
        'Registrar not found or access denied',
      );
    });
  });

  describe('deleteRegistrar', () => {
    it('deletes a registrar owned by the tenant', async () => {
      mockRegistrar.findFirst.mockResolvedValue(REGISTRAR_RECORD);
      mockRegistrar.delete.mockResolvedValue(REGISTRAR_RECORD);

      const result = await deleteRegistrar('reg-1', TENANT_ID);

      expect(mockRegistrar.findFirst).toHaveBeenCalledWith({
        where: { id: 'reg-1', tenantId: TENANT_ID },
      });
      expect(mockRegistrar.delete).toHaveBeenCalledWith({
        where: { id: 'reg-1' },
      });
      expect(result).toEqual(REGISTRAR_RECORD);
    });

    it('throws if registrar does not belong to the tenant', async () => {
      mockRegistrar.findFirst.mockResolvedValue(null);

      await expect(deleteRegistrar('reg-1', 'other-tenant')).rejects.toThrow('Registrar not found or access denied');
    });
  });
});
