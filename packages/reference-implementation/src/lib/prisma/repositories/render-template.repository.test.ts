import {
  createRenderTemplate,
  getRenderTemplateById,
  listRenderTemplates,
  updateRenderTemplate,
  deleteRenderTemplate,
  getPrimaryRenderTemplate,
} from './render-template.repository';

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

const INCLUDE_SHAPE = {
  dataModel: true,
};

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
    hash: 'sha256-abc123',
    isPrimary: false,
    storageServiceInstanceId: null,
    storageExternalId: null,
    storageBucket: null,
    storageContentType: null,
    inline: false,
    mediaType: 'text/html',
    mediaQuery: null,
    dataModel: {
      id: CONFIG_ID,
      name: 'Digital Product Passport v0.6.0',
    },
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
        hash: 'sha256-abc123',
      });

      expect(mockTx.renderTemplate.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          name: 'DPP Default Template',
          dataModelId: CONFIG_ID,
          renderMethodType: 'RenderTemplate2024',
          storageUrl: 'https://storage.example.com/templates/dpp-default.html',
          hash: 'sha256-abc123',
          isPrimary: false,
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

    it('defaults isPrimary to false', async () => {
      mockTx.renderTemplate.create.mockResolvedValue(TEMPLATE_RECORD);

      await createRenderTemplate(TENANT_ID, {
        name: 'DPP Default Template',
        dataModelId: CONFIG_ID,
        renderMethodType: 'RenderTemplate2024',
        storageUrl: 'https://storage.example.com/templates/dpp-default.html',
        hash: 'sha256-abc123',
      });

      expect(mockTx.renderTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isPrimary: false,
        }),
        include: INCLUDE_SHAPE,
      });
    });

    it('unsets existing primary when isPrimary is true', async () => {
      const primaryRecord = { ...TEMPLATE_RECORD, isPrimary: true };
      mockTx.renderTemplate.updateMany.mockResolvedValue({ count: 1 });
      mockTx.renderTemplate.create.mockResolvedValue(primaryRecord);

      await createRenderTemplate(TENANT_ID, {
        name: 'DPP Primary Template',
        dataModelId: CONFIG_ID,
        renderMethodType: 'RenderTemplate2024',
        storageUrl: 'https://storage.example.com/templates/dpp-primary.html',
        hash: 'sha256-def456',
        isPrimary: true,
      });

      expect(mockTx.renderTemplate.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          dataModelId: CONFIG_ID,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
      expect(mockTx.renderTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isPrimary: true,
        }),
        include: INCLUDE_SHAPE,
      });
    });
  });

  describe('getRenderTemplateById', () => {
    it('returns template scoped to tenant', async () => {
      mockRenderTemplate.findFirst.mockResolvedValue(TEMPLATE_RECORD);

      const result = await getRenderTemplateById('template-1', TENANT_ID);

      expect(mockRenderTemplate.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'template-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
        },
        include: INCLUDE_SHAPE,
      });
      expect(result).toEqual(TEMPLATE_RECORD);
    });

    it('returns system-provisioned template for any tenant', async () => {
      const SYSTEM_TEMPLATE_RECORD = {
        ...TEMPLATE_RECORD,
        id: 'system-template-1',
        tenantId: 'system',
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
  });

  describe('listRenderTemplates', () => {
    it('lists templates for tenant with total count', async () => {
      mockRenderTemplate.findMany.mockResolvedValue([TEMPLATE_RECORD]);
      mockRenderTemplate.count.mockResolvedValue(1);

      const result = await listRenderTemplates(TENANT_ID);

      expect(mockRenderTemplate.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
        },
        include: INCLUDE_SHAPE,
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockRenderTemplate.count).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
        },
      });
      expect(result).toEqual({ data: [TEMPLATE_RECORD], total: 1 });
    });

    it('filters by dataModelId', async () => {
      mockRenderTemplate.findMany.mockResolvedValue([TEMPLATE_RECORD]);
      mockRenderTemplate.count.mockResolvedValue(1);

      await listRenderTemplates(TENANT_ID, { dataModelId: CONFIG_ID });

      const expectedWhere = expect.objectContaining({
        OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
        dataModelId: CONFIG_ID,
      });
      expect(mockRenderTemplate.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        include: INCLUDE_SHAPE,
        take: 20,
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
        tenantId: 'system',
        name: 'DPP System Default Template',
      };
      mockRenderTemplate.findMany.mockResolvedValue([TEMPLATE_RECORD, SYSTEM_TEMPLATE_RECORD]);
      mockRenderTemplate.count.mockResolvedValue(2);

      const result = await listRenderTemplates(TENANT_ID);

      expect(result.data).toHaveLength(2);
      expect(result).toEqual({ data: [TEMPLATE_RECORD, SYSTEM_TEMPLATE_RECORD], total: 2 });
    });

    it('applies pagination', async () => {
      mockRenderTemplate.findMany.mockResolvedValue([]);
      mockRenderTemplate.count.mockResolvedValue(0);

      await listRenderTemplates(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockRenderTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
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

    it('unsets existing primary when setting isPrimary (excluding self)', async () => {
      mockTx.renderTemplate.findFirst.mockResolvedValue(TEMPLATE_RECORD);
      mockTx.renderTemplate.updateMany.mockResolvedValue({ count: 1 });
      mockTx.renderTemplate.update.mockResolvedValue({
        ...TEMPLATE_RECORD,
        isPrimary: true,
      });

      await updateRenderTemplate('template-1', TENANT_ID, { isPrimary: true });

      expect(mockTx.renderTemplate.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          dataModelId: CONFIG_ID,
          isPrimary: true,
          NOT: { id: 'template-1' },
        },
        data: { isPrimary: false },
      });
      expect(mockTx.renderTemplate.update).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        data: { isPrimary: true },
        include: INCLUDE_SHAPE,
      });
    });

    it('applies partial update with conditional spreads', async () => {
      mockTx.renderTemplate.findFirst.mockResolvedValue(TEMPLATE_RECORD);
      mockTx.renderTemplate.update.mockResolvedValue({
        ...TEMPLATE_RECORD,
        storageUrl: 'https://storage.example.com/templates/updated.html',
        hash: 'sha256-new789',
      });

      await updateRenderTemplate('template-1', TENANT_ID, {
        storageUrl: 'https://storage.example.com/templates/updated.html',
        hash: 'sha256-new789',
      });

      expect(mockTx.renderTemplate.update).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        data: {
          storageUrl: 'https://storage.example.com/templates/updated.html',
          hash: 'sha256-new789',
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
  });

  describe('getPrimaryRenderTemplate', () => {
    it('returns the primary template for a tenant and config', async () => {
      const primaryRecord = { ...TEMPLATE_RECORD, isPrimary: true };
      mockRenderTemplate.findFirst.mockResolvedValue(primaryRecord);

      const result = await getPrimaryRenderTemplate(TENANT_ID, CONFIG_ID);

      expect(mockRenderTemplate.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: 'system' }],
          dataModelId: CONFIG_ID,
          isPrimary: true,
        },
        include: INCLUDE_SHAPE,
      });
      expect(result).toEqual(primaryRecord);
    });

    it('returns null when no primary template exists', async () => {
      mockRenderTemplate.findFirst.mockResolvedValue(null);

      const result = await getPrimaryRenderTemplate(TENANT_ID, CONFIG_ID);
      expect(result).toBeNull();
    });
  });
});
