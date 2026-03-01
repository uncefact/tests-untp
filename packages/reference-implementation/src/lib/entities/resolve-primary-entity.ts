import type { ExtractedIdentifierRefs } from '@uncefact/untp-ri-services';
import {
  getProductByIdentifierValue,
  getFacilityByIdentifierValue,
  getOrganisationByIdentifierValue,
} from '@/lib/prisma/repositories';

export type PrimaryEntityResult = {
  organisationId?: string;
  facilityId?: string;
  productId?: string;
  schemeNamespace?: string;
  schemePrimaryKey?: string;
  schemeIdrServiceInstanceId?: string | null;
};

export async function resolvePrimaryEntity(
  refs: ExtractedIdentifierRefs,
  tenantId: string,
): Promise<PrimaryEntityResult> {
  const { primaryIdentifier } = refs;
  if (!primaryIdentifier) return {};

  if (refs.product?.registeredId === primaryIdentifier) {
    const entity = await getProductByIdentifierValue(primaryIdentifier, tenantId);
    if (!entity) return {};
    return {
      productId: entity.id,
      schemeNamespace: entity.primaryIdentifier?.scheme?.namespace ?? undefined,
      schemePrimaryKey: entity.primaryIdentifier?.scheme?.primaryKey,
      schemeIdrServiceInstanceId: entity.primaryIdentifier?.scheme?.idrServiceInstanceId,
    };
  }

  if (refs.facility?.registeredId === primaryIdentifier) {
    const entity = await getFacilityByIdentifierValue(primaryIdentifier, tenantId);
    if (!entity) return {};
    return {
      facilityId: entity.id,
      schemeNamespace: entity.primaryIdentifier?.scheme?.namespace ?? undefined,
      schemePrimaryKey: entity.primaryIdentifier?.scheme?.primaryKey,
      schemeIdrServiceInstanceId: entity.primaryIdentifier?.scheme?.idrServiceInstanceId,
    };
  }

  if (refs.organisation?.registeredId === primaryIdentifier) {
    const entity = await getOrganisationByIdentifierValue(primaryIdentifier, tenantId);
    if (!entity) return {};
    return {
      organisationId: entity.id,
      schemeNamespace: entity.primaryIdentifier?.scheme?.namespace ?? undefined,
      schemePrimaryKey: entity.primaryIdentifier?.scheme?.primaryKey,
      schemeIdrServiceInstanceId: entity.primaryIdentifier?.scheme?.idrServiceInstanceId,
    };
  }

  return {};
}
