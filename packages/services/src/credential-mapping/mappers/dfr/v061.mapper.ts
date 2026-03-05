import type { IdentifierScheme } from '../../../verifiable-credential/types.js';
import type {
  ICredentialMapper,
  ResolvedEntities,
  ExtractedIdentifierRefs,
  DataModelConfig,
  MapperOutput,
  UntpLocation,
} from '../../types.js';
import { buildIdentifierScheme, buildParty, buildContextAndTypes } from '../shared/v061.js';

type DfrParty = ReturnType<typeof buildParty>;

type DfrLocation = {
  type: ['Location'];
  plusCode?: string;
  geoLocation?: unknown;
  geoBoundary?: unknown;
};

type DfrAddress = {
  type: ['Address'];
  streetAddress?: string;
  postalCode?: string;
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string;
};

type DfrFacility = {
  type: ['Facility'];
  id: string | undefined;
  name: string | undefined;
  description?: string;
  registeredId?: string;
  idScheme?: IdentifierScheme;
  operatedByParty: DfrParty;
  locationInformation?: DfrLocation;
  address?: DfrAddress;
};

export class DfrV061Mapper implements ICredentialMapper {
  async buildPayload(entities: ResolvedEntities, config: DataModelConfig): Promise<MapperOutput> {
    const { organisation, facility } = entities;
    const { contexts, types } = buildContextAndTypes(config);

    return {
      '@context': contexts,
      type: types,
      credentialSubject: {
        type: ['FacilityRecord'],
        facility: this.buildFacility(facility, organisation),
      },
    };
  }

  private buildFacility(
    facility: ResolvedEntities['facility'],
    organisation: ResolvedEntities['organisation'],
  ): DfrFacility {
    const location = facility?.location;

    return {
      type: ['Facility'],
      id: facility?.id,
      name: facility?.name,
      ...(facility?.description && { description: facility.description }),
      ...(facility?.primaryIdentifier && {
        registeredId: facility.primaryIdentifier.value,
        idScheme: buildIdentifierScheme(facility.primaryIdentifier.scheme),
      }),
      operatedByParty: buildParty(organisation),
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

    const facility = subject.facility as DfrFacility | undefined;
    if (!facility) return {};

    const refs: ExtractedIdentifierRefs = {};

    if (facility.registeredId) {
      refs.primaryIdentifier = facility.registeredId;
      refs.facility = { registeredId: facility.registeredId };
    }

    if (facility.operatedByParty?.registeredId) {
      refs.organisation = { registeredId: facility.operatedByParty.registeredId };
    }

    return refs;
  }
}
