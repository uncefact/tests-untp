import { Product, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';

/**
 * Shared include fragment for an identifier with its scheme and registrar.
 * Used for primary identifiers on both the product and its parent.
 */
const IDENTIFIER_INCLUDE = { include: { scheme: { include: { registrar: true } } } } as const;

/**
 * Full relations for detail endpoints.
 * Includes the primary identifier (with scheme and registrar), secondary
 * identifiers (via the join table, each with its identifier, scheme, and
 * registrar), brand organisation, manufacturing facility, and parent product
 * (with its primary identifier for qualifier-based URI construction).
 * The registrar is needed to construct ISO 18975 resolver URIs for UNTP credentials.
 */
const PRODUCT_DETAIL_INCLUDE = {
  primaryIdentifier: IDENTIFIER_INCLUDE,
  secondaryIdentifiers: { include: { identifier: IDENTIFIER_INCLUDE } },
  producedByOrganisation: true,
  manufacturingFacility: true,
  parent: { include: { primaryIdentifier: IDENTIFIER_INCLUDE } },
} as const;

/** Lightweight include for list endpoint. */
const PRODUCT_LIST_INCLUDE = {
  secondaryIdentifiers: { select: { identifierId: true } },
} as const;

/**
 * A product with its full relations.
 * Matches the include shape defined by PRODUCT_DETAIL_INCLUDE.
 */
export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_DETAIL_INCLUDE;
}>;

/** Raw row returned by the list query (before flattening). */
type ProductListRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_LIST_INCLUDE }>;

/** Lightweight product returned by the list endpoint. */
export type ProductListItem = Omit<ProductListRow, 'secondaryIdentifiers'> & {
  secondaryIdentifierIds: string[];
};

/**
 * Input for creating a new product.
 */
export type CreateProductInput = {
  name: string;
  description?: string;
  level: 'MODEL' | 'BATCH' | 'ITEM';
  parentId?: string;
  producedByOrganisationId?: string;
  manufacturingFacilityId?: string;
  primaryIdentifierId?: string;
  secondaryIdentifierIds?: string[];
};

/**
 * Input for updating an existing product.
 * Level is immutable and cannot be changed after creation.
 * Fields set to undefined are left unchanged.
 * Fields set to null clear the relation.
 */
export type UpdateProductInput = {
  name?: string;
  description?: string;
  parentId?: string | null;
  producedByOrganisationId?: string | null;
  manufacturingFacilityId?: string | null;
  primaryIdentifierId?: string | null;
  secondaryIdentifierIds?: string[];
};

/**
 * Options for listing products.
 */
