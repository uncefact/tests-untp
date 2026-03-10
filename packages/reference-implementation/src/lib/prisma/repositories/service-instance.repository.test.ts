import {
  createServiceInstance,
  getServiceInstanceById,
  listServiceInstances,
  updateServiceInstance,
  deleteServiceInstance,
  countServiceInstanceReferences,
  getInstanceByResolution,
} from './service-instance.repository';
import { SYSTEM_TENANT_ID } from '../constants';

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
const mockServiceInstance = {
  create: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  delete: jest.fn(),
};

jest.mock('../prisma', () => ({
  prisma: {
    serviceInstance: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    did: { count: jest.fn() },
    registrar: { count: jest.fn() },
    identifierScheme: { count: jest.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: jest.fn((fn: any) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const prismaMock = require('../prisma').prisma;
      return fn({ serviceInstance: prismaMock.serviceInstance });
    }),
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

// Re-assign for easier access in tests
Object.assign(mockServiceInstance, prisma.serviceInstance);

describe('service-instance.repository', () => {
  const ORG_ID = 'org-1';
  const INSTANCE_RECORD = {
    id: 'instance-1',
    tenantId: ORG_ID,
    serviceType: 'VC',
    adapterType: 'VCKIT',
    name: 'Test VCKit Instance',
    description: null,
    config: 'encrypted-config-blob',
    isPrimary: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createServiceInstance', () => {
    it('creates with provided fields', async () => {
      mockServiceInstance.create.mockResolvedValue(INSTANCE_RECORD);

      const result = await createServiceInstance({
        tenantId: ORG_ID,
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'Test VCKit Instance',
        config: 'encrypted-config-blob',
      });

      expect(mockServiceInstance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: ORG_ID,
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: 'Test VCKit Instance',
          config: 'encrypted-config-blob',
          isPrimary: false,
        }),
      });
      expect(result).toEqual(INSTANCE_RECORD);
    });

    it('defaults isPrimary to false', async () => {
      mockServiceInstance.create.mockResolvedValue(INSTANCE_RECORD);

      await createServiceInstance({
        tenantId: ORG_ID,
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'Test',
        config: 'encrypted',
      });

      expect(mockServiceInstance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isPrimary: false,
        }),
      });
    });

    it('unsets existing primary when isPrimary is true', async () => {
      const primaryRecord = { ...INSTANCE_RECORD, isPrimary: true };
      mockServiceInstance.updateMany.mockResolvedValue({ count: 1 });
      mockServiceInstance.create.mockResolvedValue(primaryRecord);

      await createServiceInstance({
        tenantId: ORG_ID,
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'Primary Instance',
        config: 'encrypted',
        isPrimary: true,
      });

      expect(mockServiceInstance.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: ORG_ID,
          serviceType: 'VC',
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
      expect(mockServiceInstance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isPrimary: true,
        }),
      });
    });
  });

  describe('getServiceInstanceById', () => {
    it('returns instance for own organisation', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);

      const result = await getServiceInstanceById('instance-1', ORG_ID);

      expect(mockServiceInstance.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'instance-1',
          OR: [{ tenantId: ORG_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
      });
      expect(result).toEqual(INSTANCE_RECORD);
    });

    it('returns system default', async () => {
      const systemRecord = { ...INSTANCE_RECORD, tenantId: SYSTEM_TENANT_ID };
      mockServiceInstance.findFirst.mockResolvedValue(systemRecord);

      const result = await getServiceInstanceById('instance-1', ORG_ID);

      expect(result).toEqual(systemRecord);
    });

    it('returns null for other organisation', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      const result = await getServiceInstanceById('instance-1', 'other-org');
      expect(result).toBeNull();
    });

    it('overrides system default isPrimary when tenant has own primary for same serviceType', async () => {
      const systemRecord = { ...INSTANCE_RECORD, tenantId: SYSTEM_TENANT_ID, isPrimary: true, serviceType: 'VC' };
      const tenantPrimary = { ...INSTANCE_RECORD, id: 'tenant-vc', tenantId: ORG_ID, isPrimary: true };
      // First call: getServiceInstanceById lookup
      mockServiceInstance.findFirst.mockResolvedValueOnce(systemRecord);
      // Second call: applyTenantPrimaryOverride lookup
      mockServiceInstance.findFirst.mockResolvedValueOnce(tenantPrimary);

      const result = await getServiceInstanceById('instance-1', ORG_ID);

      expect(result).toEqual({ ...systemRecord, isPrimary: false });
    });

    it('keeps system default isPrimary when tenant has no primary for same serviceType', async () => {
      const systemRecord = { ...INSTANCE_RECORD, tenantId: SYSTEM_TENANT_ID, isPrimary: true, serviceType: 'VC' };
      // First call: getServiceInstanceById lookup
      mockServiceInstance.findFirst.mockResolvedValueOnce(systemRecord);
      // Second call: applyTenantPrimaryOverride lookup — no tenant primary
      mockServiceInstance.findFirst.mockResolvedValueOnce(null);

      const result = await getServiceInstanceById('instance-1', ORG_ID);

      expect(result).toEqual(systemRecord);
    });
  });

  describe('listServiceInstances', () => {
    it('lists for organisation including system defaults', async () => {
      // First findMany: data query; second findMany: tenant primaries query
      mockServiceInstance.findMany.mockResolvedValueOnce([INSTANCE_RECORD]);
      mockServiceInstance.findMany.mockResolvedValueOnce([]);
      mockServiceInstance.count.mockResolvedValue(1);

      const result = await listServiceInstances(ORG_ID);

      expect(mockServiceInstance.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: ORG_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockServiceInstance.count).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: ORG_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
      });
      expect(result.data).toEqual([INSTANCE_RECORD]);
      expect(result.total).toBe(1);
    });

    it('applies serviceType filter', async () => {
      mockServiceInstance.findMany.mockResolvedValueOnce([]);
      mockServiceInstance.findMany.mockResolvedValueOnce([]);
      mockServiceInstance.count.mockResolvedValue(0);

      const result = await listServiceInstances(ORG_ID, { serviceType: 'VC' });

      expect(mockServiceInstance.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          serviceType: 'VC',
        }),
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('applies adapterType filter', async () => {
      mockServiceInstance.findMany.mockResolvedValueOnce([]);
      mockServiceInstance.findMany.mockResolvedValueOnce([]);
      mockServiceInstance.count.mockResolvedValue(0);

      const result = await listServiceInstances(ORG_ID, { adapterType: 'VCKIT' });

      expect(mockServiceInstance.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          adapterType: 'VCKIT',
        }),
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('applies pagination', async () => {
      mockServiceInstance.findMany.mockResolvedValueOnce([]);
      mockServiceInstance.findMany.mockResolvedValueOnce([]);
      mockServiceInstance.count.mockResolvedValue(0);

      const result = await listServiceInstances(ORG_ID, { limit: 10, offset: 20 });

      expect(mockServiceInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('overrides system default isPrimary when tenant has own primary for same serviceType', async () => {
      const systemVc = {
        ...INSTANCE_RECORD,
        id: 'sys-vc',
        tenantId: SYSTEM_TENANT_ID,
        serviceType: 'VC',
        isPrimary: true,
      };
      const systemIdr = {
        ...INSTANCE_RECORD,
        id: 'sys-idr',
        tenantId: SYSTEM_TENANT_ID,
        serviceType: 'IDR',
        isPrimary: true,
      };
      const tenantVc = { ...INSTANCE_RECORD, id: 'tenant-vc', tenantId: ORG_ID, serviceType: 'VC', isPrimary: true };

      // First findMany: data query; second findMany: tenant primaries query
      mockServiceInstance.findMany.mockResolvedValueOnce([tenantVc, systemVc, systemIdr]);
      mockServiceInstance.findMany.mockResolvedValueOnce([{ serviceType: 'VC' }]);
      mockServiceInstance.count.mockResolvedValue(3);

      const result = await listServiceInstances(ORG_ID);

      // System VC should be overridden (tenant has VC primary), system IDR should stay primary
      expect(result.data[0]).toEqual(tenantVc);
      expect(result.data[1]).toEqual({ ...systemVc, isPrimary: false });
      expect(result.data[2]).toEqual(systemIdr);
    });

    it('overrides correctly even when tenant primary is on a different page', async () => {
      const systemVc = {
        ...INSTANCE_RECORD,
        id: 'sys-vc',
        tenantId: SYSTEM_TENANT_ID,
        serviceType: 'VC',
        isPrimary: true,
      };

      // Data query returns only system default (tenant primary on another page)
      mockServiceInstance.findMany.mockResolvedValueOnce([systemVc]);
      // Tenant primaries query finds the primary across all pages
      mockServiceInstance.findMany.mockResolvedValueOnce([{ serviceType: 'VC' }]);
      mockServiceInstance.count.mockResolvedValue(2);

      const result = await listServiceInstances(ORG_ID, { limit: 1, offset: 0 });

      expect(result.data[0]).toEqual({ ...systemVc, isPrimary: false });
    });

    it('keeps system default isPrimary when tenant has no primary', async () => {
      const systemVc = {
        ...INSTANCE_RECORD,
        id: 'sys-vc',
        tenantId: SYSTEM_TENANT_ID,
        serviceType: 'VC',
        isPrimary: true,
      };

      mockServiceInstance.findMany.mockResolvedValueOnce([systemVc]);
      mockServiceInstance.findMany.mockResolvedValueOnce([]);
      mockServiceInstance.count.mockResolvedValue(1);

      const result = await listServiceInstances(ORG_ID);

      expect(result.data[0]).toEqual(systemVc);
    });
  });

  describe('updateServiceInstance', () => {
    it('updates fields', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);
      mockServiceInstance.update.mockResolvedValue({
        ...INSTANCE_RECORD,
        name: 'Updated Name',
        description: 'New description',
      });

      const result = await updateServiceInstance('instance-1', ORG_ID, {
        name: 'Updated Name',
        description: 'New description',
      });

      expect(mockServiceInstance.update).toHaveBeenCalledWith({
        where: { id: 'instance-1' },
        data: { name: 'Updated Name', description: 'New description' },
      });
      expect(result.name).toBe('Updated Name');
    });

    it('throws for non-existent instance', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      await expect(updateServiceInstance('non-existent', ORG_ID, { name: 'New' })).rejects.toThrow(
        'Service instance not found or access denied',
      );
    });

    it('throws for system defaults (organisation mismatch)', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      await expect(updateServiceInstance('instance-1', 'other-org', { name: 'New' })).rejects.toThrow(
        'Service instance not found or access denied',
      );
    });

    it('unsets existing primary when setting isPrimary', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);
      mockServiceInstance.updateMany.mockResolvedValue({ count: 1 });
      mockServiceInstance.update.mockResolvedValue({
        ...INSTANCE_RECORD,
        isPrimary: true,
      });

      await updateServiceInstance('instance-1', ORG_ID, { isPrimary: true });

      expect(mockServiceInstance.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: ORG_ID,
          serviceType: 'VC',
          isPrimary: true,
          NOT: { id: 'instance-1' },
        },
        data: { isPrimary: false },
      });
      expect(mockServiceInstance.update).toHaveBeenCalledWith({
        where: { id: 'instance-1' },
        data: { isPrimary: true },
      });
    });
  });

  describe('deleteServiceInstance', () => {
    it('deletes owned instance', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);
      mockServiceInstance.delete.mockResolvedValue(INSTANCE_RECORD);

      const result = await deleteServiceInstance('instance-1', ORG_ID);

      expect(mockServiceInstance.findFirst).toHaveBeenCalledWith({
        where: { id: 'instance-1', tenantId: ORG_ID },
      });
      expect(mockServiceInstance.delete).toHaveBeenCalledWith({
        where: { id: 'instance-1' },
      });
      expect(result).toEqual(INSTANCE_RECORD);
    });

    it('throws for non-existent instance', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      await expect(deleteServiceInstance('non-existent', ORG_ID)).rejects.toThrow(
        'Service instance not found or access denied',
      );
    });

    it('throws for system defaults', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      await expect(deleteServiceInstance('instance-1', 'other-org')).rejects.toThrow(
        'Service instance not found or access denied',
      );
    });
  });

  describe('countServiceInstanceReferences', () => {
    it('counts references across all related models', async () => {
      (prisma.did.count as jest.Mock).mockResolvedValue(3);
      (prisma.registrar.count as jest.Mock).mockResolvedValue(1);
      (prisma.identifierScheme.count as jest.Mock).mockResolvedValue(2);

      const result = await countServiceInstanceReferences('instance-1');

      expect(prisma.did.count).toHaveBeenCalledWith({ where: { serviceInstanceId: 'instance-1' } });
      expect(prisma.registrar.count).toHaveBeenCalledWith({ where: { idrServiceInstanceId: 'instance-1' } });
      expect(prisma.identifierScheme.count).toHaveBeenCalledWith({ where: { idrServiceInstanceId: 'instance-1' } });
      expect(result).toEqual({ dids: 3, registrars: 1, schemes: 2 });
    });

    it('returns zeros when no references exist', async () => {
      (prisma.did.count as jest.Mock).mockResolvedValue(0);
      (prisma.registrar.count as jest.Mock).mockResolvedValue(0);
      (prisma.identifierScheme.count as jest.Mock).mockResolvedValue(0);

      const result = await countServiceInstanceReferences('instance-1');

      expect(result).toEqual({ dids: 0, registrars: 0, schemes: 0 });
    });
  });

  describe('getInstanceByResolution', () => {
    it('returns explicit instance by ID (own organisation)', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);

      const result = await getInstanceByResolution(ORG_ID, 'VC', 'instance-1');

      expect(mockServiceInstance.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'instance-1',
          OR: [{ tenantId: ORG_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
      });
      expect(result).toEqual(INSTANCE_RECORD);
    });

    it('returns explicit instance by ID (system default)', async () => {
      const systemRecord = { ...INSTANCE_RECORD, tenantId: SYSTEM_TENANT_ID };
      mockServiceInstance.findFirst.mockResolvedValue(systemRecord);

      const result = await getInstanceByResolution(ORG_ID, 'VC', 'instance-1');

      expect(result).toEqual(systemRecord);
    });

    it('returns null for explicit ID not accessible', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      const result = await getInstanceByResolution('other-org', 'VC', 'instance-1');

      expect(result).toBeNull();
    });

    it('returns tenant primary when no explicit ID', async () => {
      const primaryRecord = { ...INSTANCE_RECORD, isPrimary: true };
      mockServiceInstance.findFirst.mockResolvedValue(primaryRecord);

      const result = await getInstanceByResolution(ORG_ID, 'VC');

      expect(mockServiceInstance.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: ORG_ID,
          serviceType: 'VC',
          isPrimary: true,
        },
      });
      expect(result).toEqual(primaryRecord);
    });

    it('returns system default when no tenant primary', async () => {
      const systemRecord = { ...INSTANCE_RECORD, tenantId: SYSTEM_TENANT_ID };
      // First call: tenant primary lookup returns null
      mockServiceInstance.findFirst.mockResolvedValueOnce(null);
      // Second call: system default lookup returns the system record
      mockServiceInstance.findFirst.mockResolvedValueOnce(systemRecord);

      const result = await getInstanceByResolution(ORG_ID, 'VC');

      expect(mockServiceInstance.findFirst).toHaveBeenCalledTimes(2);
      expect(mockServiceInstance.findFirst).toHaveBeenNthCalledWith(1, {
        where: {
          tenantId: ORG_ID,
          serviceType: 'VC',
          isPrimary: true,
        },
      });
      expect(mockServiceInstance.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          tenantId: SYSTEM_TENANT_ID,
          serviceType: 'VC',
        },
      });
      expect(result).toEqual(systemRecord);
    });

    it('returns null when nothing found', async () => {
      // First call: tenant primary lookup returns null
      mockServiceInstance.findFirst.mockResolvedValueOnce(null);
      // Second call: system default lookup returns null
      mockServiceInstance.findFirst.mockResolvedValueOnce(null);

      const result = await getInstanceByResolution(ORG_ID, 'VC');

      expect(mockServiceInstance.findFirst).toHaveBeenCalledTimes(2);
      expect(result).toBeNull();
    });
  });
});
