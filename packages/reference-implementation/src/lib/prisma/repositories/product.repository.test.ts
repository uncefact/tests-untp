import { createProducts, getProductById, listProducts, updateProduct, deleteProduct } from './product.repository';

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
const mockTx = {
  product: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  identifier: {
    findFirst: jest.fn(),
  },
  organisationEntity: {
    findFirst: jest.fn(),
  },
  facility: {
    findFirst: jest.fn(),
  },
  productSecondaryIdentifier: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};

jest.mock('../prisma', () => ({
  prisma: {
    product: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    identifier: {
      findFirst: jest.fn(),
    },
    organisationEntity: {
      findFirst: jest.fn(),
    },
    facility: {
      findFirst: jest.fn(),
    },
    productSecondaryIdentifier: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockProduct = prisma.product as unknown as {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

const mockIdentifier = (prisma as unknown as { identifier: { findFirst: jest.Mock } }).identifier;
const mockOrganisationEntity = (prisma as unknown as { organisationEntity: { findFirst: jest.Mock } })
  .organisationEntity;
const mockFacility = (prisma as unknown as { facility: { findFirst: jest.Mock } }).facility;

describe('product.repository', () => {
  const TENANT_ID = 'tenant-1';
  const PRODUCT_ID = 'product-1';
  const PARENT_ID = 'parent-1';
  const ORG_ID = 'org-1';
  const FACILITY_ID = 'facility-1';
  const IDENTIFIER_ID = 'ident-1';
  const SECONDARY_ID_1 = 'sec-ident-1';

  const MODEL_PRODUCT = {
    id: PARENT_ID,
    tenantId: TENANT_ID,
    name: 'Widget Model',
    description: 'A model product',
    level: 'MODEL',
    parentId: null,
    producedByOrganisationId: null,
    manufacturingFacilityId: null,
    primaryIdentifierId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const BATCH_PRODUCT = {
    id: 'batch-1',
    tenantId: TENANT_ID,
    name: 'Widget Batch 001',
    description: 'A batch product',
    level: 'BATCH',
    parentId: PARENT_ID,
    producedByOrganisationId: null,
    manufacturingFacilityId: null,
    primaryIdentifierId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const PRODUCT_WITH_RELATIONS = {
    id: PRODUCT_ID,
    tenantId: TENANT_ID,
    name: 'Test Product',
    description: 'A test product',
    level: 'MODEL',
    parentId: null,
    producedByOrganisationId: null,
    manufacturingFacilityId: null,
    primaryIdentifierId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    primaryIdentifier: null,
    secondaryIdentifiers: [],
    producedByOrganisation: null,
    manufacturingFacility: null,
    parent: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (tx: typeof mockTx) => unknown) => cb(mockTx));
  });

  describe('createProducts', () => {
    it('creates a single MODEL product with no parent', async () => {
      mockTx.product.create.mockResolvedValue(PRODUCT_WITH_RELATIONS);

      const result = await createProducts(TENANT_ID, [{ name: 'Test Product', level: 'MODEL' }]);

      expect(result).toEqual([PRODUCT_WITH_RELATIONS]);
      expect(mockTx.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            name: 'Test Product',
            level: 'MODEL',
          }),
        }),
      );
    });

    it('creates a BATCH product with a MODEL parent', async () => {
      mockTx.product.findFirst.mockResolvedValue(MODEL_PRODUCT);
      mockTx.product.create.mockResolvedValue({
        ...PRODUCT_WITH_RELATIONS,
        level: 'BATCH',
        parentId: PARENT_ID,
        parent: MODEL_PRODUCT,
      });

      const result = await createProducts(TENANT_ID, [{ name: 'Batch Product', level: 'BATCH', parentId: PARENT_ID }]);

      expect(result).toHaveLength(1);
      expect(result[0].level).toBe('BATCH');
      expect(mockTx.product.findFirst).toHaveBeenCalledWith({
        where: { id: PARENT_ID, tenantId: TENANT_ID },
      });
    });

    it('creates an ITEM product with no parent', async () => {
      mockTx.product.create.mockResolvedValue({
        ...PRODUCT_WITH_RELATIONS,
        level: 'ITEM',
      });

      const result = await createProducts(TENANT_ID, [{ name: 'Item Product', level: 'ITEM' }]);

      expect(result).toHaveLength(1);
      expect(result[0].level).toBe('ITEM');
    });

    it('creates an ITEM product with a BATCH parent', async () => {
      mockTx.product.findFirst.mockResolvedValue(BATCH_PRODUCT);
      mockTx.product.create.mockResolvedValue({
        ...PRODUCT_WITH_RELATIONS,
        level: 'ITEM',
        parentId: 'batch-1',
        parent: BATCH_PRODUCT,
      });

      const result = await createProducts(TENANT_ID, [{ name: 'Item Product', level: 'ITEM', parentId: 'batch-1' }]);

      expect(result).toHaveLength(1);
      expect(result[0].level).toBe('ITEM');
    });

    it('rejects MODEL with a parent', async () => {
      await expect(
        createProducts(TENANT_ID, [{ name: 'Bad Model', level: 'MODEL', parentId: PARENT_ID }]),
      ).rejects.toThrow('MODEL products cannot have a parent');
    });

    it('rejects BATCH without a parent', async () => {
      await expect(createProducts(TENANT_ID, [{ name: 'Bad Batch', level: 'BATCH' }])).rejects.toThrow(
        'BATCH products require a MODEL parent',
      );
    });

    it('rejects BATCH with a non-MODEL parent', async () => {
      mockTx.product.findFirst.mockResolvedValue(BATCH_PRODUCT);

      await expect(
        createProducts(TENANT_ID, [{ name: 'Bad Batch', level: 'BATCH', parentId: 'batch-1' }]),
      ).rejects.toThrow('BATCH parent must be a MODEL product');
    });

    it('rejects ITEM with a MODEL parent', async () => {
      mockTx.product.findFirst.mockResolvedValue(MODEL_PRODUCT);

      await expect(
        createProducts(TENANT_ID, [{ name: 'Bad Item', level: 'ITEM', parentId: PARENT_ID }]),
      ).rejects.toThrow('ITEM parent must be a BATCH product');
    });

    it('validates producedByOrganisationId belongs to tenant', async () => {
      mockTx.organisationEntity.findFirst.mockResolvedValue(null);

      await expect(
        createProducts(TENANT_ID, [{ name: 'Product', level: 'MODEL', producedByOrganisationId: 'nonexistent-org' }]),
      ).rejects.toThrow('Organisation not found: nonexistent-org');
    });

    it('validates manufacturingFacilityId belongs to tenant', async () => {
      mockTx.facility.findFirst.mockResolvedValue(null);

      await expect(
        createProducts(TENANT_ID, [
          { name: 'Product', level: 'MODEL', manufacturingFacilityId: 'nonexistent-facility' },
        ]),
      ).rejects.toThrow('Facility not found: nonexistent-facility');
    });

    it('validates primary identifier belongs to tenant', async () => {
      mockTx.identifier.findFirst.mockResolvedValue(null);

      await expect(
        createProducts(TENANT_ID, [{ name: 'Product', level: 'MODEL', primaryIdentifierId: 'nonexistent-ident' }]),
      ).rejects.toThrow('Identifier not found: nonexistent-ident');
    });

    it('validates secondary identifiers belong to tenant', async () => {
      // First call succeeds (primary identifier), second call fails (secondary)
      mockTx.identifier.findFirst
        .mockResolvedValueOnce({ id: IDENTIFIER_ID, tenantId: TENANT_ID })
        .mockResolvedValueOnce(null);

      await expect(
        createProducts(TENANT_ID, [
          {
            name: 'Product',
            level: 'MODEL',
            primaryIdentifierId: IDENTIFIER_ID,
            secondaryIdentifierIds: ['nonexistent-sec'],
          },
        ]),
      ).rejects.toThrow('Identifier not found: nonexistent-sec');
    });

    it('rejects primary identifier that is also a secondary identifier', async () => {
      mockTx.identifier.findFirst.mockResolvedValue({ id: IDENTIFIER_ID, tenantId: TENANT_ID });

      await expect(
        createProducts(TENANT_ID, [
          {
            name: 'Product',
            level: 'MODEL',
            primaryIdentifierId: IDENTIFIER_ID,
            secondaryIdentifierIds: [IDENTIFIER_ID],
          },
        ]),
      ).rejects.toThrow('Primary identifier cannot also be a secondary identifier');
    });
  });

  describe('getProductById', () => {
    it('returns the product with includes if it belongs to the tenant', async () => {
      mockProduct.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);

      const result = await getProductById(PRODUCT_ID, TENANT_ID);

      expect(mockProduct.findFirst).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID, tenantId: TENANT_ID },
        include: {
          primaryIdentifier: { include: { scheme: true } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: true } } } },
          producedByOrganisation: true,
          manufacturingFacility: true,
          parent: true,
        },
      });
      expect(result).toEqual(PRODUCT_WITH_RELATIONS);
    });

    it('returns null for a product from another tenant', async () => {
      mockProduct.findFirst.mockResolvedValue(null);

      const result = await getProductById(PRODUCT_ID, 'other-tenant');
      expect(result).toBeNull();
    });
  });

  describe('listProducts', () => {
    it('lists products with default pagination', async () => {
      mockProduct.findMany.mockResolvedValue([PRODUCT_WITH_RELATIONS]);

      const result = await listProducts(TENANT_ID);

      expect(mockProduct.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        include: {
          primaryIdentifier: { include: { scheme: true } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: true } } } },
          producedByOrganisation: true,
          manufacturingFacility: true,
          parent: true,
        },
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([PRODUCT_WITH_RELATIONS]);
    });

    it('applies custom pagination', async () => {
      mockProduct.findMany.mockResolvedValue([]);

      await listProducts(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });

    it('searches by name', async () => {
      mockProduct.findMany.mockResolvedValue([]);

      await listProducts(TENANT_ID, { search: 'Widget' });

      expect(mockProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: 'Widget', mode: 'insensitive' } },
              { primaryIdentifier: { value: { contains: 'Widget', mode: 'insensitive' } } },
              {
                secondaryIdentifiers: {
                  some: {
                    identifier: { value: { contains: 'Widget', mode: 'insensitive' } },
                  },
                },
              },
            ],
          }),
        }),
      );
    });

    it('filters by level', async () => {
      mockProduct.findMany.mockResolvedValue([]);

      await listProducts(TENANT_ID, { level: 'MODEL' });

      expect(mockProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            level: 'MODEL',
          }),
        }),
      );
    });

    it('filters by parentId', async () => {
      mockProduct.findMany.mockResolvedValue([]);

      await listProducts(TENANT_ID, { parentId: PARENT_ID });

      expect(mockProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            parentId: PARENT_ID,
          }),
        }),
      );
    });

    it('filters by organisationId (maps to producedByOrganisationId)', async () => {
      mockProduct.findMany.mockResolvedValue([]);

      await listProducts(TENANT_ID, { organisationId: ORG_ID });

      expect(mockProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            producedByOrganisationId: ORG_ID,
          }),
        }),
      );
    });

    it('filters by facilityId (maps to manufacturingFacilityId)', async () => {
      mockProduct.findMany.mockResolvedValue([]);

      await listProducts(TENANT_ID, { facilityId: FACILITY_ID });

      expect(mockProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            manufacturingFacilityId: FACILITY_ID,
          }),
        }),
      );
    });

    it('returns empty array for no matches', async () => {
      mockProduct.findMany.mockResolvedValue([]);

      const result = await listProducts(TENANT_ID, { search: 'nonexistent' });
      expect(result).toEqual([]);
    });
  });

  describe('updateProduct', () => {
    it('performs a partial update (name only)', async () => {
      mockProduct.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockProduct.update.mockResolvedValue({ ...PRODUCT_WITH_RELATIONS, name: 'Updated Name' });

      const result = await updateProduct(PRODUCT_ID, TENANT_ID, { name: 'Updated Name' });

      expect(mockProduct.findFirst).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID, tenantId: TENANT_ID },
      });
      expect(mockProduct.update).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID },
        data: { name: 'Updated Name' },
        include: {
          primaryIdentifier: { include: { scheme: true } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: true } } } },
          producedByOrganisation: true,
          manufacturingFacility: true,
          parent: true,
        },
      });
      expect(result.name).toBe('Updated Name');
    });

    it('validates producedByOrganisationId FK on update', async () => {
      mockProduct.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockOrganisationEntity.findFirst.mockResolvedValue(null);

      await expect(
        updateProduct(PRODUCT_ID, TENANT_ID, { producedByOrganisationId: 'nonexistent-org' }),
      ).rejects.toThrow('Organisation not found: nonexistent-org');
    });

    it('validates manufacturingFacilityId FK on update', async () => {
      mockProduct.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockFacility.findFirst.mockResolvedValue(null);

      await expect(
        updateProduct(PRODUCT_ID, TENANT_ID, { manufacturingFacilityId: 'nonexistent-facility' }),
      ).rejects.toThrow('Facility not found: nonexistent-facility');
    });

    it('replaces secondary identifiers', async () => {
      mockProduct.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockIdentifier.findFirst.mockResolvedValue({ id: SECONDARY_ID_1, tenantId: TENANT_ID });
      mockTx.productSecondaryIdentifier.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.productSecondaryIdentifier.createMany.mockResolvedValue({ count: 1 });
      mockTx.product.update.mockResolvedValue({
        ...PRODUCT_WITH_RELATIONS,
        secondaryIdentifiers: [{ productId: PRODUCT_ID, identifierId: SECONDARY_ID_1 }],
      });

      const result = await updateProduct(PRODUCT_ID, TENANT_ID, {
        secondaryIdentifierIds: [SECONDARY_ID_1],
      });

      expect(mockTx.productSecondaryIdentifier.deleteMany).toHaveBeenCalledWith({
        where: { productId: PRODUCT_ID },
      });
      expect(mockTx.productSecondaryIdentifier.createMany).toHaveBeenCalledWith({
        data: [{ productId: PRODUCT_ID, identifierId: SECONDARY_ID_1 }],
      });
      expect(result.secondaryIdentifiers).toHaveLength(1);
    });

    it('clears secondary identifiers with empty array', async () => {
      mockProduct.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.productSecondaryIdentifier.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.product.update.mockResolvedValue({
        ...PRODUCT_WITH_RELATIONS,
        secondaryIdentifiers: [],
      });

      const result = await updateProduct(PRODUCT_ID, TENANT_ID, {
        secondaryIdentifierIds: [],
      });

      expect(mockTx.productSecondaryIdentifier.deleteMany).toHaveBeenCalledWith({
        where: { productId: PRODUCT_ID },
      });
      expect(mockTx.productSecondaryIdentifier.createMany).not.toHaveBeenCalled();
      expect(result.secondaryIdentifiers).toEqual([]);
    });

    it('throws NotFoundError for ownership check failure', async () => {
      mockProduct.findFirst.mockResolvedValue(null);

      await expect(updateProduct(PRODUCT_ID, 'other-tenant', { name: 'Updated' })).rejects.toThrow(
        'Product not found or access denied',
      );
    });
  });

  describe('deleteProduct', () => {
    it('deletes a product with no children', async () => {
      mockProduct.findFirst.mockResolvedValue(MODEL_PRODUCT);
      mockProduct.findMany.mockResolvedValue([]);
      mockTx.product.delete.mockResolvedValue(MODEL_PRODUCT);

      const result = await deleteProduct(PARENT_ID, TENANT_ID);

      expect(mockProduct.findFirst).toHaveBeenCalledWith({
        where: { id: PARENT_ID, tenantId: TENANT_ID },
      });
      expect(mockProduct.findMany).toHaveBeenCalledWith({
        where: { parentId: PARENT_ID, tenantId: TENANT_ID },
      });
      expect(mockTx.product.delete).toHaveBeenCalledWith({
        where: { id: PARENT_ID },
      });
      expect(result).toEqual(MODEL_PRODUCT);
    });

    it('blocks deletion when BATCH children exist', async () => {
      mockProduct.findFirst.mockResolvedValue(MODEL_PRODUCT);
      mockProduct.findMany.mockResolvedValue([
        { ...BATCH_PRODUCT, id: 'batch-1' },
        { ...BATCH_PRODUCT, id: 'batch-2' },
      ]);

      await expect(deleteProduct(PARENT_ID, TENANT_ID)).rejects.toThrow(
        'Cannot delete: 2 BATCH product(s) depend on this MODEL',
      );
    });

    it('detaches ITEM children and deletes the product', async () => {
      const itemChild = {
        id: 'item-1',
        tenantId: TENANT_ID,
        name: 'Item Child',
        level: 'ITEM',
        parentId: BATCH_PRODUCT.id,
      };

      mockProduct.findFirst.mockResolvedValue(BATCH_PRODUCT);
      mockProduct.findMany.mockResolvedValue([itemChild]);
      mockTx.product.updateMany.mockResolvedValue({ count: 1 });
      mockTx.product.delete.mockResolvedValue(BATCH_PRODUCT);

      const result = await deleteProduct(BATCH_PRODUCT.id, TENANT_ID);

      expect(mockTx.product.updateMany).toHaveBeenCalledWith({
        where: { parentId: BATCH_PRODUCT.id, level: 'ITEM' },
        data: { parentId: null },
      });
      expect(mockTx.product.delete).toHaveBeenCalledWith({
        where: { id: BATCH_PRODUCT.id },
      });
      expect(result).toEqual(BATCH_PRODUCT);
    });

    it('throws NotFoundError for another tenant', async () => {
      mockProduct.findFirst.mockResolvedValue(null);

      await expect(deleteProduct(PRODUCT_ID, 'other-tenant')).rejects.toThrow('Product not found or access denied');
    });
  });
});
