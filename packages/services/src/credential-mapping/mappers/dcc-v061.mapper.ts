import type { IdentifierScheme } from '../../verifiable-credential/types.js';
import type {
  ICredentialMapper,
  ICvcAwareMapper,
  ResolvedEntities,
  ExtractedIdentifierRefs,
  ExtractedCvcRefs,
  DataModelConfig,
  MapperOutput,
} from '../types.js';
import type { CredentialPayload } from '../../verifiable-credential/types.js';
import { buildIdentifierScheme, buildParty, buildContextAndTypes } from './shared-v061.js';

type DccParty = ReturnType<typeof buildParty>;

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

export class DccV061Mapper implements ICredentialMapper, ICvcAwareMapper {
  async buildPayload(entities: ResolvedEntities, config: DataModelConfig): Promise<MapperOutput> {
    const { organisation, facility, product } = entities;
    const { contexts, types } = buildContextAndTypes(config);

    const assessment = this.buildAssessment(organisation, facility, product);

    return {
      '@context': contexts,
      type: types,
      credentialSubject: {
        type: ['ConformityAttestation', 'Attestation'],
        issuedToParty: buildParty(organisation),
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
            assessedOrganisation: buildParty(organisation),
          }
        : {}),
    };
  }

  private buildProduct(product: NonNullable<ResolvedEntities['product']>): DccProduct {
    return {
      id: product.id,
      name: product.name,
      ...(product.primaryIdentifier && {
        registeredId: product.primaryIdentifier.value,
        idScheme: buildIdentifierScheme(product.primaryIdentifier.scheme),
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
        idScheme: buildIdentifierScheme(facility.primaryIdentifier.scheme),
      }),
    };
  }

  extractEntityRefs(payload: MapperOutput): ExtractedIdentifierRefs {
    const subject = payload.credentialSubject;
    if (!subject) return {};

    const refs: ExtractedIdentifierRefs = {};

    const issuedToParty = subject.issuedToParty as DccParty | undefined;
    if (issuedToParty?.registeredId) {
      refs.organisation = { registeredId: issuedToParty.registeredId };
    }

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

      if (!refs.organisation && a.assessedOrganisation?.registeredId) {
        refs.organisation = { registeredId: a.assessedOrganisation.registeredId };
      }
    }

    // primaryIdentifier: product if present, else facility, else organisation
    refs.primaryIdentifier =
      refs.product?.registeredId ?? refs.facility?.registeredId ?? refs.organisation?.registeredId;

    return refs;
  }

  extractCvcRefs(credentialPayload: CredentialPayload): ExtractedCvcRefs {
    const subject = Array.isArray(credentialPayload.credentialSubject)
      ? credentialPayload.credentialSubject[0]
      : credentialPayload.credentialSubject;
    if (!subject) return { criteriaUrls: [] };

    // scope.id → scopeUrl
    const scope = subject.scope as { id?: string } | undefined;
    const scopeUrl = scope?.id;

    // assessment[].assessmentCriteria[].id → criteriaUrls (flattened, deduplicated)
    const criteriaUrls: string[] = [];
    const seen = new Set<string>();
    const assessments = subject.assessment as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(assessments)) {
      for (const assessment of assessments) {
        const criteria = assessment.assessmentCriteria as Array<{ id?: string }> | undefined;
        if (Array.isArray(criteria)) {
          for (const criterion of criteria) {
            if (criterion.id && !seen.has(criterion.id)) {
              seen.add(criterion.id);
              criteriaUrls.push(criterion.id);
            }
          }
        }
      }
    }

    return { ...(scopeUrl ? { scopeUrl } : {}), criteriaUrls };
  }
}
