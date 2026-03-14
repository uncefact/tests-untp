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
  serialNumber?: string;
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

type DccScope = {
  type: ['ConformityAssessmentScheme', 'Standard'];
  id: string;
  name?: string;
};

type DccAssessment = {
  type: ['ConformityAssessment', 'Declaration'];
  referenceStandard?: { type: ['Standard']; id: string; name: string };
  referenceRegulation?: { type: ['Regulation']; id: string; name: string };
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
    ...(product.serialNumber && { serialNumber: product.serialNumber }),
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

function buildAssessment(conformityInput: ConformityInput, entities: BridgeEntities): DccAssessment {
  const { organisation, facility, product } = entities;
  const assessment: DccAssessment = { type: ['ConformityAssessment', 'Declaration'] };

  if (conformityInput.standard?.id) {
    assessment.referenceStandard = {
      type: ['Standard'],
      id: conformityInput.standard.id,
      name: conformityInput.standard.name ?? '',
    };
  }

  if (conformityInput.regulation?.id) {
    assessment.referenceRegulation = {
      type: ['Regulation'],
      id: conformityInput.regulation.id,
      name: conformityInput.regulation.name ?? '',
    };
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
    assessment.assessedProduct = [
      {
        type: ['ProductVerification'],
        product: buildDccProduct(product),
      },
    ];
  }

  if (facility) {
    assessment.assessedFacility = [
      {
        type: ['FacilityVerification'],
        facility: buildDccFacility(facility),
      },
    ];
  }

  if (organisation) {
    assessment.assessedOrganisation = buildParty(organisation);
  }

  return assessment;
}

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDccSubject(entities: BridgeEntities): CredentialSubject {
  const { organisation, conformity } = entities;

  // scope is derived from the first conformity input's scheme (DCC-only concept)
  const firstScheme = conformity?.[0]?.scheme;
  const scope: DccScope | undefined = firstScheme?.id
    ? {
        type: ['ConformityAssessmentScheme', 'Standard'],
        id: firstScheme.id,
        ...(firstScheme.name && { name: firstScheme.name }),
      }
    : undefined;

  // Each conformity input becomes one assessment entry
  const assessment =
    conformity && conformity.length > 0 ? conformity.map((input) => buildAssessment(input, entities)) : undefined;

  return {
    type: ['ConformityAttestation', 'Attestation'],
    issuedToParty: buildParty(organisation),
    ...(scope && { scope }),
    ...(assessment && { assessment }),
  };
}
