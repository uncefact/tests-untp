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
  entityName?: string;
  entityDescription?: string;
  schemeNamespace?: string;
  schemePrimaryKey?: string;
  schemeIdrServiceInstanceId?: string | null;
};

/** Extracts common fields from a resolved entity. */
function buildResult(
  identifier: string,
  entity: {
    name: string;
    description?: string | null;
    primaryIdentifier?: {
      scheme?: {
        primaryKey: string;
        idrServiceInstanceId?: string | null;
        registrar?: { namespace: string } | null;
      } | null;
    } | null;
  },
  entityIdField: Partial<Pick<PrimaryEntityResult, 'productId' | 'facilityId' | 'organisationId'>>,
): PrimaryEntityResult {
  return {
    primaryIdentifier: identifier,
    ...entityIdField,
    entityName: entity.name,
    entityDescription: entity.description ?? undefined,
    schemeNamespace: entity.primaryIdentifier?.scheme?.registrar?.namespace ?? undefined,
    schemePrimaryKey: entity.primaryIdentifier?.scheme?.primaryKey,
    schemeIdrServiceInstanceId: entity.primaryIdentifier?.scheme?.idrServiceInstanceId,
  };
}

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
    return buildResult(refs.products[0].id, entity, { productId: entity.id });
  }

  if (refs.facilities[0]?.id) {
    const entity = await getFacilityByIdentifierValue(refs.facilities[0].id, tenantId);
    if (!entity) {
      logger.warn({ identifierValue: refs.facilities[0].id, tenantId }, 'Facility not found for identifier');
      return {};
    }
    return buildResult(refs.facilities[0].id, entity, { facilityId: entity.id });
  }

  if (refs.organisations[0]?.id) {
    const entity = await getOrganisationByIdentifierValue(refs.organisations[0].id, tenantId);
    if (!entity) {
      logger.warn({ identifierValue: refs.organisations[0].id, tenantId }, 'Organisation not found for identifier');
      return {};
    }
    return buildResult(refs.organisations[0].id, entity, { organisationId: entity.id });
  }

  return {};
}
