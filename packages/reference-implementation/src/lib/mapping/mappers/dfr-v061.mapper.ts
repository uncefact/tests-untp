import { ICredentialMapper, ResolvedEntities, ExtractedIdentifierRefs, DataModelConfig, MapperOutput } from '../types';
import { registerMapper } from '../mapper-registry';
import type { IdentifierScheme } from '@uncefact/untp-ri-services';
import type { UntpLocation } from '@/lib/types';

// TODO: Consolidate shared types and helpers across v0.6.1 mappers into a
// common module (e.g. ./shared-v061.ts). Candidates:
//   - Party type (DccParty, DfrParty) and buildParty helper
//   - IdentifierScheme type import and buildIdentifierScheme helper (identical in DCC, DFR, DIA)
//   - Context/type array construction logic (identical in all four mappers)

/**
 * DFR v0.6.1 UNTP schema types.
 * These mirror the JSON schema definitions for the Digital Facility Record.
 */
type DfrParty = {
  id: string | undefined;
  name: string | undefined;
  registeredId?: string;
  idScheme?: IdentifierScheme;
};

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

/**
 * Mapper for Digital Facility Record v0.6.1.
 * Builds a UNTP DFR credential payload from facility and organisation entities.
 *
 * Output structure follows the UNTP DFR JSON schema:
 *   - credentialSubject is a FacilityRecord
 *   - facility maps to credentialSubject.facility with location, address
 *   - organisation maps to facility.operatedByParty with idScheme
 */
export class DfrV061Mapper implements ICredentialMapper {
  async buildPayload(entities: ResolvedEntities, config: DataModelConfig): Promise<MapperOutput> {
    const { organisation, facility } = entities;

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
        type: ['FacilityRecord'],
        facility: this.buildFacility(facility, organisation),
      },
    };
  }

  private buildFacility(
    facility: ResolvedEntities['facility'],
    organisation: ResolvedEntities['organisation'],
  ): DfrFacility {
    const location = facility?.location as UntpLocation | null | undefined;

    return {
      type: ['Facility'],
      id: facility?.id,
      name: facility?.name,
      ...(facility?.description && { description: facility.description }),
      ...(facility?.primaryIdentifier && {
        registeredId: facility.primaryIdentifier.value,
        idScheme: this.buildIdentifierScheme(facility.primaryIdentifier.scheme),
      }),
      operatedByParty: this.buildParty(organisation),
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

  private buildParty(org: ResolvedEntities['organisation']): DfrParty {
    return {
      id: org?.id,
      name: org?.name,
      ...(org?.primaryIdentifier && {
        registeredId: org.primaryIdentifier.value,
        idScheme: this.buildIdentifierScheme(org.primaryIdentifier.scheme),
      }),
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

    const facility = subject.facility as DfrFacility | undefined;
    if (!facility) return {};

    const refs: ExtractedIdentifierRefs = {};

    if (facility.registeredId) {
      refs.facility = { registeredId: facility.registeredId };
    }

    if (facility.operatedByParty?.registeredId) {
      refs.organisation = { registeredId: facility.operatedByParty.registeredId };
    }

    return refs;
  }
}

// Self-register on import
registerMapper('DigitalFacilityRecord', '0.6.1', new DfrV061Mapper());
