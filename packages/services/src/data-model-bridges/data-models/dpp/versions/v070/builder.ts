import type { BridgeEntities, CredentialSubject, ConformityInput, FacilityEntity } from '../../../../types.js';
import { buildParty } from '../../../../primitives/party.js';
import { buildIdentifierScheme } from '../../../../primitives/identifier.js';
import { buildLocationInformation, buildAddress } from '../../../../primitives/location.js';

// ── Internal types ─────────────────────────────────────────────────────────────

type DppFacility = {
  type: ['Facility'];
  id: string | undefined;
  name: string | undefined;
  description?: string;
  registeredId?: string;
  idScheme?: ReturnType<typeof buildIdentifierScheme>;
  locationInformation?: ReturnType<typeof buildLocationInformation>;
  address?: ReturnType<typeof buildAddress>;
};

type PartyRole = {
  type: ['PartyRole'];
  role: string;
  party: ReturnType<typeof buildParty>;
};

type ReferenceItem = { type: [string]; id: string; name: string };

type PerformanceClaim = {
  type: ['Claim', 'Declaration'];
  referenceStandard?: ReferenceItem[];
  referenceRegulation?: ReferenceItem[];
  referenceCriteria?: { type: ['Criterion']; id: string; name: string; conformityTopic?: string }[];
};

// ── Private helpers ────────────────────────────────────────────────────────────

function buildFacility(facility: FacilityEntity | undefined): DppFacility {
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
    ...(locationInformation && { locationInformation }),
    ...(address && { address }),
  };
}

function buildPerformanceClaim(input: ConformityInput): PerformanceClaim {
  const claim: PerformanceClaim = { type: ['Claim', 'Declaration'] };

  if (input.standard?.id) {
    claim.referenceStandard = [{ type: ['Standard'], id: input.standard.id, name: input.standard.name ?? '' }];
  }

  if (input.regulation?.id) {
    claim.referenceRegulation = [{ type: ['Regulation'], id: input.regulation.id, name: input.regulation.name ?? '' }];
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
      claim.referenceCriteria = filteredCriteria;
    }
  }

  return claim;
}

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDppSubject(entities: BridgeEntities): CredentialSubject {
  const { organisation, facility, product, conformity } = entities;

  const performanceClaims = conformity && conformity.length > 0 ? conformity.map(buildPerformanceClaim) : undefined;

  return {
    type: ['Product'],
    id: product?.id,
    name: product?.name,
    ...(product?.description && { description: product.description }),
    ...(product?.primaryIdentifier && {
      idScheme: buildIdentifierScheme(product.primaryIdentifier.scheme),
    }),
    ...(product?.batchNumber && { batchNumber: product.batchNumber }),
    ...(product?.serialNumber && { itemNumber: product.serialNumber }),
    ...(product?.level && { idGranularity: product.level.toLowerCase() }),
    producedAtFacility: buildFacility(facility),
    relatedParty: [
      {
        type: ['PartyRole'],
        role: 'producer',
        party: buildParty(organisation),
      },
    ],
    ...(performanceClaims && { performanceClaim: performanceClaims }),
  };
}
