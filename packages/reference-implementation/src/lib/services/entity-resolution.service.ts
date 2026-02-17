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

const entityRequirements: Record<string, EntityType[]> = {
  [CredentialType.DigitalProductPassport]: ['organisation', 'facility', 'product'],
  [CredentialType.DigitalConformityCredential]: ['organisation'],
  [CredentialType.DigitalFacilityRecord]: ['organisation', 'facility'],
  [CredentialType.DigitalIdentityAnchor]: ['organisation'],
  [CredentialType.DigitalTraceabilityEvent]: ['organisation', 'product'],
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
  const requirements = entityRequirements[credentialType];
  if (!requirements) {
    throw new ValidationError(`Unknown credential type: ${credentialType}`);
  }

  const resolved: ResolvedEntities = {};

  if (requirements.includes('organisation')) {
    if (!refs.organisationId) {
      throw new ValidationError('organisationId is required for ' + credentialType);
    }
    const organisation = await getOrganisationById(refs.organisationId, tenantId);
    if (!organisation) {
      throw new NotFoundError(`Organisation not found: ${refs.organisationId}`);
    }
    resolved.organisation = organisation;
  }

  if (requirements.includes('facility')) {
    if (!refs.facilityId) {
      throw new ValidationError('facilityId is required for ' + credentialType);
    }
    const facility = await getFacilityById(refs.facilityId, tenantId);
    if (!facility) {
      throw new NotFoundError(`Facility not found: ${refs.facilityId}`);
    }
    resolved.facility = facility;
  }

  if (requirements.includes('product')) {
    if (!refs.productId) {
      throw new ValidationError('productId is required for ' + credentialType);
    }
    const product = await getProductById(refs.productId, tenantId);
    if (!product) {
      throw new NotFoundError(`Product not found: ${refs.productId}`);
    }
    resolved.product = product;
  }

  return resolved;
}
