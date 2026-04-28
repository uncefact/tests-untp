import type { BridgeEntities, CredentialSubject, ConformityInput } from '../../../../types.js';
import { buildParty } from '../../../../primitives/party.js';
import { buildIdentifierScheme } from '../../../../primitives/identifier.js';

// ── Internal types ─────────────────────────────────────────────────────────────

type DccProduct = {
  type: ['Product'];
  id: string | undefined;
  name: string | undefined;
  registeredId?: string;
  idScheme?: ReturnType<typeof buildIdentifierScheme>;
  batchNumber?: string;
  itemNumber?: string;
};

type DccFacility = {
  type: ['Facility'];
  id: string | undefined;
  name: string | undefined;
  registeredId?: string;
  idScheme?: ReturnType<typeof buildIdentifierScheme>;
};

type DccProductVerification = {
  type: ['ProductVerification'];
  product: DccProduct;
};

type DccFacilityVerification = {
  type: ['FacilityVerification'];
  facility: DccFacility;
};

type DccReferenceScheme = {
  type: ['ConformityScheme'];
  id: string;
  name?: string;
};

type ReferenceItem = { type: [string]; id: string; name: string };

type DccConformityAssessment = {
  type: ['ConformityAssessment', 'Declaration'];
  referenceStandard?: ReferenceItem[];
  referenceRegulation?: ReferenceItem[];
  assessmentCriteria?: { type: ['Criterion']; id: string; name: string; conformityTopic?: string }[];
  assessedProduct?: DccProductVerification[];
  assessedFacility?: DccFacilityVerification[];
  assessedOrganisation?: ReturnType<typeof buildParty>;
};

// ── Private helpers ────────────────────────────────────────────────────────────

function buildDccProduct(product: NonNullable<BridgeEntities['product']>): DccProduct {
  return {
    type: ['Product'],
    id: product.id,
    name: product.name,
    ...(product.primaryIdentifier && {
      registeredId: product.primaryIdentifier.value,
      idScheme: buildIdentifierScheme(product.primaryIdentifier.scheme),
    }),
    ...(product.batchNumber && { batchNumber: product.batchNumber }),
    ...(product.serialNumber && { itemNumber: product.serialNumber }),
  };
}

function buildDccFacility(facility: NonNullable<BridgeEntities['facility']>): DccFacility {
  return {
    type: ['Facility'],
    id: facility.id,
    name: facility.name,
    ...(facility.primaryIdentifier && {
      registeredId: facility.primaryIdentifier.value,
      idScheme: buildIdentifierScheme(facility.primaryIdentifier.scheme),
    }),
  };
}

function buildAssessment(conformityInput: ConformityInput, entities: BridgeEntities): DccConformityAssessment {
  const { organisation, facility, product } = entities;
  const assessment: DccConformityAssessment = { type: ['ConformityAssessment', 'Declaration'] };

  if (conformityInput.standard?.id) {
    assessment.referenceStandard = [
      { type: ['Standard'], id: conformityInput.standard.id, name: conformityInput.standard.name ?? '' },
    ];
  }

  if (conformityInput.regulation?.id) {
    assessment.referenceRegulation = [
      { type: ['Regulation'], id: conformityInput.regulation.id, name: conformityInput.regulation.name ?? '' },
    ];
  }

  if (conformityInput.criteria && conformityInput.criteria.length > 0) {
    const filteredCriteria = conformityInput.criteria
      .filter((c) => c.id !== '')
      .map((c) => ({
        type: ['Criterion'] as ['Criterion'],
        id: c.id,
        name: c.name,
        ...(c.conformityTopic && { conformityTopic: c.conformityTopic }),
      }));

    if (filteredCriteria.length > 0) {
      assessment.assessmentCriteria = filteredCriteria;
    }
  }

  if (product) {
    assessment.assessedProduct = [{ type: ['ProductVerification'], product: buildDccProduct(product) }];
  }

  if (facility) {
    assessment.assessedFacility = [{ type: ['FacilityVerification'], facility: buildDccFacility(facility) }];
  }

  if (organisation) {
    assessment.assessedOrganisation = buildParty(organisation);
  }

  return assessment;
}

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDccSubject(entities: BridgeEntities): CredentialSubject {
  const { organisation, conformity } = entities;

  // referenceScheme is derived from the first conformity input's scheme
  const firstScheme = conformity?.[0]?.scheme;
  const referenceScheme: DccReferenceScheme | undefined = firstScheme?.id
    ? {
        type: ['ConformityScheme'],
        id: firstScheme.id,
        ...(firstScheme.name && { name: firstScheme.name }),
      }
    : undefined;

  const conformityAssessment =
    conformity && conformity.length > 0 ? conformity.map((input) => buildAssessment(input, entities)) : undefined;

  return {
    type: ['ConformityAttestation', 'Attestation'],
    issuedToParty: buildParty(organisation),
    ...(referenceScheme && { referenceScheme }),
    ...(conformityAssessment && { conformityAssessment }),
  };
}