export type ListProductsOptions = {
  search?: string;
  level?: 'MODEL' | 'BATCH' | 'ITEM';
  parentId?: string;
  organisationId?: string;
  facilityId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Validates the product hierarchy constraints based on level.
 * MODEL products cannot have a parent.
 * BATCH products require a MODEL parent.
 * ITEM products may optionally have a BATCH parent.
 */
function validateProductHierarchy(level: string, parentId: string | undefined, parent: Product | null): void {
  switch (level) {
    case 'MODEL':
      if (parentId) throw new ValidationError('MODEL products cannot have a parent');
      break;
    case 'BATCH':
      if (!parentId) throw new ValidationError('BATCH products require a MODEL parent');
      if (!parent) throw new NotFoundError('Parent product not found');
      if (parent.level !== 'MODEL') throw new ValidationError('BATCH parent must be a MODEL product');
      break;
    case 'ITEM':
      if (parentId) {
        if (!parent) throw new NotFoundError('Parent product not found');
        if (parent.level !== 'BATCH') throw new ValidationError('ITEM parent must be a BATCH product');
      }
      break;
  }
}

/**
 * Validates that an identifier belongs to the given tenant.
 * Runs within a transaction client.
 */
async function validateIdentifierOwnership(
  tx: Prisma.TransactionClient,
  identifierId: string,
  tenantId: string,
): Promise<void> {
  const ident = await tx.identifier.findFirst({ where: { id: identifierId, tenantId } });
  if (!ident) {
    throw new NotFoundError(`Identifier not found: ${identifierId}`);
  }
}

/**
 * Validates that the primary identifier is not also listed as a secondary identifier.
 */
function validateNoPrimarySecondaryOverlap(
  primaryIdentifierId: string | undefined | null,
  secondaryIdentifierIds: string[] | undefined,
): void {
  if (primaryIdentifierId && secondaryIdentifierIds?.includes(primaryIdentifierId)) {
    throw new ValidationError('Primary identifier cannot also be a secondary identifier');
  }
}

/**
 * Creates one or more products in a single transaction.
 * Validates hierarchy constraints, foreign key references, and identifier ownership.
 */
export async function createProducts(tenantId: string, inputs: CreateProductInput[]): Promise<ProductWithRelations[]> {
  return prisma.$transaction(async (tx) => {
    const results: ProductWithRelations[] = [];

    for (const input of inputs) {
      // Look up parent if specified
      let parent: Product | null = null;
      if (input.parentId) {
        parent = await tx.product.findFirst({ where: { id: input.parentId, tenantId } });
      }

      // Validate hierarchy constraints
      validateProductHierarchy(input.level, input.parentId, parent);

      // Validate brand organisation belongs to tenant
      if (input.producedByOrganisationId) {
        const org = await tx.organisationEntity.findFirst({
          where: { id: input.producedByOrganisationId, tenantId },
        });
        if (!org) {
          throw new NotFoundError(`Organisation not found: ${input.producedByOrganisationId}`);
        }
      }

      // Validate manufacturing facility belongs to tenant
      if (input.manufacturingFacilityId) {
        const facility = await tx.facility.findFirst({
          where: { id: input.manufacturingFacilityId, tenantId },
        });
        if (!facility) {
          throw new NotFoundError(`Facility not found: ${input.manufacturingFacilityId}`);
        }
      }

      // Validate primary identifier belongs to tenant
      if (input.primaryIdentifierId) {
        await validateIdentifierOwnership(tx, input.primaryIdentifierId, tenantId);
      }

      // Validate secondary identifiers belong to tenant
      if (input.secondaryIdentifierIds?.length) {
        for (const secId of input.secondaryIdentifierIds) {
          await validateIdentifierOwnership(tx, secId, tenantId);
        }
      }

      // Validate no overlap between primary and secondary
      validateNoPrimarySecondaryOverlap(input.primaryIdentifierId, input.secondaryIdentifierIds);

      // Create the product entity
      const product = await tx.product.create({
        data: {
          tenantId,
          name: input.name,
          level: input.level,
          ...(input.description !== undefined && { description: input.description }),
          ...(input.parentId !== undefined && { parentId: input.parentId }),
          ...(input.producedByOrganisationId !== undefined && {
            producedByOrganisationId: input.producedByOrganisationId,
          }),
          ...(input.manufacturingFacilityId !== undefined && {
            manufacturingFacilityId: input.manufacturingFacilityId,
          }),
          ...(input.primaryIdentifierId !== undefined && { primaryIdentifierId: input.primaryIdentifierId }),
        },
        include: PRODUCT_DETAIL_INCLUDE,
      });

      // Create join rows for secondary identifiers
      if (input.secondaryIdentifierIds?.length) {
        await tx.productSecondaryIdentifier.createMany({
          data: input.secondaryIdentifierIds.map((identifierId) => ({
            productId: product.id,
            identifierId,
          })),
        });

        // Re-fetch to include the newly created secondary identifier relations
        const refetched = await tx.product.findUniqueOrThrow({
          where: { id: product.id },
          include: PRODUCT_DETAIL_INCLUDE,
        });
        results.push(refetched);
      } else {
        results.push(product);
      }
    }

    return results;
  });
}

/**
 * Retrieves a product by ID, scoped to the tenant.
 * Returns null if not found or belongs to a different tenant.
 */
export async function getProductById(id: string, tenantId: string): Promise<ProductWithRelations | null> {
  return prisma.product.findFirst({
    where: { id, tenantId },
    include: PRODUCT_DETAIL_INCLUDE,
  });
}

/**
 * Lists products for a tenant.
 * Supports optional search across name and identifier values,
 * plus filtering by level, parentId, organisation, and facility.
 * Returns lightweight records with flattened secondaryIdentifierIds.
 */
export async function listProducts(
  tenantId: string,
  options: ListProductsOptions = {},
): Promise<{ data: ProductListItem[]; total: number }> {
  const { search, level, parentId, organisationId, facilityId, limit, offset } = options;

  const where: Prisma.ProductWhereInput = {
    tenantId,
  };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { primaryIdentifier: { value: { contains: search, mode: 'insensitive' } } },
      {
        secondaryIdentifiers: {
          some: {
            identifier: { value: { contains: search, mode: 'insensitive' } },
          },
        },
      },
    ];
  }

  if (level !== undefined) {
    where.level = level;
  }

  if (parentId !== undefined) {
    where.parentId = parentId;
  }

  if (organisationId !== undefined) {
    where.producedByOrganisationId = organisationId;
  }

  if (facilityId !== undefined) {
    where.manufacturingFacilityId = facilityId;
  }

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: PRODUCT_LIST_INCLUDE,
      take: limit ?? 100,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.product.count({ where }),
  ]);

  const data: ProductListItem[] = rows.map(({ secondaryIdentifiers, ...rest }) => ({
    ...rest,
    secondaryIdentifierIds: secondaryIdentifiers.map((si) => si.identifierId),
  }));

  return { data, total };
}

/**
 * Updates a product.
 * Validates ownership and foreign key references before updating.
 * Level is immutable and cannot be changed.
 */
