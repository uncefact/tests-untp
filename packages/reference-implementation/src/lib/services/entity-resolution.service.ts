import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { CredentialType } from '@/lib/prisma/generated';
import {
  getOrganisationById,
  getFacilityById,
  getProductById,
  OrganisationEntityWithRelations,
  FacilityWithRelations,
  ProductWithRelations,
} from '@/lib/prisma/repositories';

export interface ResolvedEntities {
  organisation?: OrganisationEntityWithRelations;
  facility?: FacilityWithRelations;
  product?: ProductWithRelations;
}

export interface EntityReferences {
  organisationId?: string;
  facilityId?: string;
  productId?: string;
}

type EntityType = 'organisation' | 'facility' | 'product';

type EntityRequirement = {
  required: EntityType[];
  optional: EntityType[];
};

const entityRequirements: Record<string, EntityRequirement> = {
  [CredentialType.DigitalProductPassport]: { required: ['organisation', 'facility', 'product'], optional: [] },
  [CredentialType.DigitalConformityCredential]: { required: ['organisation'], optional: ['facility', 'product'] },
  [CredentialType.DigitalFacilityRecord]: { required: ['organisation', 'facility'], optional: [] },
  [CredentialType.DigitalIdentityAnchor]: { required: ['organisation'], optional: [] },
  [CredentialType.DigitalTraceabilityEvent]: { required: ['organisation', 'product'], optional: [] },
};

/**
 * Resolves master data entities required for a given credential type.
 *
 * Fetches only the entities that the credential type needs (organisation,
 * facility, product) from the corresponding repositories.
 *
 * @throws {ValidationError} If the credential type is unknown or a required
 *   entity reference is missing from the refs.
 * @throws {NotFoundError} If any referenced entity does not exist.
 */
export async function resolveEntities(
  credentialType: string,
  refs: EntityReferences,
  tenantId: string,
): Promise<ResolvedEntities> {
  const requirement = entityRequirements[credentialType];
  if (!requirement) {
    throw new ValidationError(`Unknown credential type: ${credentialType}`);
  }

  const resolved: ResolvedEntities = {};

  // Resolve required entities — throw if ref is missing or entity not found
  for (const entity of requirement.required) {
    await resolveEntity(entity, refs, tenantId, resolved, true);
  }

  // Resolve optional entities — only if ref is provided, throw if provided but not found
  for (const entity of requirement.optional) {
    await resolveEntity(entity, refs, tenantId, resolved, false);
  }

  return resolved;
}

const refKeys: Record<EntityType, keyof EntityReferences> = {
  organisation: 'organisationId',
  facility: 'facilityId',
  product: 'productId',
};

const fetchers: Record<EntityType, (id: string, tenantId: string) => Promise<unknown>> = {
  organisation: getOrganisationById,
  facility: getFacilityById,
  product: getProductById,
};

const labels: Record<EntityType, string> = {
  organisation: 'Organisation',
  facility: 'Facility',
  product: 'Product',
};

async function resolveEntity(
  entity: EntityType,
  refs: EntityReferences,
  tenantId: string,
  resolved: ResolvedEntities,
  required: boolean,
): Promise<void> {
  const refKey = refKeys[entity];
  const refId = refs[refKey];

  if (!refId) {
    if (required) {
      throw new ValidationError(`${refKey} is required for this credential type`);
    }
    return; // Optional and not provided — skip
  }

  const result = await fetchers[entity](refId, tenantId);
  if (!result) {
    throw new NotFoundError(`${labels[entity]} not found: ${refId}`);
  }

  (resolved as Record<string, unknown>)[entity] = result;
}
