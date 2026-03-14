import type { BridgeEntities, CredentialSubject, ConformityInput } from '../../types.js';
import { buildParty } from '../../primitives/party.js';
import { buildIdentifierScheme } from '../../primitives/identifier.js';
import { buildLocationInformation, buildAddress } from '../../primitives/location.js';
import type { FacilityEntity } from '../../types.js';

// ── Internal types ─────────────────────────────────────────────────────────────

type DfrFacility = {
  type: ['Facility'];
  id: string | undefined;
  name: string | undefined;
  description?: string;
  registeredId?: string;
  idScheme?: ReturnType<typeof buildIdentifierScheme>;
  operatedByParty: ReturnType<typeof buildParty>;
  locationInformation?: ReturnType<typeof buildLocationInformation>;
  address?: ReturnType<typeof buildAddress>;
};

type ConformityClaim = {
  type: ['Claim', 'Declaration'];
  referenceStandard?: { type: ['Standard']; id: string; name: string };
  referenceRegulation?: { type: ['Regulation']; id: string; name: string };
  assessmentCriteria?: { type: ['Criterion']; id: string; name: string; conformityTopic?: string }[];
};

// ── Private helpers ────────────────────────────────────────────────────────────

function buildFacility(
  facility: FacilityEntity | undefined,
  organisation: BridgeEntities['organisation'],
): DfrFacility {
  const location = facility?.location;
  const locationInformation = buildLocationInformation(location);
  const address = buildAddress(location?.address);

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
    ...(locationInformation && { locationInformation }),
    ...(address && { address }),
  };
}

function buildConformityClaim(input: ConformityInput): ConformityClaim {
  const claim: ConformityClaim = { type: ['Claim', 'Declaration'] };

  if (input.standard?.id) {
    claim.referenceStandard = {
      type: ['Standard'],
      id: input.standard.id,
      name: input.standard.name ?? '',
    };
  }

  if (input.regulation?.id) {
    claim.referenceRegulation = {
      type: ['Regulation'],
      id: input.regulation.id,
      name: input.regulation.name ?? '',
    };
  }

  if (input.criteria && input.criteria.length > 0) {
    const filteredCriteria = input.criteria
      .filter((c) => c.id !== '')
      .map((c) => ({
        type: ['Criterion'] as ['Criterion'],
        id: c.id,
        name: c.name,
        ...(c.conformityTopic && { conformityTopic: c.conformityTopic }),
      }));

    if (filteredCriteria.length > 0) {
      claim.assessmentCriteria = filteredCriteria;
    }
  }

  return claim;
}

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDfrSubject(entities: BridgeEntities): CredentialSubject {
  // entities.product is silently ignored — DFR is facility-scoped, not product-scoped
  const { organisation, facility, conformity } = entities;

  const conformityClaims = conformity && conformity.length > 0 ? conformity.map(buildConformityClaim) : undefined;

  return {
    type: ['FacilityRecord'],
    facility: buildFacility(facility, organisation),
    ...(conformityClaims && { conformityClaim: conformityClaims }),
  };
}
