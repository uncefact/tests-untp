import {
  createServiceInstance,
  getServiceInstanceById,
  listServiceInstances,
  updateServiceInstance,
  deleteServiceInstance,
  countServiceInstanceReferences,
  getInstanceByResolution,
  lockServiceInstanceForUpdate,
} from './service-instance.repository';
import { SYSTEM_TENANT_ID } from '../constants';
import { NotFoundError, ServiceInstanceStatusPendingError } from '@/lib/api/errors';
import { prismaError } from '../db-errors.fixtures';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

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
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(' ');
      if (sql.includes('"ServiceInstance"') && sql.includes('FOR UPDATE')) {
        return Promise.resolve(values[0] === 'non-existent' || values[1] === 'other-org' ? [] : [{ id: 'instance-1' }]);
      }
      if (sql.includes('"CredentialStatusEntry"')) return Promise.resolve([{ count: 0 }]);
      return Promise.resolve([]);
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the transaction mock accepts the callback shape under test
    $transaction: jest.fn((fn: any) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the mock must reuse the mocked Prisma object at call time
      const prismaMock = require('../prisma').prisma;
      return fn({ serviceInstance: prismaMock.serviceInstance, $queryRaw: prismaMock.$queryRaw });
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

    it('rethrows a foreign-key violation unchanged', async () => {
      // The insert's only foreign key is tenantId, which is not a caller
      // error; the violation stays on the sanitised 500 path unmapped.
      const tenantFkError = prismaError('P2003', 'Foreign key constraint failed on the field: `tenantId`');
      mockServiceInstance.create.mockRejectedValue(tenantFkError);

      await expect(
        createServiceInstance({
          tenantId: ORG_ID,
          serviceType: 'VC',
          adapterType: 'VCKIT',
          name: 'Instance',
          config: 'encrypted',
        }),
      ).rejects.toBe(tenantFkError);
    });
  });

  describe('lockServiceInstanceForUpdate', () => {
    it('returns true for the tenant-owned row and false for a foreign tenant', async () => {
      await expect(lockServiceInstanceForUpdate(prisma as never, 'instance-1', ORG_ID)).resolves.toBe(true);
      await expect(lockServiceInstanceForUpdate(prisma as never, 'instance-1', 'other-org')).resolves.toBe(false);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- the mocked Prisma method is inspected for dispatch count only
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
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
        take: DEFAULT_PAGE_LIMIT,
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
        take: DEFAULT_PAGE_LIMIT,
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
        take: DEFAULT_PAGE_LIMIT,
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
      // eslint-disable-next-line @typescript-eslint/unbound-method -- the mocked Prisma method is inspected for guard dispatch
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(result.name).toBe('Updated Name');
    });

    it('skips pending status checks for an unchanged effective config update', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);
      mockServiceInstance.update.mockResolvedValue({ ...INSTANCE_RECORD, config: 'new-config' });

      await expect(
        updateServiceInstance('instance-1', ORG_ID, { config: 'new-config', configChanged: () => false }),
      ).resolves.toMatchObject({
        config: 'new-config',
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- the mocked Prisma method is inspected for guard dispatch
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('checks pending status entries for a changed effective config', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);
      mockServiceInstance.update.mockResolvedValue({ ...INSTANCE_RECORD, config: 'new-config' });

      await expect(
        updateServiceInstance('instance-1', ORG_ID, { config: 'new-config', configChanged: () => true }),
      ).resolves.toMatchObject({
        config: 'new-config',
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- the mocked Prisma method is inspected for guard dispatch
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('refuses an effective config update when the locked instance has pending status entries', async () => {
      (prisma.$queryRaw as jest.Mock)
        .mockImplementationOnce(() => Promise.resolve([{ id: 'instance-1' }]))
        .mockImplementationOnce(() => Promise.resolve([{ count: 1 }]));

      await expect(updateServiceInstance('instance-1', ORG_ID, { config: 'new-config' })).rejects.toBeInstanceOf(
        ServiceInstanceStatusPendingError,
      );
      expect(mockServiceInstance.update).not.toHaveBeenCalled();
    });

    // The data build uses `!== undefined` rather than a truthiness check, so
    // an explicit null reaches the update and clears the column. A truthiness
    // check would drop it, which is indistinguishable from omitting the field
    // and would silently turn a clear into a no-op.
    it('forwards an explicit description: null straight through to the update data', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);
      mockServiceInstance.update.mockResolvedValue({ ...INSTANCE_RECORD, description: null });

      await updateServiceInstance('instance-1', ORG_ID, { description: null });

      expect(mockServiceInstance.update).toHaveBeenCalledWith({
        where: { id: 'instance-1' },
        data: { description: null },
      });
    });

    it('throws for non-existent instance', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      await expect(updateServiceInstance('non-existent', ORG_ID, { name: 'New' })).rejects.toThrow(
        'Service instance not found',
      );
    });

    it('throws for system defaults (organisation mismatch)', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      await expect(updateServiceInstance('instance-1', 'other-org', { name: 'New' })).rejects.toThrow(
        'Service instance not found',
      );
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      // The findFirst pre-check does not lock the row, so a concurrent delete
      // can land between it and the update; the loser gets the same 404 the
      // pre-check produces for a missing record.
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);
      mockServiceInstance.update.mockRejectedValue(prismaError('P2025'));

      const result = updateServiceInstance('instance-1', ORG_ID, { name: 'New' });

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Service instance not found');
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

      await expect(deleteServiceInstance('non-existent', ORG_ID)).rejects.toThrow('Service instance not found');
    });

    it('throws for system defaults', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      await expect(deleteServiceInstance('instance-1', 'other-org')).rejects.toThrow('Service instance not found');
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);
      mockServiceInstance.delete.mockRejectedValue(prismaError('P2025'));

      const result = deleteServiceInstance('instance-1', ORG_ID);

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Service instance not found');
    });
  });

  describe('countServiceInstanceReferences', () => {
    // Every count carries the tenant condition. These numbers reach the caller
    // in the pre-delete 409, so an unscoped count reports how many of other
    // tenants' records point at the instance.
    it('counts references across all related models, scoped to the tenant', async () => {
      (prisma.did.count as jest.Mock).mockResolvedValue(3);
      (prisma.registrar.count as jest.Mock).mockResolvedValue(1);
      (prisma.identifierScheme.count as jest.Mock).mockResolvedValue(2);

      const result = await countServiceInstanceReferences('instance-1', 'tenant-1');

      // eslint-disable-next-line @typescript-eslint/unbound-method -- the mocked count method is inspected for its scoped arguments
      expect(prisma.did.count as jest.Mock).toHaveBeenCalledWith({
        where: { serviceInstanceId: 'instance-1', tenantId: 'tenant-1' },
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- the mocked count method is inspected for its scoped arguments
      expect(prisma.registrar.count as jest.Mock).toHaveBeenCalledWith({
        where: { idrServiceInstanceId: 'instance-1', tenantId: 'tenant-1' },
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- the mocked count method is inspected for its scoped arguments
      expect(prisma.identifierScheme.count as jest.Mock).toHaveBeenCalledWith({
        where: { idrServiceInstanceId: 'instance-1', tenantId: 'tenant-1' },
      });
      expect(result).toEqual({ dids: 3, registrars: 1, schemes: 2 });
    });

    it('scopes every count to the calling tenant, so a shared instance never reports another tenant to it', async () => {
      // These counts reach the caller in the body of the 409 this check
      // produces, and a system-provisioned instance resolves for every tenant.
      // An unscoped count tells one tenant how many records another tenant holds.
      (prisma.did.count as jest.Mock).mockResolvedValue(0);
      (prisma.registrar.count as jest.Mock).mockResolvedValue(0);
      (prisma.identifierScheme.count as jest.Mock).mockResolvedValue(0);

      await countServiceInstanceReferences('system-instance', 'tenant-b');

      for (const counter of [
        // eslint-disable-next-line @typescript-eslint/unbound-method -- the mocked count methods are inspected for tenant predicates
        prisma.did.count as jest.Mock,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- the mocked count methods are inspected for tenant predicates
        prisma.registrar.count as jest.Mock,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- the mocked count methods are inspected for tenant predicates
        prisma.identifierScheme.count as jest.Mock,
      ]) {
        expect((counter as jest.Mock).mock.calls[0][0].where).toEqual(
          expect.objectContaining({ tenantId: 'tenant-b' }),
        );
      }
    });

    it('returns zeros when no references exist', async () => {
      (prisma.did.count as jest.Mock).mockResolvedValue(0);
      (prisma.registrar.count as jest.Mock).mockResolvedValue(0);
      (prisma.identifierScheme.count as jest.Mock).mockResolvedValue(0);

      const result = await countServiceInstanceReferences('instance-1', 'tenant-1');

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
          serviceType: 'VC',
          OR: [{ tenantId: ORG_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
      });
      expect(result).toEqual(INSTANCE_RECORD);
    });

    it('filters an explicit ID by service type, so a wrong-type instance resolves to null', async () => {
      // Without the serviceType condition, an explicit id pointing at an
      // instance of a different type (e.g. a VC instance where an IDR one is
      // required) would resolve here and only fail later at adapter lookup.
      mockServiceInstance.findFirst.mockResolvedValue(null);

      const result = await getInstanceByResolution(ORG_ID, 'IDR', 'vc-instance-1');

      expect(mockServiceInstance.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'vc-instance-1',
          serviceType: 'IDR',
          OR: [{ tenantId: ORG_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
      });
      expect(result).toBeNull();
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
