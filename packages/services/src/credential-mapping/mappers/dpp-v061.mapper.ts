import type { IdentifierScheme } from '../../verifiable-credential/types.js';
import type {
  ICredentialMapper,
  ResolvedEntities,
  ExtractedIdentifierRefs,
  DataModelConfig,
  MapperOutput,
  UntpLocation,
} from '../types.js';
import { buildIdentifierScheme, buildParty, buildContextAndTypes } from './shared-v061.js';

type DppProduct = {
  type: ['Product'];
  id: string | undefined;
  name: string | undefined;
  description?: string;
  registeredId?: string;
  idScheme?: IdentifierScheme;
  batchNumber?: string;
  serialNumber?: string;
  producedByParty: ReturnType<typeof buildParty>;
  producedAtFacility: DppFacility;
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

export class DppV061Mapper implements ICredentialMapper {
  async buildPayload(entities: ResolvedEntities, config: DataModelConfig): Promise<MapperOutput> {
    const { organisation, facility, product } = entities;
    const { contexts, types } = buildContextAndTypes(config);

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
        idScheme: buildIdentifierScheme(product.primaryIdentifier.scheme),
      }),
      ...(product?.batchNumber && { batchNumber: product.batchNumber }),
      ...(product?.serialNumber && { serialNumber: product.serialNumber }),
      producedByParty: buildParty(organisation),
      producedAtFacility: this.buildFacility(facility),
    };
  }

  private buildFacility(facility: ResolvedEntities['facility']): DppFacility {
    const location = facility?.location;

    return {
      id: facility?.id,
      name: facility?.name,
      ...(facility?.description && { description: facility.description }),
      ...(facility?.primaryIdentifier && {
        registeredId: facility.primaryIdentifier.value,
        idScheme: buildIdentifierScheme(facility.primaryIdentifier.scheme),
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

  extractEntityRefs(payload: MapperOutput): ExtractedIdentifierRefs {
    const subject = payload.credentialSubject;
    if (!subject) return {};

    const product = subject.product as DppProduct | undefined;
    if (!product) return {};

    const refs: ExtractedIdentifierRefs = {};

    if (product.registeredId) {
      refs.primaryIdentifier = product.registeredId;
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
