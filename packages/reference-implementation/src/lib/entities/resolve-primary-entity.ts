import type { ExtractedRefs } from '@uncefact/untp-ri-services';
import {
  getProductByIdentifierValue,
  getFacilityByIdentifierValue,
  getOrganisationByIdentifierValue,
} from '@/lib/prisma/repositories';

export type PrimaryEntityResult = {
  primaryIdentifier?: string;
  organisationId?: string;
  facilityId?: string;
  productId?: string;
  schemeNamespace?: string;
  schemePrimaryKey?: string;
  schemeIdrServiceInstanceId?: string | null;
};

/**
 * Resolves a primary entity from extracted credential references.
 *
 * Priority: product > facility > organisation. The first entity ref
 * present in the refs object is treated as the primary identifier.
 */
export async function resolvePrimaryEntity(refs: ExtractedRefs, tenantId: string): Promise<PrimaryEntityResult> {
  if (refs.product?.id) {
    const entity = await getProductByIdentifierValue(refs.product.id, tenantId);
    if (!entity) return {};
    return {
      primaryIdentifier: refs.product.id,
      productId: entity.id,
      schemeNamespace: entity.primaryIdentifier?.scheme?.registrar?.namespace ?? undefined,
      schemePrimaryKey: entity.primaryIdentifier?.scheme?.primaryKey,
      schemeIdrServiceInstanceId: entity.primaryIdentifier?.scheme?.idrServiceInstanceId,
    };
  }

  if (refs.facility?.id) {
    const entity = await getFacilityByIdentifierValue(refs.facility.id, tenantId);
    if (!entity) return {};
    return {
      primaryIdentifier: refs.facility.id,
      facilityId: entity.id,
      schemeNamespace: entity.primaryIdentifier?.scheme?.registrar?.namespace ?? undefined,
      schemePrimaryKey: entity.primaryIdentifier?.scheme?.primaryKey,
      schemeIdrServiceInstanceId: entity.primaryIdentifier?.scheme?.idrServiceInstanceId,
    };
  }

  if (refs.organisation?.id) {
    const entity = await getOrganisationByIdentifierValue(refs.organisation.id, tenantId);
    if (!entity) return {};
    return {
      primaryIdentifier: refs.organisation.id,
      organisationId: entity.id,
      schemeNamespace: entity.primaryIdentifier?.scheme?.registrar?.namespace ?? undefined,
      schemePrimaryKey: entity.primaryIdentifier?.scheme?.primaryKey,
      schemeIdrServiceInstanceId: entity.primaryIdentifier?.scheme?.idrServiceInstanceId,
    };
  }

  return {};
}