export async function updateProduct(
  id: string,
  tenantId: string,
  input: UpdateProductInput,
): Promise<ProductWithRelations> {
  return prisma.$transaction(async (tx) => {
    // Ownership check
    const existing = await tx.product.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Product not found or access denied');
    }

    // Validate brand organisation belongs to tenant (if provided and not null)
    if (input.producedByOrganisationId !== undefined && input.producedByOrganisationId !== null) {
      const org = await tx.organisationEntity.findFirst({
        where: { id: input.producedByOrganisationId, tenantId },
      });
      if (!org) {
        throw new NotFoundError(`Organisation not found: ${input.producedByOrganisationId}`);
      }
    }

    // Validate manufacturing facility belongs to tenant (if provided and not null)
    if (input.manufacturingFacilityId !== undefined && input.manufacturingFacilityId !== null) {
      const facility = await tx.facility.findFirst({
        where: { id: input.manufacturingFacilityId, tenantId },
      });
      if (!facility) {
        throw new NotFoundError(`Facility not found: ${input.manufacturingFacilityId}`);
      }
    }

    // Validate hierarchy when parentId is being changed
    if (input.parentId !== undefined) {
      let parent: Product | null = null;
      if (input.parentId !== null) {
        parent = await tx.product.findFirst({
          where: { id: input.parentId, tenantId },
        });
      }
      validateProductHierarchy(existing.level, input.parentId ?? undefined, parent);
    }

    // Validate primary identifier belongs to tenant (if provided and not null)
    if (input.primaryIdentifierId !== undefined && input.primaryIdentifierId !== null) {
      await validateIdentifierOwnership(tx, input.primaryIdentifierId, tenantId);
    }

    // Validate secondary identifiers and check for overlap with primary
    if (input.secondaryIdentifierIds !== undefined) {
      const effectivePrimaryId =
        input.primaryIdentifierId !== undefined ? input.primaryIdentifierId : existing.primaryIdentifierId;
      validateNoPrimarySecondaryOverlap(effectivePrimaryId, input.secondaryIdentifierIds);

      for (const secId of input.secondaryIdentifierIds) {
        await validateIdentifierOwnership(tx, secId, tenantId);
      }

      // Replace secondary identifiers: delete existing, create new
      await tx.productSecondaryIdentifier.deleteMany({
        where: { productId: id },
      });
      if (input.secondaryIdentifierIds.length > 0) {
        await tx.productSecondaryIdentifier.createMany({
          data: input.secondaryIdentifierIds.map((identifierId) => ({
            productId: id,
            identifierId,
          })),
        });
      }
    }

    // Build the data object with only explicitly provided fields
    const data: Prisma.ProductUpdateInput = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
    };

    // Handle parentId: null = clear, string = set, undefined = no change
    if (input.parentId === null) {
      data.parent = { disconnect: true };
    } else if (input.parentId !== undefined) {
      data.parent = { connect: { id: input.parentId } };
    }

    // Handle producedByOrganisationId: null = clear, string = set, undefined = no change
    if (input.producedByOrganisationId === null) {
      data.producedByOrganisation = { disconnect: true };
    } else if (input.producedByOrganisationId !== undefined) {
      data.producedByOrganisation = { connect: { id: input.producedByOrganisationId } };
    }

    // Handle manufacturingFacilityId: null = clear, string = set, undefined = no change
    if (input.manufacturingFacilityId === null) {
      data.manufacturingFacility = { disconnect: true };
    } else if (input.manufacturingFacilityId !== undefined) {
      data.manufacturingFacility = { connect: { id: input.manufacturingFacilityId } };
    }

    // Handle primaryIdentifierId: null = clear, string = set, undefined = no change
    if (input.primaryIdentifierId === null) {
      data.primaryIdentifier = { disconnect: true };
    } else if (input.primaryIdentifierId !== undefined) {
      data.primaryIdentifier = { connect: { id: input.primaryIdentifierId } };
    }

    return tx.product.update({
      where: { id },
      data,
      include: PRODUCT_DETAIL_INCLUDE,
    });
  });
}

/**
 * Retrieves a product by its primary identifier value, scoped to a tenant.
 * Returns null if no product has a matching primary identifier.
 */
export async function getProductByIdentifierValue(
  value: string,
  tenantId: string,
): Promise<ProductWithRelations | null> {
  return prisma.product.findFirst({
    where: {
      tenantId,
      primaryIdentifier: { value },
    },
    include: PRODUCT_DETAIL_INCLUDE,
  });
}

/**
 * Deletes a product.
 * Blocks deletion if BATCH children depend on this MODEL.
 * Detaches ITEM children (sets parentId to null) before deleting.
 */
export async function deleteProduct(id: string, tenantId: string): Promise<Product> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundError('Product not found or access denied');

    const children = await tx.product.findMany({ where: { parentId: id, tenantId } });
    const batches = children.filter((c) => c.level === 'BATCH');
    if (batches.length > 0) {
      throw new ValidationError(`Cannot delete: ${batches.length} BATCH product(s) depend on this MODEL`);
    }

    const items = children.filter((c) => c.level === 'ITEM');
    if (items.length > 0) {
      await tx.product.updateMany({ where: { parentId: id, level: 'ITEM' }, data: { parentId: null } });
    }
    return tx.product.delete({ where: { id } });
  });
}
