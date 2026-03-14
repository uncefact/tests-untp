import type { ExtractedRefs } from '@uncefact/untp-ri-services';
import {
  getProductByIdentifierValue,
  getFacilityByIdentifierValue,
  getOrganisationByIdentifierValue,
} from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ module: 'resolve-primary-entity' });

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
 * present in the refs arrays is treated as the primary identifier.
 */
export async function resolvePrimaryEntity(refs: ExtractedRefs, tenantId: string): Promise<PrimaryEntityResult> {
  if (refs.products[0]?.id) {
    const entity = await getProductByIdentifierValue(refs.products[0].id, tenantId);
    if (!entity) {
      logger.warn({ identifierValue: refs.products[0].id, tenantId }, 'Product not found for identifier');
      return {};
    }
    return {
      primaryIdentifier: refs.products[0].id,
      productId: entity.id,
      schemeNamespace: entity.primaryIdentifier?.scheme?.registrar?.namespace ?? undefined,
      schemePrimaryKey: entity.primaryIdentifier?.scheme?.primaryKey,
      schemeIdrServiceInstanceId: entity.primaryIdentifier?.scheme?.idrServiceInstanceId,
    };
  }

  if (refs.facilities[0]?.id) {
    const entity = await getFacilityByIdentifierValue(refs.facilities[0].id, tenantId);
    if (!entity) {
      logger.warn({ identifierValue: refs.facilities[0].id, tenantId }, 'Facility not found for identifier');
      return {};
    }
    return {
      primaryIdentifier: refs.facilities[0].id,
      facilityId: entity.id,
      schemeNamespace: entity.primaryIdentifier?.scheme?.registrar?.namespace ?? undefined,
      schemePrimaryKey: entity.primaryIdentifier?.scheme?.primaryKey,
      schemeIdrServiceInstanceId: entity.primaryIdentifier?.scheme?.idrServiceInstanceId,
    };
  }

  if (refs.organisations[0]?.id) {
    const entity = await getOrganisationByIdentifierValue(refs.organisations[0].id, tenantId);
    if (!entity) {
      logger.warn({ identifierValue: refs.organisations[0].id, tenantId }, 'Organisation not found for identifier');
      return {};
    }
    return {
      primaryIdentifier: refs.organisations[0].id,
      organisationId: entity.id,
      schemeNamespace: entity.primaryIdentifier?.scheme?.registrar?.namespace ?? undefined,
      schemePrimaryKey: entity.primaryIdentifier?.scheme?.primaryKey,
      schemeIdrServiceInstanceId: entity.primaryIdentifier?.scheme?.idrServiceInstanceId,
    };
  }

  return {};
}
