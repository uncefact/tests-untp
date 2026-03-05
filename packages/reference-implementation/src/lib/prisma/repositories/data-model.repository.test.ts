import {
  createDataModel,
  getDataModelById,
  listDataModels,
  updateDataModel,
  deleteDataModel,
} from './data-model.repository';

// Transaction mock — functions called via $transaction callback
const mockTx = {
  dataModel: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock('../prisma', () => ({
  prisma: {
    dataModel: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((arg: unknown) => {
      // Batch form: $transaction([promise1, promise2])
      if (Array.isArray(arg)) return Promise.all(arg);
      // Interactive form: $transaction(async (tx) => { ... })
      return (arg as (tx: typeof mockTx) => Promise<unknown>)(mockTx);
    }),
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';
import { SYSTEM_TENANT_ID } from '../constants';

const mockDataModel = prisma.dataModel as unknown as {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
};

const DETAIL_INCLUDE_SHAPE = {
  parentConfig: true,
  extensions: true,
  renderTemplates: true,
};

const LIST_INCLUDE_SHAPE = {
  parentConfig: true,
};

describe('data-model.repository', () => {
  const TENANT_ID = 'tenant-1';
  const CONFIG_RECORD = {
    id: 'config-1',
    tenantId: SYSTEM_TENANT_ID,
    name: 'Digital Product Passport v0.6.0',
    credentialType: 'DigitalProductPassport',
    version: '0.6.0',
    isExtension: false,
    parentConfigId: null,
    parentConfig: null,
    extensions: [],
    renderTemplates: [],
    schemaUrl: 'https://example.com/schema.json',
    contextUrl: 'https://example.com/context.jsonld',
    websiteUrl: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const EXTENSION_RECORD = {
    ...CONFIG_RECORD,
    id: 'config-ext-1',
    tenantId: TENANT_ID,
    name: 'Custom DPP Extension',
    isExtension: true,
    parentConfigId: 'config-1',
    parentConfig: CONFIG_RECORD,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createDataModel', () => {
    it('creates a core config successfully', async () => {
      mockTx.dataModel.create.mockResolvedValue(CONFIG_RECORD);

      const result = await createDataModel(TENANT_ID, {
        name: 'Digital Product Passport v0.6.0',
        credentialType: 'DigitalProductPassport' as never,
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        isExtension: false,
      });

      expect(mockTx.dataModel.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          name: 'Digital Product Passport v0.6.0',
          credentialType: 'DigitalProductPassport',
          version: '0.6.0',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          isExtension: false,
        },
        include: DETAIL_INCLUDE_SHAPE,
      });
      expect(result).toEqual(CONFIG_RECORD);
    });

    it('creates an extension config with valid parent', async () => {
      mockTx.dataModel.findFirst.mockResolvedValue(CONFIG_RECORD);
      mockTx.dataModel.create.mockResolvedValue(EXTENSION_RECORD);

      const result = await createDataModel(TENANT_ID, {
        name: 'Custom DPP Extension',
        credentialType: 'DigitalProductPassport' as never,
        version: '0.6.0',
        schemaUrl: 'https://example.com/ext-schema.json',
        contextUrl: 'https://example.com/ext-context.jsonld',
        isExtension: true,
        parentConfigId: 'config-1',
      });

      expect(mockTx.dataModel.findFirst).toHaveBeenCalledWith({
        where: { id: 'config-1' },
      });
      expect(mockTx.dataModel.create).toHaveBeenCalled();
      expect(result).toEqual(EXTENSION_RECORD);
    });

    it('throws when isExtension is true but parentConfigId is missing', async () => {
      await expect(
        createDataModel(TENANT_ID, {
          name: 'Extension Without Parent',
          credentialType: 'DigitalProductPassport' as never,
          version: '0.6.0',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          isExtension: true,
        }),
      ).rejects.toThrow('parentConfigId is required for extension configs');
    });

    it('throws when parent config does not exist', async () => {
      mockTx.dataModel.findFirst.mockResolvedValue(null);

      await expect(
        createDataModel(TENANT_ID, {
          name: 'Extension With Invalid Parent',
          credentialType: 'DigitalProductPassport' as never,
          version: '0.6.0',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          isExtension: true,
          parentConfigId: 'nonexistent-id',
        }),
      ).rejects.toThrow('Parent config not found');
    });

    it('throws when parent config is itself an extension', async () => {
      mockTx.dataModel.findFirst.mockResolvedValue({
        ...CONFIG_RECORD,
        isExtension: true,
      });

      await expect(
        createDataModel(TENANT_ID, {
          name: 'Extension With Extension Parent',
          credentialType: 'DigitalProductPassport' as never,
          version: '0.6.0',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          isExtension: true,
          parentConfigId: 'config-1',
        }),
      ).rejects.toThrow('Parent config must be a core type (isExtension=false)');
    });

    it('defaults isExtension to true when not provided', async () => {
      mockTx.dataModel.findFirst.mockResolvedValue(CONFIG_RECORD);
      mockTx.dataModel.create.mockResolvedValue(EXTENSION_RECORD);

      await createDataModel(TENANT_ID, {
        name: 'Default Extension',
        credentialType: 'DigitalProductPassport' as never,
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'config-1',
      });

      expect(mockTx.dataModel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isExtension: true,
          parentConfigId: 'config-1',
        }),
        include: DETAIL_INCLUDE_SHAPE,
      });
    });
  });

  describe('getDataModelById', () => {
    it('returns config visible to tenant or system-provisioned', async () => {
      mockDataModel.findFirst.mockResolvedValue(CONFIG_RECORD);

      const result = await getDataModelById('config-1', TENANT_ID);

      expect(mockDataModel.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'config-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
        },
        include: DETAIL_INCLUDE_SHAPE,
      });
      expect(result).toEqual(CONFIG_RECORD);
    });

    it('returns null when config is not found', async () => {
      mockDataModel.findFirst.mockResolvedValue(null);

      const result = await getDataModelById('nonexistent', TENANT_ID);
      expect(result).toBeNull();
    });
  });

  describe('listDataModels', () => {
    it('returns system and tenant configs', async () => {
      mockDataModel.findMany.mockResolvedValue([CONFIG_RECORD, EXTENSION_RECORD]);
      mockDataModel.count.mockResolvedValue(2);

      const result = await listDataModels(TENANT_ID);

      const expectedWhere = {
        OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT_ID }],
      };
      expect(mockDataModel.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        include: LIST_INCLUDE_SHAPE,
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockDataModel.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('applies isExtension filter', async () => {
      mockDataModel.findMany.mockResolvedValue([CONFIG_RECORD]);
      mockDataModel.count.mockResolvedValue(1);

      await listDataModels(TENANT_ID, { isExtension: false });

      const expectedWhere = expect.objectContaining({ isExtension: false });
      expect(mockDataModel.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        include: LIST_INCLUDE_SHAPE,
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockDataModel.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('applies credentialType filter', async () => {
      mockDataModel.findMany.mockResolvedValue([]);
      mockDataModel.count.mockResolvedValue(0);

      await listDataModels(TENANT_ID, {
        credentialType: 'DigitalProductPassport' as never,
      });

      const expectedWhere = expect.objectContaining({ credentialType: 'DigitalProductPassport' });
      expect(mockDataModel.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        include: LIST_INCLUDE_SHAPE,
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockDataModel.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('applies version filter', async () => {
      mockDataModel.findMany.mockResolvedValue([]);
      mockDataModel.count.mockResolvedValue(0);

      await listDataModels(TENANT_ID, { version: '0.6.0' });

      const expectedWhere = expect.objectContaining({ version: '0.6.0' });
      expect(mockDataModel.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        include: LIST_INCLUDE_SHAPE,
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockDataModel.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('applies pagination', async () => {
      mockDataModel.findMany.mockResolvedValue([]);
      mockDataModel.count.mockResolvedValue(0);

      await listDataModels(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockDataModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });
  });

  describe('updateDataModel', () => {
    it('updates a tenant-owned extension config', async () => {
      mockTx.dataModel.findFirst.mockResolvedValue(EXTENSION_RECORD);
      const updatedRecord = { ...EXTENSION_RECORD, name: 'Updated Name' };
      mockTx.dataModel.update.mockResolvedValue(updatedRecord);

      const result = await updateDataModel('config-ext-1', TENANT_ID, {
        name: 'Updated Name',
      });

      expect(mockTx.dataModel.findFirst).toHaveBeenCalledWith({
        where: { id: 'config-ext-1', tenantId: TENANT_ID, isExtension: true },
      });
      expect(mockTx.dataModel.update).toHaveBeenCalledWith({
        where: { id: 'config-ext-1' },
        data: { name: 'Updated Name' },
        include: DETAIL_INCLUDE_SHAPE,
      });
      expect(result.name).toBe('Updated Name');
    });

    it('throws when config is not tenant-owned', async () => {
      mockTx.dataModel.findFirst.mockResolvedValue(null);

      await expect(updateDataModel('config-1', 'other-tenant', { name: 'Updated' })).rejects.toThrow(
        'Data model not found or access denied',
      );
    });

    it('throws when config is not an extension', async () => {
      mockTx.dataModel.findFirst.mockResolvedValue(null);

      await expect(updateDataModel('config-1', TENANT_ID, { name: 'Updated' })).rejects.toThrow(
        'Data model not found or access denied',
      );
    });

    it('applies partial update with conditional spreads', async () => {
      mockTx.dataModel.findFirst.mockResolvedValue(EXTENSION_RECORD);
      mockTx.dataModel.update.mockResolvedValue({
        ...EXTENSION_RECORD,
        schemaUrl: 'https://example.com/new-schema.json',
      });

      await updateDataModel('config-ext-1', TENANT_ID, {
        schemaUrl: 'https://example.com/new-schema.json',
      });

      expect(mockTx.dataModel.update).toHaveBeenCalledWith({
        where: { id: 'config-ext-1' },
        data: { schemaUrl: 'https://example.com/new-schema.json' },
        include: DETAIL_INCLUDE_SHAPE,
      });
    });
  });

  describe('deleteDataModel', () => {
    it('deletes a tenant-owned extension config', async () => {
      mockTx.dataModel.findFirst.mockResolvedValue(EXTENSION_RECORD);
      mockTx.dataModel.delete.mockResolvedValue(undefined);

      await deleteDataModel('config-ext-1', TENANT_ID);

      expect(mockTx.dataModel.findFirst).toHaveBeenCalledWith({
        where: { id: 'config-ext-1', tenantId: TENANT_ID, isExtension: true },
      });
      expect(mockTx.dataModel.delete).toHaveBeenCalledWith({
        where: { id: 'config-ext-1' },
      });
    });

    it('throws when config is not tenant-owned', async () => {
      mockTx.dataModel.findFirst.mockResolvedValue(null);

      await expect(deleteDataModel('config-1', 'other-tenant')).rejects.toThrow(
        'Data model not found or access denied',
      );
    });
  });
});
