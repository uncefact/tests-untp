import { Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { UntpLocation } from '@/lib/types';

/**
 * Include shape used by all organisation queries.
 * Includes the primary identifier (with scheme and registrar) and all secondary
 * identifiers (via the join table, each with its identifier, scheme, and registrar).
 * The registrar is needed to construct ISO 18975 resolver URIs for UNTP credentials.
 */
const ORGANISATION_INCLUDE = {
  primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
  secondaryIdentifiers: { include: { identifier: { include: { scheme: { include: { registrar: true } } } } } },
} as const;

/**
 * An organisation entity with its full identifier relations.
 * Matches the include shape defined by ORGANISATION_INCLUDE.
 */
export type OrganisationEntityWithRelations = Prisma.OrganisationEntityGetPayload<{
  include: typeof ORGANISATION_INCLUDE;
}>;

/**
 * Input for creating a new organisation entity.
 */
export type CreateOrganisationInput = {
  name: string;
  description?: string;
  location?: UntpLocation;
  primaryIdentifierId?: string;
  secondaryIdentifierIds?: string[];
};

/**
 * Input for updating an existing organisation entity.
 * Fields set to undefined are left unchanged.
 * primaryIdentifierId set to null clears the primary identifier.
 * secondaryIdentifierIds set to [] clears all secondary identifiers.
 */
export type UpdateOrganisationInput = {
  name?: string;
  description?: string;
  location?: UntpLocation;
  primaryIdentifierId?: string | null;
  secondaryIdentifierIds?: string[];
};

/**
 * Options for listing organisation entities.
 */
export type ListOrganisationsOptions = {
  search?: string;
  limit?: number;
  offset?: number;
};

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
 * Creates one or more organisation entities in a single transaction.
 * Validates all identifier references belong to the tenant before creating.
 */
export async function createOrganisations(
  tenantId: string,
  inputs: CreateOrganisationInput[],
): Promise<OrganisationEntityWithRelations[]> {
  return prisma.$transaction(async (tx) => {
    const results: OrganisationEntityWithRelations[] = [];

    for (const input of inputs) {
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

      // Create the organisation entity
      const organisation = await tx.organisationEntity.create({
        data: {
          tenantId,
          name: input.name,
          ...(input.description !== undefined && { description: input.description }),
          ...(input.location !== undefined && { location: input.location as Prisma.InputJsonValue }),
          ...(input.primaryIdentifierId !== undefined && { primaryIdentifierId: input.primaryIdentifierId }),
        },
        include: ORGANISATION_INCLUDE,
      });

      // Create join rows for secondary identifiers
      if (input.secondaryIdentifierIds?.length) {
        await tx.organisationSecondaryIdentifier.createMany({
          data: input.secondaryIdentifierIds.map((identifierId) => ({
            organisationId: organisation.id,
            identifierId,
          })),
        });

        // Re-fetch to include the newly created secondary identifier relations
        const refetched = await tx.organisationEntity.findUniqueOrThrow({
          where: { id: organisation.id },
          include: ORGANISATION_INCLUDE,
        });
        results.push(refetched);
      } else {
        results.push(organisation);
      }
    }

    return results;
  });
}

/**
 * Retrieves an organisation entity by ID, scoped to the tenant.
 * Returns null if not found or belongs to a different tenant.
 */
export async function getOrganisationById(
  id: string,
  tenantId: string,
): Promise<OrganisationEntityWithRelations | null> {
  return prisma.organisationEntity.findFirst({
    where: { id, tenantId },
    include: ORGANISATION_INCLUDE,
  });
}

/**
 * Lists organisation entities for a tenant.
 * Supports optional search across name and identifier values.
 */
export async function listOrganisations(
  tenantId: string,
  options: ListOrganisationsOptions = {},
): Promise<OrganisationEntityWithRelations[]> {
  const { search, limit, offset } = options;

  const where: Prisma.OrganisationEntityWhereInput = {
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

  return prisma.organisationEntity.findMany({
    where,
    include: ORGANISATION_INCLUDE,
    take: limit ?? 100,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Updates an organisation entity.
 * Validates ownership and identifier references before updating.
 */
export async function updateOrganisation(
  id: string,
  tenantId: string,
  input: UpdateOrganisationInput,
): Promise<OrganisationEntityWithRelations> {
  return prisma.$transaction(async (tx) => {
    // Ownership check
    const existing = await tx.organisationEntity.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Organisation not found or access denied');
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
      await tx.organisationSecondaryIdentifier.deleteMany({
        where: { organisationId: id },
      });
      if (input.secondaryIdentifierIds.length > 0) {
        await tx.organisationSecondaryIdentifier.createMany({
          data: input.secondaryIdentifierIds.map((identifierId) => ({
            organisationId: id,
            identifierId,
          })),
        });
      }
    }

    // Build the data object with only explicitly provided fields
    const data: Prisma.OrganisationEntityUpdateInput = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.location !== undefined && { location: input.location as Prisma.InputJsonValue }),
    };

    // Handle primaryIdentifierId: null = clear, string = set, undefined = no change
    if (input.primaryIdentifierId === null) {
      data.primaryIdentifier = { disconnect: true };
    } else if (input.primaryIdentifierId !== undefined) {
      data.primaryIdentifier = { connect: { id: input.primaryIdentifierId } };
    }

    return tx.organisationEntity.update({
      where: { id },
      data,
      include: ORGANISATION_INCLUDE,
    });
  });
}

/**
 * Deletes an organisation entity.
 * Join table rows (secondary identifiers) cascade automatically.
 */
export async function deleteOrganisation(id: string, tenantId: string): Promise<OrganisationEntityWithRelations> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.organisationEntity.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Organisation not found or access denied');
    }

    return tx.organisationEntity.delete({
      where: { id },
      include: ORGANISATION_INCLUDE,
    });
  });
}
