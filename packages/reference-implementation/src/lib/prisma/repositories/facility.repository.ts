import { Facility, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';
import { mapDatabaseError } from '@/lib/prisma/db-errors';
import { ValidationError } from '@/lib/api/validation';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import { UntpLocation } from '@/lib/types';

/**
 * Include shape for facility detail queries — eagerly loads primary and secondary
 * identifiers (with their schemes and registrars) and the operating organisation.
 * The registrar is needed to construct ISO 18975 resolver URIs for UNTP credentials.
 */
const FACILITY_DETAIL_INCLUDE = {
  primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
  secondaryIdentifiers: { include: { identifier: { include: { scheme: { include: { registrar: true } } } } } },
  operatingOrganisation: true,
} as const;

/**
 * Lightweight include shape for list queries — only fetches secondary identifier IDs.
 */
const FACILITY_LIST_INCLUDE = {
  secondaryIdentifiers: { select: { identifierId: true } },
} as const;

/**
 * A facility with all eagerly-loaded relations matching `FACILITY_DETAIL_INCLUDE`.
 */
export type FacilityWithRelations = Prisma.FacilityGetPayload<{ include: typeof FACILITY_DETAIL_INCLUDE }>;

/**
 * Raw row shape returned by the list query before flattening.
 */
type FacilityListRow = Prisma.FacilityGetPayload<{ include: typeof FACILITY_LIST_INCLUDE }>;

/**
 * Lightweight facility returned from list queries with flattened secondary identifier IDs.
 */
export type FacilityListItem = Omit<FacilityListRow, 'secondaryIdentifiers'> & {
  secondaryIdentifierIds: string[];
};

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
 * Validates that the primary identifier is not also listed as a secondary
 * identifier, and that secondary identifiers contain no duplicates.
 */
function validateNoPrimarySecondaryOverlap(
  primaryIdentifierId: string | undefined | null,
  secondaryIdentifierIds: string[],
): void {
  if (primaryIdentifierId && secondaryIdentifierIds.includes(primaryIdentifierId)) {
    throw new ValidationError('Primary identifier must not also appear in secondary identifiers');
  }
  if (new Set(secondaryIdentifierIds).size !== secondaryIdentifierIds.length) {
    throw new ValidationError('Secondary identifiers must not contain duplicates');
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
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
        validateNoPrimarySecondaryOverlap(primaryIdentifierId, secondaryIdentifierIds);
        for (const secId of secondaryIdentifierIds) {
          await validateIdentifierOwnership(tx, secId, tenantId, 'Secondary identifier');
        }
      }

      // Create the facility entity
      let facility: FacilityWithRelations;
      try {
        facility = await tx.facility.create({
          data: {
            tenantId,
            name,
            description,
            location: location ? (location as Prisma.InputJsonValue) : undefined,
            operatingOrganisationId,
            primaryIdentifierId,
          },
          include: FACILITY_DETAIL_INCLUDE,
        });
      } catch (e) {
        mapDatabaseError(e, {
          conflict: 'An identifier in this request is already the primary identifier of another facility',
          invalidReference: 'The referenced organisation or identifier no longer exists',
        });
      }

      // Create join rows for secondary identifiers
      if (secondaryIdentifierIds?.length) {
        try {
          await tx.facilitySecondaryIdentifier.createMany({
            data: secondaryIdentifierIds.map((identifierId: string) => ({
              facilityId: facility.id,
              identifierId,
            })),
          });
        } catch (e) {
          mapDatabaseError(e, { invalidReference: 'One or more secondary identifiers no longer exist' });
        }

        // Re-fetch to include the newly created secondary identifier relations
        const refetched = await tx.facility.findUniqueOrThrow({
          where: { id: facility.id },
          include: FACILITY_DETAIL_INCLUDE,
        });
        results.push(refetched);
      } else {
        results.push(facility);
      }
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
    include: FACILITY_DETAIL_INCLUDE,
  });
}

/**
 * Lists facilities for a tenant with optional search, organisation filter, and pagination.
 * Search matches against facility name or any associated identifier value.
 */
export async function listFacilities(
  tenantId: string,
  options: ListFacilitiesOptions = {},
): Promise<{ data: FacilityListItem[]; total: number }> {
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

  const [rows, total] = await Promise.all([
    prisma.facility.findMany({
      where,
      include: FACILITY_LIST_INCLUDE,
      take: limit ?? DEFAULT_PAGE_LIMIT,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.facility.count({ where }),
  ]);

  const data: FacilityListItem[] = rows.map(({ secondaryIdentifiers, ...rest }: FacilityListRow) => ({
    ...rest,
    secondaryIdentifierIds: secondaryIdentifiers.map((si: { identifierId: string }) => si.identifierId),
  }));

  return { data, total };
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
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.facility.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Facility not found');
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
      validateNoPrimarySecondaryOverlap(effectivePrimaryId, secondaryIdentifierIds);
      for (const secId of secondaryIdentifierIds) {
        await validateIdentifierOwnership(tx, secId, tenantId, 'Secondary identifier');
      }

      // Replace secondary identifiers: delete existing, create new
      await tx.facilitySecondaryIdentifier.deleteMany({
        where: { facilityId: id },
      });
      if (secondaryIdentifierIds.length > 0) {
        try {
          await tx.facilitySecondaryIdentifier.createMany({
            data: secondaryIdentifierIds.map((identifierId: string) => ({
              facilityId: id,
              identifierId,
            })),
          });
        } catch (e) {
          mapDatabaseError(e, {
            conflict: 'One or more secondary identifiers were concurrently linked to this facility; retry the request',
            invalidReference: 'The facility or one or more secondary identifiers no longer exist',
          });
        }
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

    try {
      return await tx.facility.update({
        where: { id },
        data,
        include: FACILITY_DETAIL_INCLUDE,
      });
    } catch (e) {
      mapDatabaseError(e, {
        conflict: 'The identifier is already the primary identifier of another facility',
        notFound: 'Facility or a referenced resource not found',
      });
    }
  });
}

/**
 * Retrieves a facility by its primary identifier value, scoped to a tenant.
 * Returns null if no facility has a matching primary identifier.
 */
export async function getFacilityByIdentifierValue(
  value: string,
  tenantId: string,
): Promise<FacilityWithRelations | null> {
  return prisma.facility.findFirst({
    where: {
      tenantId,
      primaryIdentifier: { value },
    },
    include: FACILITY_DETAIL_INCLUDE,
  });
}

/**
 * Deletes a facility. Validates tenant ownership before deletion.
 */
export async function deleteFacility(id: string, tenantId: string): Promise<Facility> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.facility.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Facility not found');
    }

    try {
      return await tx.facility.delete({
        where: { id },
      });
    } catch (e) {
      mapDatabaseError(e, { notFound: 'Facility not found' });
    }
  });
}
