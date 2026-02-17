import { ICredentialMapper, ResolvedEntities, ExtractedIdentifierRefs, DataModelConfig, MapperOutput } from '../types';
import { registerMapper } from '../mapper-registry';
import type { IdentifierScheme } from '@uncefact/untp-ri-services';
import type { UntpLocation } from '@/lib/types';

/**
 * DPP v0.6.1 UNTP schema types.
 * These mirror the JSON schema definitions for the Digital Product Passport.
 */
type DppProduct = {
  type: ['Product'];
  id: string | undefined;
  name: string | undefined;
  description?: string;
  registeredId?: string;
  idScheme?: IdentifierScheme;
  batchNumber?: string;
  serialNumber?: string;
  producedByParty: DppParty;
  producedAtFacility: DppFacility;
};

type DppParty = {
  id: string | undefined;
  name: string | undefined;
  description?: string;
  registeredId?: string;
  idScheme?: IdentifierScheme;
};

type DppLocation = {
  type: ['Location'];
  plusCode?: string;
  geoLocation?: unknown;
  geoBoundary?: unknown;
};

type DppAddress = {
  type: ['Address'];
  streetAddress?: string;
  postalCode?: string;
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string;
};

type DppFacility = {
  id: string | undefined;
  name: string | undefined;
  description?: string;
  registeredId?: string;
  idScheme?: IdentifierScheme;
  locationInformation?: DppLocation;
  address?: DppAddress;
};

/**
 * Mapper for Digital Product Passport v0.6.1.
 * Builds a UNTP DPP credential payload from product, facility, and organisation entities.
 *
 * Output structure follows the UNTP DPP JSON schema:
 *   - credentialSubject is a ProductPassport
 *   - product uses registeredId + idScheme (not an identifiers array)
 *   - product includes batchNumber, serialNumber when present
 *   - organisation maps to producedByParty with idScheme + description
 *   - facility maps to producedAtFacility with idScheme, description, location, address
 */
export class DppV061Mapper implements ICredentialMapper {
  async buildPayload(entities: ResolvedEntities, config: DataModelConfig): Promise<MapperOutput> {
    const { organisation, facility, product } = entities;

    const contexts: string[] = [config.core.contextUrl];
    const types: string[] = [config.core.credentialType];

    if (config.extension) {
      contexts.push(config.extension.contextUrl);
      if (config.extension.credentialType !== config.core.credentialType) {
        types.push(config.extension.credentialType);
      }
    }

    return {
      '@context': contexts,
      type: types,
      credentialSubject: {
        type: ['ProductPassport'],
        product: this.buildProduct(product, organisation, facility),
        ...(product?.level && { granularityLevel: product.level.toLowerCase() }),
      },
    };
  }

  private buildProduct(
    product: ResolvedEntities['product'],
    organisation: ResolvedEntities['organisation'],
    facility: ResolvedEntities['facility'],
  ): DppProduct {
    return {
      type: ['Product'],
      id: product?.id,
      name: product?.name,
      ...(product?.description && { description: product.description }),
      ...(product?.primaryIdentifier && {
        registeredId: product.primaryIdentifier.value,
        idScheme: this.buildIdentifierScheme(product.primaryIdentifier.scheme),
      }),
      ...(product?.batchNumber && { batchNumber: product.batchNumber }),
      ...(product?.serialNumber && { serialNumber: product.serialNumber }),
      producedByParty: this.buildParty(organisation),
      producedAtFacility: this.buildFacility(facility),
    };
  }

  private buildParty(org: ResolvedEntities['organisation']): DppParty {
    return {
      id: org?.id,
      name: org?.name,
      ...(org?.description && { description: org.description }),
      ...(org?.primaryIdentifier && {
        registeredId: org.primaryIdentifier.value,
        idScheme: this.buildIdentifierScheme(org.primaryIdentifier.scheme),
      }),
    };
  }

  private buildFacility(facility: ResolvedEntities['facility']): DppFacility {
    const location = facility?.location as UntpLocation | null | undefined;

    return {
      id: facility?.id,
      name: facility?.name,
      ...(facility?.description && { description: facility.description }),
      ...(facility?.primaryIdentifier && {
        registeredId: facility.primaryIdentifier.value,
        idScheme: this.buildIdentifierScheme(facility.primaryIdentifier.scheme),
      }),
      ...(location?.geoLocation || location?.plusCode || location?.geoBoundary
        ? {
            locationInformation: {
              type: ['Location'] as ['Location'],
              ...(location.plusCode && { plusCode: location.plusCode }),
              ...(location.geoLocation && { geoLocation: location.geoLocation }),
              ...(location.geoBoundary && { geoBoundary: location.geoBoundary }),
            },
          }
        : {}),
      ...(location?.address
        ? {
            address: {
              type: ['Address'] as ['Address'],
              ...(location.address.streetAddress && { streetAddress: location.address.streetAddress }),
              ...(location.address.postalCode && { postalCode: location.address.postalCode }),
              ...(location.address.addressLocality && { addressLocality: location.address.addressLocality }),
              ...(location.address.addressRegion && { addressRegion: location.address.addressRegion }),
              ...(location.address.addressCountry && { addressCountry: location.address.addressCountry }),
            },
          }
        : {}),
    };
  }

  private buildIdentifierScheme(
    scheme: { id?: string; name?: string } | null | undefined,
  ): IdentifierScheme | undefined {
    if (!scheme || !scheme.id || !scheme.name) return undefined;
    return {
      type: ['IdentifierScheme'],
      id: scheme.id,
      name: scheme.name,
    };
  }

  extractEntityRefs(payload: MapperOutput): ExtractedIdentifierRefs {
    const subject = payload.credentialSubject;
    if (!subject) return {};

    const product = subject.product as DppProduct | undefined;
    if (!product) return {};

    const refs: ExtractedIdentifierRefs = {};

    if (product.registeredId) {
      refs.product = {
        registeredId: product.registeredId,
        ...(product.batchNumber ? { batchNumber: product.batchNumber } : {}),
        ...(product.serialNumber ? { serialNumber: product.serialNumber } : {}),
      };
    }

    if (product.producedByParty?.registeredId) {
      refs.organisation = { registeredId: product.producedByParty.registeredId };
    }

    if (product.producedAtFacility?.registeredId) {
      refs.facility = { registeredId: product.producedAtFacility.registeredId };
    }

    return refs;
  }
}

// Self-register on import
registerMapper('DigitalProductPassport', '0.6.1', new DppV061Mapper());
