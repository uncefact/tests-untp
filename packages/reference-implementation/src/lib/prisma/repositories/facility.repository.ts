import { Facility, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { UntpLocation } from '@/lib/types';

/**
 * Include shape for facility queries — eagerly loads primary and secondary
 * identifiers (with their schemes) and the operating organisation.
 */
const FACILITY_INCLUDE = {
  primaryIdentifier: { include: { scheme: true } },
  secondaryIdentifiers: { include: { identifier: { include: { scheme: true } } } },
  operatingOrganisation: true,
} as const;

/**
 * A facility with all eagerly-loaded relations matching `FACILITY_INCLUDE`.
 */
export type FacilityWithRelations = Prisma.FacilityGetPayload<{ include: typeof FACILITY_INCLUDE }>;

/**
 * Input for creating a new facility.
 */
export type CreateFacilityInput = {
  name: string;
  description?: string;
  location?: UntpLocation;
  operatingOrganisationId?: string;
  primaryIdentifierId?: string;
  secondaryIdentifierIds?: string[];
};

/**
 * Input for updating an existing facility.
 */
export type UpdateFacilityInput = {
  name?: string;
  description?: string;
  location?: UntpLocation;
  operatingOrganisationId?: string | null;
  primaryIdentifierId?: string | null;
  secondaryIdentifierIds?: string[];
};

/**
 * Options for listing facilities with optional filtering and pagination.
 */
export type ListFacilitiesOptions = {
  search?: string;
  organisationId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Validates that an identifier exists and belongs to the given tenant.
 * Throws NotFoundError if the identifier is not found or belongs to another tenant.
 */
async function validateIdentifierOwnership(
  tx: Prisma.TransactionClient,
  identifierId: string,
  tenantId: string,
  label: string,
): Promise<void> {
  const identifier = await tx.identifier.findFirst({
    where: { id: identifierId, tenantId },
  });
  if (!identifier) {
    throw new NotFoundError(`${label} not found: ${identifierId}`);
  }
}

/**
 * Creates one or more facilities within a transaction.
 * Validates identifier ownership, organisation FK, and primary/secondary overlap.
 * Returns the created facilities with all includes.
 */
export async function createFacilities(
  tenantId: string,
  inputs: CreateFacilityInput[],
): Promise<FacilityWithRelations[]> {
  return prisma.$transaction(async (tx) => {
    const results: FacilityWithRelations[] = [];

    for (const input of inputs) {
      const { name, description, location, operatingOrganisationId, primaryIdentifierId, secondaryIdentifierIds } =
        input;

      // Validate operating organisation FK if provided
      if (operatingOrganisationId) {
        const org = await tx.organisationEntity.findFirst({
          where: { id: operatingOrganisationId, tenantId },
        });
        if (!org) {
          throw new NotFoundError(`Organisation not found: ${operatingOrganisationId}`);
        }
      }

      // Validate primary identifier ownership
      if (primaryIdentifierId) {
        await validateIdentifierOwnership(tx, primaryIdentifierId, tenantId, 'Primary identifier');
      }

      // Validate secondary identifier ownership and check for overlap with primary
      if (secondaryIdentifierIds?.length) {
        if (primaryIdentifierId && secondaryIdentifierIds.includes(primaryIdentifierId)) {
          throw new ValidationError('Primary identifier must not also appear in secondary identifiers');
        }
        for (const secId of secondaryIdentifierIds) {
          await validateIdentifierOwnership(tx, secId, tenantId, 'Secondary identifier');
        }
      }

      // Create the facility entity
      const facility = await tx.facility.create({
        data: {
          tenantId,
          name,
          description,
          location: location ? (location as Prisma.InputJsonValue) : undefined,
          operatingOrganisationId,
          primaryIdentifierId,
          ...(secondaryIdentifierIds?.length && {
            secondaryIdentifiers: {
              createMany: {
                data: secondaryIdentifierIds.map((identifierId) => ({ identifierId })),
              },
            },
          }),
        },
        include: FACILITY_INCLUDE,
      });

      results.push(facility);
    }

    return results;
  });
}

/**
 * Retrieves a facility by ID, scoped to a tenant.
 * Returns null if the facility does not exist or belongs to another tenant.
 */
export async function getFacilityById(id: string, tenantId: string): Promise<FacilityWithRelations | null> {
  return prisma.facility.findFirst({
    where: { id, tenantId },
    include: FACILITY_INCLUDE,
  });
}

/**
 * Lists facilities for a tenant with optional search, organisation filter, and pagination.
 * Search matches against facility name or any associated identifier value.
 */
export async function listFacilities(
  tenantId: string,
  options: ListFacilitiesOptions = {},
): Promise<FacilityWithRelations[]> {
  const { search, organisationId, limit, offset } = options;

  const where: Prisma.FacilityWhereInput = {
    tenantId,
  };

  if (organisationId !== undefined) {
    where.operatingOrganisationId = organisationId;
  }

  if (search !== undefined) {
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

  return prisma.facility.findMany({
    where,
    include: FACILITY_INCLUDE,
    take: limit ?? 100,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Updates a facility's fields. Validates tenant ownership, organisation FK,
 * and identifier ownership. Replaces secondary identifiers when provided.
 */
export async function updateFacility(
  id: string,
  tenantId: string,
  input: UpdateFacilityInput,
): Promise<FacilityWithRelations> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.facility.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Facility not found or access denied');
    }

    const { name, description, location, operatingOrganisationId, primaryIdentifierId, secondaryIdentifierIds } = input;

    // Validate operating organisation FK if provided and not clearing
    if (operatingOrganisationId !== undefined && operatingOrganisationId !== null) {
      const org = await tx.organisationEntity.findFirst({
        where: { id: operatingOrganisationId, tenantId },
      });
      if (!org) {
        throw new NotFoundError(`Organisation not found: ${operatingOrganisationId}`);
      }
    }

    // Validate primary identifier ownership if provided and not clearing
    if (primaryIdentifierId !== undefined && primaryIdentifierId !== null) {
      await validateIdentifierOwnership(tx, primaryIdentifierId, tenantId, 'Primary identifier');
    }

    // Validate secondary identifiers and check for overlap with primary
    if (secondaryIdentifierIds !== undefined) {
      const effectivePrimaryId = primaryIdentifierId === undefined ? existing.primaryIdentifierId : primaryIdentifierId;
      if (effectivePrimaryId && secondaryIdentifierIds.includes(effectivePrimaryId)) {
        throw new ValidationError('Primary identifier must not also appear in secondary identifiers');
      }
      for (const secId of secondaryIdentifierIds) {
        await validateIdentifierOwnership(tx, secId, tenantId, 'Secondary identifier');
      }

      // Replace secondary identifiers: delete existing, create new
      await tx.facilitySecondaryIdentifier.deleteMany({
        where: { facilityId: id },
      });
      if (secondaryIdentifierIds.length > 0) {
        await tx.facilitySecondaryIdentifier.createMany({
          data: secondaryIdentifierIds.map((identifierId) => ({
            facilityId: id,
            identifierId,
          })),
        });
      }
    }

    // Build the update data, only including fields that were provided
    const data: Prisma.FacilityUpdateInput = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (location !== undefined) data.location = location as Prisma.InputJsonValue;

    // operatingOrganisationId: null = clear, string = set, undefined = no change
    if (operatingOrganisationId === null) {
      data.operatingOrganisation = { disconnect: true };
    } else if (operatingOrganisationId !== undefined) {
      data.operatingOrganisation = { connect: { id: operatingOrganisationId } };
    }

    // primaryIdentifierId: null = clear, string = set, undefined = no change
    if (primaryIdentifierId === null) {
      data.primaryIdentifier = { disconnect: true };
    } else if (primaryIdentifierId !== undefined) {
      data.primaryIdentifier = { connect: { id: primaryIdentifierId } };
    }

    return tx.facility.update({
      where: { id },
      data,
      include: FACILITY_INCLUDE,
    });
  });
}

/**
 * Deletes a facility. Validates tenant ownership before deletion.
 */
export async function deleteFacility(id: string, tenantId: string): Promise<Facility> {
  const existing = await prisma.facility.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new NotFoundError('Facility not found or access denied');
  }

  return prisma.facility.delete({
    where: { id },
  });
}
