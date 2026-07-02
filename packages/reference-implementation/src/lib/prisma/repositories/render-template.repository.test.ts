import {
  createRenderTemplate,
  getRenderTemplateById,
  listRenderTemplates,
  updateRenderTemplate,
  deleteRenderTemplate,
  getDefaultRenderTemplate,
} from './render-template.repository';
import { NotFoundError } from '@/lib/api/errors';
import { SYSTEM_TENANT_ID } from '../constants';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

// Transaction mock — functions called via $transaction callback
const mockTx = {
  renderTemplate: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
};

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock('../prisma', () => ({
  prisma: {
    renderTemplate: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockRenderTemplate = prisma.renderTemplate as unknown as {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  delete: jest.Mock;
};

const INCLUDE_SHAPE = {};

function prismaRecordNotFoundError(): Error {
  const error = new Error(
    'An operation failed because it depends on one or more records that were required but not found.',
  );
  error.name = 'PrismaClientKnownRequestError';
  Object.assign(error, { code: 'P2025', clientVersion: '6.0.0' });
  return error;
}

function prismaForeignKeyViolationError(): Error {
  const error = new Error('Foreign key constraint failed on the field: `dataModelId`');
  error.name = 'PrismaClientKnownRequestError';
  Object.assign(error, { code: 'P2003', clientVersion: '6.0.0' });
  return error;
}

describe('render-template.repository', () => {
  const TENANT_ID = 'tenant-1';
  const CONFIG_ID = 'config-1';
  const TEMPLATE_RECORD = {
    id: 'template-1',
    tenantId: TENANT_ID,
    dataModelId: CONFIG_ID,
    name: 'DPP Default Template',
    renderMethodType: 'RenderTemplate2024',
    storageUrl: 'https://storage.example.com/templates/dpp-default.html',
    digestMultibase: 'zTESTabc123',
    isDefault: false,
    storageServiceInstanceId: null,
    storageExternalId: null,
    storageBucket: null,
    storageContentType: null,
    inline: false,
    mediaType: 'text/html',
    mediaQuery: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createRenderTemplate', () => {
    it('creates a template successfully', async () => {
      mockTx.renderTemplate.create.mockResolvedValue(TEMPLATE_RECORD);

      const result = await createRenderTemplate(TENANT_ID, {
        name: 'DPP Default Template',
        dataModelId: CONFIG_ID,
        renderMethodType: 'RenderTemplate2024',
        storageUrl: 'https://storage.example.com/templates/dpp-default.html',
        digestMultibase: 'zTESTabc123',
      });

      expect(mockTx.renderTemplate.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          name: 'DPP Default Template',
          dataModelId: CONFIG_ID,
          renderMethodType: 'RenderTemplate2024',
          storageUrl: 'https://storage.example.com/templates/dpp-default.html',
          digestMultibase: 'zTESTabc123',
          isDefault: false,
          storageServiceInstanceId: undefined,
          storageExternalId: undefined,
          storageBucket: undefined,
          storageContentType: undefined,
          inline: undefined,
          mediaType: undefined,
          mediaQuery: undefined,
        },
        include: INCLUDE_SHAPE,
      });
      expect(result).toEqual(TEMPLATE_RECORD);
    });

    it('defaults isDefault to false', async () => {
      mockTx.renderTemplate.create.mockResolvedValue(TEMPLATE_RECORD);

      await createRenderTemplate(TENANT_ID, {
        name: 'DPP Default Template',
        dataModelId: CONFIG_ID,
        renderMethodType: 'RenderTemplate2024',
        storageUrl: 'https://storage.example.com/templates/dpp-default.html',
        digestMultibase: 'zTESTabc123',
      });

      expect(mockTx.renderTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isDefault: false,
        }),
        include: INCLUDE_SHAPE,
      });
    });

    it('unsets existing default when isDefault is true', async () => {
      const defaultRecord = { ...TEMPLATE_RECORD, isDefault: true };
      mockTx.renderTemplate.updateMany.mockResolvedValue({ count: 1 });
      mockTx.renderTemplate.create.mockResolvedValue(defaultRecord);

      await createRenderTemplate(TENANT_ID, {
        name: 'DPP Default Template',
        dataModelId: CONFIG_ID,
        renderMethodType: 'RenderTemplate2024',
        storageUrl: 'https://storage.example.com/templates/dpp-default.html',
        digestMultibase: 'zTESTdef456',
        isDefault: true,
      });

      expect(mockTx.renderTemplate.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          dataModelId: CONFIG_ID,
          isDefault: true,
        },
        data: { isDefault: false },
      });
      expect(mockTx.renderTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isDefault: true,
        }),
        include: INCLUDE_SHAPE,
      });
    });

    it('maps a foreign-key violation to NotFoundError when the data model was deleted before insert', async () => {
      mockTx.renderTemplate.create.mockRejectedValue(prismaForeignKeyViolationError());

      const result = createRenderTemplate(TENANT_ID, {
        name: 'DPP Default Template',
        dataModelId: CONFIG_ID,
        renderMethodType: 'RenderTemplate2024',
        storageUrl: 'https://storage.example.com/templates/dpp-default.html',
        digestMultibase: 'zTESTabc123',
      });

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Data model not found');
    });

    it('rethrows a non-database error unchanged', async () => {
      const connectionError = new Error('connection lost');
      mockTx.renderTemplate.create.mockRejectedValue(connectionError);

      await expect(
        createRenderTemplate(TENANT_ID, {
          name: 'DPP Default Template',
          dataModelId: CONFIG_ID,
          renderMethodType: 'RenderTemplate2024',
          storageUrl: 'https://storage.example.com/templates/dpp-default.html',
          digestMultibase: 'zTESTabc123',
        }),
      ).rejects.toThrow(connectionError);
    });
  });

  describe('getRenderTemplateById', () => {
    it('returns template scoped to tenant', async () => {
      mockRenderTemplate.findFirst.mockResolvedValue(TEMPLATE_RECORD);

      const result = await getRenderTemplateById('template-1', TENANT_ID);

      expect(mockRenderTemplate.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'template-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
        include: INCLUDE_SHAPE,
      });
      expect(result).toEqual(TEMPLATE_RECORD);
    });

    it('returns system-provisioned template for any tenant', async () => {
      const SYSTEM_TEMPLATE_RECORD = {
        ...TEMPLATE_RECORD,
        id: 'system-template-1',
        tenantId: SYSTEM_TENANT_ID,
        name: 'DPP System Default Template',
      };
      mockRenderTemplate.findFirst.mockResolvedValue(SYSTEM_TEMPLATE_RECORD);

      const result = await getRenderTemplateById('system-template-1', TENANT_ID);

      expect(result).toEqual(SYSTEM_TEMPLATE_RECORD);
    });

    it('returns null when template is not found', async () => {
      mockRenderTemplate.findFirst.mockResolvedValue(null);

      const result = await getRenderTemplateById('nonexistent', TENANT_ID);
      expect(result).toBeNull();
    });

    it('overrides isDefault to false for system template when tenant has own default', async () => {
      const systemTemplate = {
        ...TEMPLATE_RECORD,
        id: 'system-template-1',
        tenantId: SYSTEM_TENANT_ID,
        isDefault: true,
      };
      mockRenderTemplate.findFirst
        .mockResolvedValueOnce(systemTemplate) // getRenderTemplateById query
        .mockResolvedValueOnce({ id: 'tenant-default' }); // applyTenantDefaultOverride check

      const result = await getRenderTemplateById('system-template-1', TENANT_ID);

      expect(result).toEqual({ ...systemTemplate, isDefault: false });
    });

    it('preserves isDefault for system template when tenant has no own default', async () => {
      const systemTemplate = {
        ...TEMPLATE_RECORD,
        id: 'system-template-1',
        tenantId: SYSTEM_TENANT_ID,
        isDefault: true,
      };
      mockRenderTemplate.findFirst.mockResolvedValueOnce(systemTemplate).mockResolvedValueOnce(null);

      const result = await getRenderTemplateById('system-template-1', TENANT_ID);

      expect(result).toEqual(systemTemplate);
    });
  });

  describe('listRenderTemplates', () => {
    it('lists templates for tenant with total count', async () => {
      mockRenderTemplate.findMany
        .mockResolvedValueOnce([TEMPLATE_RECORD]) // main query
        .mockResolvedValueOnce([]); // tenant defaults query
      mockRenderTemplate.count.mockResolvedValue(1);

      const result = await listRenderTemplates(TENANT_ID);

      expect(mockRenderTemplate.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
        include: INCLUDE_SHAPE,
        take: DEFAULT_PAGE_LIMIT,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockRenderTemplate.count).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
      });
      expect(result).toEqual({ data: [TEMPLATE_RECORD], total: 1 });
    });

    it('filters by dataModelId', async () => {
      mockRenderTemplate.findMany
        .mockResolvedValueOnce([TEMPLATE_RECORD]) // main query
        .mockResolvedValueOnce([]); // tenant defaults query
      mockRenderTemplate.count.mockResolvedValue(1);

      await listRenderTemplates(TENANT_ID, { dataModelId: CONFIG_ID });

      const expectedWhere = expect.objectContaining({
        OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
        dataModelId: CONFIG_ID,
      });
      expect(mockRenderTemplate.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        include: INCLUDE_SHAPE,
        take: DEFAULT_PAGE_LIMIT,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockRenderTemplate.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('includes system-provisioned templates in results', async () => {
      const SYSTEM_TEMPLATE_RECORD = {
        ...TEMPLATE_RECORD,
        id: 'system-template-1',
        tenantId: SYSTEM_TENANT_ID,
        name: 'DPP System Default Template',
      };
      mockRenderTemplate.findMany
        .mockResolvedValueOnce([TEMPLATE_RECORD, SYSTEM_TEMPLATE_RECORD]) // main query
        .mockResolvedValueOnce([]); // tenant defaults query
      mockRenderTemplate.count.mockResolvedValue(2);

      const result = await listRenderTemplates(TENANT_ID);

      expect(result.data).toHaveLength(2);
      expect(result).toEqual({ data: [TEMPLATE_RECORD, SYSTEM_TEMPLATE_RECORD], total: 2 });
    });

    it('applies pagination', async () => {
      mockRenderTemplate.findMany
        .mockResolvedValueOnce([]) // main query
        .mockResolvedValueOnce([]); // tenant defaults query
      mockRenderTemplate.count.mockResolvedValue(0);

      await listRenderTemplates(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockRenderTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });

    it('overrides isDefault on system templates when tenant has own default for same dataModelId', async () => {
      const systemTemplate = {
        ...TEMPLATE_RECORD,
        id: 'system-template-1',
        tenantId: SYSTEM_TENANT_ID,
        isDefault: true,
      };
      const tenantTemplate = {
        ...TEMPLATE_RECORD,
        id: 'tenant-template-1',
        tenantId: TENANT_ID,
        isDefault: true,
      };
      mockRenderTemplate.findMany
        .mockResolvedValueOnce([tenantTemplate, systemTemplate]) // main query
        .mockResolvedValueOnce([{ dataModelId: CONFIG_ID }]); // tenant defaults query
      mockRenderTemplate.count.mockResolvedValue(2);

      const result = await listRenderTemplates(TENANT_ID);

      expect(result.data[0].isDefault).toBe(true); // tenant's own
      expect(result.data[1].isDefault).toBe(false); // system overridden
    });
  });

  describe('updateRenderTemplate', () => {
    it('updates fields successfully', async () => {
      mockTx.renderTemplate.findFirst.mockResolvedValue(TEMPLATE_RECORD);
      const updatedRecord = { ...TEMPLATE_RECORD, name: 'Updated Template' };
      mockTx.renderTemplate.update.mockResolvedValue(updatedRecord);

      const result = await updateRenderTemplate('template-1', TENANT_ID, {
        name: 'Updated Template',
      });

      expect(mockTx.renderTemplate.findFirst).toHaveBeenCalledWith({
        where: { id: 'template-1', tenantId: TENANT_ID },
      });
      expect(mockTx.renderTemplate.update).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        data: { name: 'Updated Template' },
        include: INCLUDE_SHAPE,
      });
      expect(result.name).toBe('Updated Template');
    });

    it('throws when template is not tenant-owned', async () => {
      mockTx.renderTemplate.findFirst.mockResolvedValue(null);

      await expect(updateRenderTemplate('template-1', 'other-tenant', { name: 'Updated' })).rejects.toThrow(
        'Render template not found or access denied',
      );
    });

    it('unsets existing default when setting isDefault (excluding self)', async () => {
      mockTx.renderTemplate.findFirst.mockResolvedValue(TEMPLATE_RECORD);
      mockTx.renderTemplate.updateMany.mockResolvedValue({ count: 1 });
      mockTx.renderTemplate.update.mockResolvedValue({
        ...TEMPLATE_RECORD,
        isDefault: true,
      });

      await updateRenderTemplate('template-1', TENANT_ID, { isDefault: true });

      expect(mockTx.renderTemplate.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          dataModelId: CONFIG_ID,
          isDefault: true,
          NOT: { id: 'template-1' },
        },
        data: { isDefault: false },
      });
      expect(mockTx.renderTemplate.update).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        data: { isDefault: true },
        include: INCLUDE_SHAPE,
      });
    });

    it('applies partial update with conditional spreads', async () => {
      mockTx.renderTemplate.findFirst.mockResolvedValue(TEMPLATE_RECORD);
      mockTx.renderTemplate.update.mockResolvedValue({
        ...TEMPLATE_RECORD,
        storageUrl: 'https://storage.example.com/templates/updated.html',
        digestMultibase: 'zTESTnew789',
      });

      await updateRenderTemplate('template-1', TENANT_ID, {
        storageUrl: 'https://storage.example.com/templates/updated.html',
        digestMultibase: 'zTESTnew789',
      });

      expect(mockTx.renderTemplate.update).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        data: {
          storageUrl: 'https://storage.example.com/templates/updated.html',
          digestMultibase: 'zTESTnew789',
        },
        include: INCLUDE_SHAPE,
      });
    });

    it('includes new optional fields in the update when provided', async () => {
      mockTx.renderTemplate.findFirst.mockResolvedValue(TEMPLATE_RECORD);
      mockTx.renderTemplate.update.mockResolvedValue({
        ...TEMPLATE_RECORD,
        storageServiceInstanceId: 'svc-1',
        storageExternalId: 'ext-1',
        storageBucket: 'templates',
        storageContentType: 'text/html',
        inline: true,
        mediaType: 'text/html',
        mediaQuery: 'screen',
      });

      await updateRenderTemplate('template-1', TENANT_ID, {
        storageServiceInstanceId: 'svc-1',
        storageExternalId: 'ext-1',
        storageBucket: 'templates',
        storageContentType: 'text/html',
        inline: true,
        mediaType: 'text/html',
        mediaQuery: 'screen',
      });

      expect(mockTx.renderTemplate.update).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        data: {
          storageServiceInstanceId: 'svc-1',
          storageExternalId: 'ext-1',
          storageBucket: 'templates',
          storageContentType: 'text/html',
          inline: true,
          mediaType: 'text/html',
          mediaQuery: 'screen',
        },
        include: INCLUDE_SHAPE,
      });
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      mockTx.renderTemplate.findFirst.mockResolvedValue(TEMPLATE_RECORD);
      mockTx.renderTemplate.update.mockRejectedValue(prismaRecordNotFoundError());

      const result = updateRenderTemplate('template-1', TENANT_ID, { name: 'Updated Template' });

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Render template not found or access denied');
    });
  });

  describe('deleteRenderTemplate', () => {
    it('deletes a tenant-owned template', async () => {
      mockTx.renderTemplate.findFirst.mockResolvedValue(TEMPLATE_RECORD);
      mockTx.renderTemplate.delete.mockResolvedValue(TEMPLATE_RECORD);

      const result = await deleteRenderTemplate('template-1', TENANT_ID);

      expect(mockTx.renderTemplate.findFirst).toHaveBeenCalledWith({
        where: { id: 'template-1', tenantId: TENANT_ID },
      });
      expect(mockTx.renderTemplate.delete).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        include: INCLUDE_SHAPE,
      });
      expect(result).toEqual(TEMPLATE_RECORD);
    });

    it('throws when template is not tenant-owned', async () => {
      mockTx.renderTemplate.findFirst.mockResolvedValue(null);

      await expect(deleteRenderTemplate('template-1', 'other-tenant')).rejects.toThrow(
        'Render template not found or access denied',
      );
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      mockTx.renderTemplate.findFirst.mockResolvedValue(TEMPLATE_RECORD);
      mockTx.renderTemplate.delete.mockRejectedValue(prismaRecordNotFoundError());

      const result = deleteRenderTemplate('template-1', TENANT_ID);

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Render template not found or access denied');
    });
  });

  describe('getDefaultRenderTemplate', () => {
    it('returns the default template for a tenant and config', async () => {
      const defaultRecord = { ...TEMPLATE_RECORD, isDefault: true };
      mockRenderTemplate.findFirst.mockResolvedValueOnce(defaultRecord);

      const result = await getDefaultRenderTemplate(TENANT_ID, CONFIG_ID);

      expect(mockRenderTemplate.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          dataModelId: CONFIG_ID,
          isDefault: true,
        },
        include: INCLUDE_SHAPE,
      });
      expect(result).toEqual(defaultRecord);
    });

    it('returns null when no default template exists', async () => {
      mockRenderTemplate.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      const result = await getDefaultRenderTemplate(TENANT_ID, CONFIG_ID);
      expect(result).toBeNull();
    });

    it('returns tenant default over system default', async () => {
      const tenantDefault = { ...TEMPLATE_RECORD, isDefault: true };
      mockRenderTemplate.findFirst.mockResolvedValueOnce(tenantDefault);

      const result = await getDefaultRenderTemplate(TENANT_ID, CONFIG_ID);

      expect(mockRenderTemplate.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, dataModelId: CONFIG_ID, isDefault: true },
        include: INCLUDE_SHAPE,
      });
      expect(result).toEqual(tenantDefault);
    });

    it('falls back to system default when tenant has none', async () => {
      const systemDefault = { ...TEMPLATE_RECORD, tenantId: SYSTEM_TENANT_ID, isDefault: true };
      mockRenderTemplate.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(systemDefault);

      const result = await getDefaultRenderTemplate(TENANT_ID, CONFIG_ID);

      expect(mockRenderTemplate.findFirst).toHaveBeenCalledTimes(2);
      expect(mockRenderTemplate.findFirst).toHaveBeenNthCalledWith(2, {
        where: { tenantId: SYSTEM_TENANT_ID, dataModelId: CONFIG_ID, isDefault: true },
        include: INCLUDE_SHAPE,
      });
      expect(result).toEqual(systemDefault);
    });
  });
});
