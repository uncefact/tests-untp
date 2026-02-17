import {
  createCredentialTypeConfig,
  getCredentialTypeConfigById,
  listCredentialTypeConfigs,
  updateCredentialTypeConfig,
  deleteCredentialTypeConfig,
} from './credential-type-config.repository';

// Transaction mock — functions called via $transaction callback
const mockTx = {
  credentialTypeConfig: {
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
    credentialTypeConfig: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockCredentialTypeConfig = prisma.credentialTypeConfig as unknown as {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
};

const INCLUDE_SHAPE = {
  parentConfig: true,
  extensions: true,
  renderTemplates: true,
};

describe('credential-type-config.repository', () => {
  const TENANT_ID = 'tenant-1';
  const CONFIG_RECORD = {
    id: 'config-1',
    tenantId: null,
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

  describe('createCredentialTypeConfig', () => {
    it('creates a core config successfully', async () => {
      mockTx.credentialTypeConfig.create.mockResolvedValue(CONFIG_RECORD);

      const result = await createCredentialTypeConfig(TENANT_ID, {
        name: 'Digital Product Passport v0.6.0',
        credentialType: 'DigitalProductPassport' as never,
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        isExtension: false,
      });

      expect(mockTx.credentialTypeConfig.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          name: 'Digital Product Passport v0.6.0',
          credentialType: 'DigitalProductPassport',
          version: '0.6.0',
          schemaUrl: 'https://example.com/schema.json',
          contextUrl: 'https://example.com/context.jsonld',
          isExtension: false,
        },
        include: INCLUDE_SHAPE,
      });
      expect(result).toEqual(CONFIG_RECORD);
    });

    it('creates an extension config with valid parent', async () => {
      mockTx.credentialTypeConfig.findFirst.mockResolvedValue(CONFIG_RECORD);
      mockTx.credentialTypeConfig.create.mockResolvedValue(EXTENSION_RECORD);

      const result = await createCredentialTypeConfig(TENANT_ID, {
        name: 'Custom DPP Extension',
        credentialType: 'DigitalProductPassport' as never,
        version: '0.6.0',
        schemaUrl: 'https://example.com/ext-schema.json',
        contextUrl: 'https://example.com/ext-context.jsonld',
        isExtension: true,
        parentConfigId: 'config-1',
      });

      expect(mockTx.credentialTypeConfig.findFirst).toHaveBeenCalledWith({
        where: { id: 'config-1' },
      });
      expect(mockTx.credentialTypeConfig.create).toHaveBeenCalled();
      expect(result).toEqual(EXTENSION_RECORD);
    });

    it('throws when isExtension is true but parentConfigId is missing', async () => {
      await expect(
        createCredentialTypeConfig(TENANT_ID, {
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
      mockTx.credentialTypeConfig.findFirst.mockResolvedValue(null);

      await expect(
        createCredentialTypeConfig(TENANT_ID, {
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
      mockTx.credentialTypeConfig.findFirst.mockResolvedValue({
        ...CONFIG_RECORD,
        isExtension: true,
      });

      await expect(
        createCredentialTypeConfig(TENANT_ID, {
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
      mockTx.credentialTypeConfig.findFirst.mockResolvedValue(CONFIG_RECORD);
      mockTx.credentialTypeConfig.create.mockResolvedValue(EXTENSION_RECORD);

      await createCredentialTypeConfig(TENANT_ID, {
        name: 'Default Extension',
        credentialType: 'DigitalProductPassport' as never,
        version: '0.6.0',
        schemaUrl: 'https://example.com/schema.json',
        contextUrl: 'https://example.com/context.jsonld',
        parentConfigId: 'config-1',
      });

      expect(mockTx.credentialTypeConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isExtension: true,
          parentConfigId: 'config-1',
        }),
        include: INCLUDE_SHAPE,
      });
    });
  });

  describe('getCredentialTypeConfigById', () => {
    it('returns config visible to tenant or system-provisioned', async () => {
      mockCredentialTypeConfig.findFirst.mockResolvedValue(CONFIG_RECORD);

      const result = await getCredentialTypeConfigById('config-1', TENANT_ID);

      expect(mockCredentialTypeConfig.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'config-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: null }],
        },
        include: INCLUDE_SHAPE,
      });
      expect(result).toEqual(CONFIG_RECORD);
    });

    it('returns null when config is not found', async () => {
      mockCredentialTypeConfig.findFirst.mockResolvedValue(null);

      const result = await getCredentialTypeConfigById('nonexistent', TENANT_ID);
      expect(result).toBeNull();
    });
  });

  describe('listCredentialTypeConfigs', () => {
    it('returns system and tenant configs', async () => {
      mockCredentialTypeConfig.findMany.mockResolvedValue([CONFIG_RECORD, EXTENSION_RECORD]);

      const result = await listCredentialTypeConfigs(TENANT_ID);

      expect(mockCredentialTypeConfig.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: TENANT_ID }, { tenantId: null }],
        },
        include: INCLUDE_SHAPE,
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(2);
    });

    it('applies isExtension filter', async () => {
      mockCredentialTypeConfig.findMany.mockResolvedValue([CONFIG_RECORD]);

      await listCredentialTypeConfigs(TENANT_ID, { isExtension: false });

      expect(mockCredentialTypeConfig.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          isExtension: false,
        }),
        include: INCLUDE_SHAPE,
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('applies credentialType filter', async () => {
      mockCredentialTypeConfig.findMany.mockResolvedValue([]);

      await listCredentialTypeConfigs(TENANT_ID, {
        credentialType: 'DigitalProductPassport' as never,
      });

      expect(mockCredentialTypeConfig.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          credentialType: 'DigitalProductPassport',
        }),
        include: INCLUDE_SHAPE,
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('applies version filter', async () => {
      mockCredentialTypeConfig.findMany.mockResolvedValue([]);

      await listCredentialTypeConfigs(TENANT_ID, { version: '0.6.0' });

      expect(mockCredentialTypeConfig.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          version: '0.6.0',
        }),
        include: INCLUDE_SHAPE,
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('applies pagination', async () => {
      mockCredentialTypeConfig.findMany.mockResolvedValue([]);

      await listCredentialTypeConfigs(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockCredentialTypeConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });
  });

  describe('updateCredentialTypeConfig', () => {
    it('updates a tenant-owned extension config', async () => {
      mockTx.credentialTypeConfig.findFirst.mockResolvedValue(EXTENSION_RECORD);
      const updatedRecord = { ...EXTENSION_RECORD, name: 'Updated Name' };
      mockTx.credentialTypeConfig.update.mockResolvedValue(updatedRecord);

      const result = await updateCredentialTypeConfig('config-ext-1', TENANT_ID, {
        name: 'Updated Name',
      });

      expect(mockTx.credentialTypeConfig.findFirst).toHaveBeenCalledWith({
        where: { id: 'config-ext-1', tenantId: TENANT_ID, isExtension: true },
      });
      expect(mockTx.credentialTypeConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-ext-1' },
        data: { name: 'Updated Name' },
        include: INCLUDE_SHAPE,
      });
      expect(result.name).toBe('Updated Name');
    });

    it('throws when config is not tenant-owned', async () => {
      mockTx.credentialTypeConfig.findFirst.mockResolvedValue(null);

      await expect(updateCredentialTypeConfig('config-1', 'other-tenant', { name: 'Updated' })).rejects.toThrow(
        'Credential type config not found or access denied',
      );
    });

    it('throws when config is not an extension', async () => {
      mockTx.credentialTypeConfig.findFirst.mockResolvedValue(null);

      await expect(updateCredentialTypeConfig('config-1', TENANT_ID, { name: 'Updated' })).rejects.toThrow(
        'Credential type config not found or access denied',
      );
    });

    it('applies partial update with conditional spreads', async () => {
      mockTx.credentialTypeConfig.findFirst.mockResolvedValue(EXTENSION_RECORD);
      mockTx.credentialTypeConfig.update.mockResolvedValue({
        ...EXTENSION_RECORD,
        schemaUrl: 'https://example.com/new-schema.json',
      });

      await updateCredentialTypeConfig('config-ext-1', TENANT_ID, {
        schemaUrl: 'https://example.com/new-schema.json',
      });

      expect(mockTx.credentialTypeConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-ext-1' },
        data: { schemaUrl: 'https://example.com/new-schema.json' },
        include: INCLUDE_SHAPE,
      });
    });
  });

  describe('deleteCredentialTypeConfig', () => {
    it('deletes a tenant-owned extension config', async () => {
      mockTx.credentialTypeConfig.findFirst.mockResolvedValue(EXTENSION_RECORD);
      mockTx.credentialTypeConfig.delete.mockResolvedValue(EXTENSION_RECORD);

      const result = await deleteCredentialTypeConfig('config-ext-1', TENANT_ID);

      expect(mockTx.credentialTypeConfig.findFirst).toHaveBeenCalledWith({
        where: { id: 'config-ext-1', tenantId: TENANT_ID, isExtension: true },
      });
      expect(mockTx.credentialTypeConfig.delete).toHaveBeenCalledWith({
        where: { id: 'config-ext-1' },
        include: INCLUDE_SHAPE,
      });
      expect(result).toEqual(EXTENSION_RECORD);
    });

    it('throws when config is not tenant-owned', async () => {
      mockTx.credentialTypeConfig.findFirst.mockResolvedValue(null);

      await expect(deleteCredentialTypeConfig('config-1', 'other-tenant')).rejects.toThrow(
        'Credential type config not found or access denied',
      );
    });
  });
});
