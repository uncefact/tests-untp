import { ICredentialMapper, ResolvedEntities, ExtractedIdentifierRefs, DataModelConfig, MapperOutput } from '../types';
import { registerMapper } from '../mapper-registry';
import type { IdentifierScheme } from '@uncefact/untp-ri-services';

// TODO: Consolidate shared types and helpers across v0.6.1 mappers into a
// common module (e.g. ./shared-v061.ts). Candidates:
//   - Party type (DccParty, DfrParty) and buildParty helper
//   - IdentifierScheme type import and buildIdentifierScheme helper (identical in DCC, DFR, DIA)
//   - Context/type array construction logic (identical in all four mappers)

/**
 * DCC v0.6.1 UNTP schema types.
 *
 * ConformityAttestation contains:
 *   - issuedToParty: the party receiving the attestation
 *   - assessment[]: ConformityAssessment entries, each targeting:
 *       - assessedProduct[]: ProductVerification (product being assessed)
 *       - assessedFacility[]: FacilityVerification (facility being assessed)
 *       - assessedOrganisation: the organisation being assessed
 *
 * All party/entity references include idScheme per JSON-LD context and example data.
 */
type DccParty = {
  id: string | undefined;
  name: string | undefined;
  description?: string;
  registeredId?: string;
  idScheme?: IdentifierScheme;
};

type DccProduct = {
  id: string | undefined;
  name: string | undefined;
  registeredId?: string;
  idScheme?: IdentifierScheme;
  batchNumber?: string;
  serialNumber?: string;
};

type DccFacility = {
  id: string | undefined;
  name: string | undefined;
  registeredId?: string;
  idScheme?: IdentifierScheme;
};

type DccProductVerification = {
  type: ['ProductVerification'];
  product: DccProduct;
};

type DccFacilityVerification = {
  type: ['FacilityVerification'];
  facility: DccFacility;
};

type DccAssessment = {
  type: ['ConformityAssessment', 'Declaration'];
  assessedProduct?: DccProductVerification[];
  assessedFacility?: DccFacilityVerification[];
  assessedOrganisation?: DccParty;
};

/**
 * Mapper for Digital Conformity Credential v0.6.1.
 * Builds a UNTP DCC credential payload from organisation, facility, and product entities.
 *
 * A DCC attests conformity of a company, facility, or product via assessments.
 *   - organisation maps to issuedToParty (recipient) and assessedOrganisation
 *   - product maps to assessedProduct within an assessment
 *   - facility maps to assessedFacility within an assessment
 */
export class DccV061Mapper implements ICredentialMapper {
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

    const assessment = this.buildAssessment(organisation, facility, product);

    return {
      '@context': contexts,
      type: types,
      credentialSubject: {
        type: ['ConformityAttestation', 'Attestation'],
        issuedToParty: this.buildParty(organisation),
        ...(assessment ? { assessment: [assessment] } : {}),
      },
    };
  }

  private buildAssessment(
    organisation: ResolvedEntities['organisation'],
    facility: ResolvedEntities['facility'],
    product: ResolvedEntities['product'],
  ): DccAssessment | undefined {
    if (!organisation && !facility && !product) return undefined;

    return {
      type: ['ConformityAssessment', 'Declaration'],
      ...(product
        ? {
            assessedProduct: [
              {
                type: ['ProductVerification'] as ['ProductVerification'],
                product: this.buildProduct(product),
              },
            ],
          }
        : {}),
      ...(facility
        ? {
            assessedFacility: [
              {
                type: ['FacilityVerification'] as ['FacilityVerification'],
                facility: this.buildFacility(facility),
              },
            ],
          }
        : {}),
      ...(organisation
        ? {
            assessedOrganisation: this.buildParty(organisation),
          }
        : {}),
    };
  }

  private buildParty(org: ResolvedEntities['organisation']): DccParty {
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

  private buildProduct(product: NonNullable<ResolvedEntities['product']>): DccProduct {
    return {
      id: product.id,
      name: product.name,
      ...(product.primaryIdentifier && {
        registeredId: product.primaryIdentifier.value,
        idScheme: this.buildIdentifierScheme(product.primaryIdentifier.scheme),
      }),
      ...(product.batchNumber && { batchNumber: product.batchNumber }),
      ...(product.serialNumber && { serialNumber: product.serialNumber }),
    };
  }

  private buildFacility(facility: NonNullable<ResolvedEntities['facility']>): DccFacility {
    return {
      id: facility.id,
      name: facility.name,
      ...(facility.primaryIdentifier && {
        registeredId: facility.primaryIdentifier.value,
        idScheme: this.buildIdentifierScheme(facility.primaryIdentifier.scheme),
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

    const refs: ExtractedIdentifierRefs = {};

    // Extract organisation from issuedToParty
    const issuedToParty = subject.issuedToParty as DccParty | undefined;
    if (issuedToParty?.registeredId) {
      refs.organisation = { registeredId: issuedToParty.registeredId };
    }

    // Extract from first assessment entry
    const assessment = subject.assessment as DccAssessment[] | undefined;
    if (assessment?.[0]) {
      const a = assessment[0];

      if (a.assessedProduct?.[0]?.product?.registeredId) {
        const p = a.assessedProduct[0].product;
        refs.product = {
          registeredId: p.registeredId!,
          ...(p.batchNumber ? { batchNumber: p.batchNumber } : {}),
          ...(p.serialNumber ? { serialNumber: p.serialNumber } : {}),
        };
      }

      if (a.assessedFacility?.[0]?.facility?.registeredId) {
        refs.facility = { registeredId: a.assessedFacility[0].facility.registeredId };
      }

      // Fallback: organisation from assessedOrganisation if not from issuedToParty
      if (!refs.organisation && a.assessedOrganisation?.registeredId) {
        refs.organisation = { registeredId: a.assessedOrganisation.registeredId };
      }
    }

    return refs;
  }
}

// Self-register on import
registerMapper('DigitalConformityCredential', '0.6.1', new DccV061Mapper());
