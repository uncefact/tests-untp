import { createProducts, getProductById, listProducts, updateProduct, deleteProduct } from './product.repository';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import {
  prismaForeignKeyViolationError,
  prismaRecordNotFoundError,
  prismaUniqueConstraintError,
} from '@/lib/prisma/db-errors.fixtures';

// Mock Prisma client. Use jest.fn() inside the factory to avoid hoisting issues.
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
      count: jest.fn(),
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
  count: jest.Mock;
};

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

    it('maps a unique-constraint violation on create to ConflictError with a clean message', async () => {
      mockTx.product.create.mockRejectedValue(prismaUniqueConstraintError());

      const result = createProducts(TENANT_ID, [{ name: 'Test Product', level: 'MODEL' }]);

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow(
        'An identifier in this request is already the primary identifier of another product',
      );
    });

    it('rejects duplicate secondary identifiers without hitting the database', async () => {
      mockTx.identifier.findFirst.mockResolvedValue({ id: SECONDARY_ID_1, tenantId: TENANT_ID });

      const result = createProducts(TENANT_ID, [
        { name: 'Product', level: 'MODEL', secondaryIdentifierIds: [SECONDARY_ID_1, SECONDARY_ID_1] },
      ]);

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('Secondary identifiers must not contain duplicates');
      expect(mockTx.product.create).not.toHaveBeenCalled();
    });

    it('maps a foreign-key violation on product creation to ValidationError', async () => {
      mockTx.product.create.mockRejectedValue(prismaForeignKeyViolationError());

      const result = createProducts(TENANT_ID, [{ name: 'Test Product', level: 'MODEL' }]);

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('One or more referenced resources no longer exist');
    });

    it('maps a foreign-key violation on secondary-identifier creation to ValidationError', async () => {
      mockTx.identifier.findFirst.mockResolvedValue({ id: SECONDARY_ID_1, tenantId: TENANT_ID });
      mockTx.product.create.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.productSecondaryIdentifier.createMany.mockRejectedValue(prismaForeignKeyViolationError());

      const result = createProducts(TENANT_ID, [
        { name: 'Product', level: 'MODEL', secondaryIdentifierIds: [SECONDARY_ID_1] },
      ]);

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('One or more secondary identifiers no longer exist');
    });

    it('rethrows a non-database error unchanged', async () => {
      const connectionError = new Error('connection lost');
      mockTx.product.create.mockRejectedValue(connectionError);

      await expect(createProducts(TENANT_ID, [{ name: 'Test Product', level: 'MODEL' }])).rejects.toThrow(
        connectionError,
      );
    });
  });

  describe('getProductById', () => {
    it('returns the product with includes if it belongs to the tenant', async () => {
      mockProduct.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);

      const result = await getProductById(PRODUCT_ID, TENANT_ID);

      expect(mockProduct.findFirst).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID, tenantId: TENANT_ID },
        include: {
          primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: { include: { registrar: true } } } } } },
          producedByOrganisation: true,
          manufacturingFacility: true,
          parent: { include: { primaryIdentifier: { include: { scheme: { include: { registrar: true } } } } } },
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
    const LIST_ROW = {
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
      secondaryIdentifiers: [{ identifierId: 'sec-1' }, { identifierId: 'sec-2' }],
    };

    it('lists products with default pagination and flattens secondaryIdentifierIds', async () => {
      mockProduct.findMany.mockResolvedValue([LIST_ROW]);
      mockProduct.count.mockResolvedValue(1);

      const result = await listProducts(TENANT_ID);

      expect(mockProduct.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        include: {
          secondaryIdentifiers: { select: { identifierId: true } },
        },
        take: DEFAULT_PAGE_LIMIT,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockProduct.count).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
      expect(result.data).toEqual([
        expect.objectContaining({
          id: PRODUCT_ID,
          secondaryIdentifierIds: ['sec-1', 'sec-2'],
        }),
      ]);
      expect(result.total).toBe(1);
      // Ensure raw secondaryIdentifiers is not present
      expect(result.data[0]).not.toHaveProperty('secondaryIdentifiers');
    });

    it('applies custom pagination', async () => {
      mockProduct.findMany.mockResolvedValue([]);
      mockProduct.count.mockResolvedValue(0);

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
      mockProduct.count.mockResolvedValue(0);

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
      mockProduct.count.mockResolvedValue(0);

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
      mockProduct.count.mockResolvedValue(0);

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
      mockProduct.count.mockResolvedValue(0);

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
      mockProduct.count.mockResolvedValue(0);

      await listProducts(TENANT_ID, { facilityId: FACILITY_ID });

      expect(mockProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            manufacturingFacilityId: FACILITY_ID,
          }),
        }),
      );
    });

    it('returns empty data array for no matches', async () => {
      mockProduct.findMany.mockResolvedValue([]);
      mockProduct.count.mockResolvedValue(0);

      const result = await listProducts(TENANT_ID, { search: 'nonexistent' });
      expect(result).toEqual({ data: [], total: 0 });
    });
  });

  describe('updateProduct', () => {
    it('performs a partial update (name only)', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.product.update.mockResolvedValue({ ...PRODUCT_WITH_RELATIONS, name: 'Updated Name' });

      const result = await updateProduct(PRODUCT_ID, TENANT_ID, { name: 'Updated Name' });

      expect(mockTx.product.findFirst).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID, tenantId: TENANT_ID },
      });
      expect(mockTx.product.update).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID },
        data: { name: 'Updated Name' },
        include: {
          primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
          secondaryIdentifiers: { include: { identifier: { include: { scheme: { include: { registrar: true } } } } } },
          producedByOrganisation: true,
          manufacturingFacility: true,
          parent: { include: { primaryIdentifier: { include: { scheme: { include: { registrar: true } } } } } },
        },
      });
      expect(result.name).toBe('Updated Name');
    });

    it('rejects duplicate secondary identifiers without hitting the database', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.identifier.findFirst.mockResolvedValue({ id: SECONDARY_ID_1, tenantId: TENANT_ID });

      const result = updateProduct(PRODUCT_ID, TENANT_ID, {
        secondaryIdentifierIds: [SECONDARY_ID_1, SECONDARY_ID_1],
      });

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('Secondary identifiers must not contain duplicates');
      expect(mockTx.product.update).not.toHaveBeenCalled();
    });

    it('validates producedByOrganisationId FK on update', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.organisationEntity.findFirst.mockResolvedValue(null);

      await expect(
        updateProduct(PRODUCT_ID, TENANT_ID, { producedByOrganisationId: 'nonexistent-org' }),
      ).rejects.toThrow('Organisation not found: nonexistent-org');
    });

    it('validates manufacturingFacilityId FK on update', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.facility.findFirst.mockResolvedValue(null);

      await expect(
        updateProduct(PRODUCT_ID, TENANT_ID, { manufacturingFacilityId: 'nonexistent-facility' }),
      ).rejects.toThrow('Facility not found: nonexistent-facility');
    });

    it('replaces secondary identifiers', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.identifier.findFirst.mockResolvedValue({ id: SECONDARY_ID_1, tenantId: TENANT_ID });
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

    it('maps a foreign-key violation on secondary-identifier replacement to ValidationError', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.identifier.findFirst.mockResolvedValue({ id: SECONDARY_ID_1, tenantId: TENANT_ID });
      mockTx.productSecondaryIdentifier.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.productSecondaryIdentifier.createMany.mockRejectedValue(prismaForeignKeyViolationError());

      const result = updateProduct(PRODUCT_ID, TENANT_ID, {
        secondaryIdentifierIds: [SECONDARY_ID_1],
      });

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('The product or one or more secondary identifiers no longer exist');
      expect(mockTx.product.update).not.toHaveBeenCalled();
    });

    it('maps a unique-constraint violation on secondary-identifier replacement to ConflictError', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.identifier.findFirst.mockResolvedValue({ id: SECONDARY_ID_1, tenantId: TENANT_ID });
      mockTx.productSecondaryIdentifier.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.productSecondaryIdentifier.createMany.mockRejectedValue(prismaUniqueConstraintError());

      const result = updateProduct(PRODUCT_ID, TENANT_ID, {
        secondaryIdentifierIds: [SECONDARY_ID_1],
      });

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow(
        'One or more secondary identifiers were concurrently linked to this product; retry the request',
      );
      expect(mockTx.product.update).not.toHaveBeenCalled();
    });

    it('clears secondary identifiers with empty array', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
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

    it('validates hierarchy when setting parentId on a MODEL product', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS); // existing is MODEL

      await expect(updateProduct(PRODUCT_ID, TENANT_ID, { parentId: PARENT_ID })).rejects.toThrow(
        'MODEL products cannot have a parent',
      );
    });

    it('validates hierarchy when clearing parentId on a BATCH product', async () => {
      const batchProduct = { ...PRODUCT_WITH_RELATIONS, level: 'BATCH', parentId: PARENT_ID };
      mockTx.product.findFirst.mockResolvedValue(batchProduct);

      await expect(updateProduct(PRODUCT_ID, TENANT_ID, { parentId: null })).rejects.toThrow(
        'BATCH products require a MODEL parent',
      );
    });

    it('validates parent level when updating parentId on a BATCH product', async () => {
      const batchProduct = { ...PRODUCT_WITH_RELATIONS, level: 'BATCH', parentId: PARENT_ID };
      mockTx.product.findFirst
        .mockResolvedValueOnce(batchProduct) // existing product
        .mockResolvedValueOnce(BATCH_PRODUCT); // parent lookup returns a BATCH (invalid)

      await expect(updateProduct(PRODUCT_ID, TENANT_ID, { parentId: 'batch-1' })).rejects.toThrow(
        'BATCH parent must be a MODEL product',
      );
    });

    it('validates primary identifier ownership on update', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.identifier.findFirst.mockResolvedValue(null);

      await expect(updateProduct(PRODUCT_ID, TENANT_ID, { primaryIdentifierId: 'nonexistent-ident' })).rejects.toThrow(
        'Identifier not found: nonexistent-ident',
      );
    });

    it('throws NotFoundError for ownership check failure', async () => {
      mockTx.product.findFirst.mockResolvedValue(null);

      await expect(updateProduct(PRODUCT_ID, 'other-tenant', { name: 'Updated' })).rejects.toThrow('Product not found');
    });

    it('maps a unique-constraint violation on update to ConflictError with a clean message', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.product.update.mockRejectedValue(prismaUniqueConstraintError());

      const result = updateProduct(PRODUCT_ID, TENANT_ID, { name: 'Updated Name' });

      await expect(result).rejects.toThrow(ConflictError);
      await expect(result).rejects.toThrow('The identifier is already the primary identifier of another product');
    });

    it('maps a record-not-found race on update to NotFoundError', async () => {
      mockTx.product.findFirst.mockResolvedValue(PRODUCT_WITH_RELATIONS);
      mockTx.product.update.mockRejectedValue(prismaRecordNotFoundError());

      const result = updateProduct(PRODUCT_ID, TENANT_ID, { name: 'Updated Name' });

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Product or a referenced resource not found');
    });
  });

  describe('deleteProduct', () => {
    it('deletes a product with no children', async () => {
      mockTx.product.findFirst.mockResolvedValue(MODEL_PRODUCT);
      mockTx.product.findMany.mockResolvedValue([]);
      mockTx.product.delete.mockResolvedValue(MODEL_PRODUCT);

      const result = await deleteProduct(PARENT_ID, TENANT_ID);

      expect(mockTx.product.findFirst).toHaveBeenCalledWith({
        where: { id: PARENT_ID, tenantId: TENANT_ID },
      });
      expect(mockTx.product.findMany).toHaveBeenCalledWith({
        where: { parentId: PARENT_ID, tenantId: TENANT_ID },
      });
      expect(mockTx.product.delete).toHaveBeenCalledWith({
        where: { id: PARENT_ID },
      });
      expect(result).toEqual(MODEL_PRODUCT);
    });

    it('blocks deletion when BATCH children exist', async () => {
      mockTx.product.findFirst.mockResolvedValue(MODEL_PRODUCT);
      mockTx.product.findMany.mockResolvedValue([
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

      mockTx.product.findFirst.mockResolvedValue(BATCH_PRODUCT);
      mockTx.product.findMany.mockResolvedValue([itemChild]);
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
      mockTx.product.findFirst.mockResolvedValue(null);

      await expect(deleteProduct(PRODUCT_ID, 'other-tenant')).rejects.toThrow('Product not found');
    });

    it('maps a record-not-found race on delete to NotFoundError', async () => {
      mockTx.product.findFirst.mockResolvedValue(MODEL_PRODUCT);
      mockTx.product.findMany.mockResolvedValue([]);
      mockTx.product.delete.mockRejectedValue(prismaRecordNotFoundError());

      const result = deleteProduct(PARENT_ID, TENANT_ID);

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Product not found');
    });

    it('maps a foreign-key violation on delete to ValidationError', async () => {
      mockTx.product.findFirst.mockResolvedValue(MODEL_PRODUCT);
      mockTx.product.findMany.mockResolvedValue([]);
      mockTx.product.delete.mockRejectedValue(prismaForeignKeyViolationError());

      const result = deleteProduct(PARENT_ID, TENANT_ID);

      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow('Cannot delete: dependent products exist');
    });
  });
});
