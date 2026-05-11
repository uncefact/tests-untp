import type { BridgeEntities, CredentialSubject, ConformityInput, FacilityEntity } from '../../../../types.js';
import { buildParty } from '../../../../primitives/party.js';
import { buildIdentifierScheme } from '../../../../primitives/identifier.js';
import { buildLocationInformation, buildAddress } from '../../../../primitives/location.js';

// ── Internal types ─────────────────────────────────────────────────────────────

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

type DfrFacility = {
  type: ['Facility'];
  id: string | undefined;
  name: string | undefined;
  description?: string;
  registeredId?: string;
  idScheme?: ReturnType<typeof buildIdentifierScheme>;
  relatedParty: PartyRole[];
  locationInformation?: ReturnType<typeof buildLocationInformation>;
  address?: ReturnType<typeof buildAddress>;
  performanceClaim?: PerformanceClaim[];
};

// ── Private helpers ────────────────────────────────────────────────────────────

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

function buildFacility(
  facility: FacilityEntity | undefined,
  organisation: BridgeEntities['organisation'],
  performanceClaim: PerformanceClaim[] | undefined,
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
    relatedParty: [
      {
        type: ['PartyRole'],
        role: 'operator',
        party: buildParty(organisation),
      },
    ],
    ...(locationInformation && { locationInformation }),
    ...(address && { address }),
    ...(performanceClaim && { performanceClaim }),
  };
}

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDfrSubject(entities: BridgeEntities): CredentialSubject {
  // entities.product is silently ignored — DFR is facility-scoped
  const { organisation, facility, conformity } = entities;

  const performanceClaims = conformity && conformity.length > 0 ? conformity.map(buildPerformanceClaim) : undefined;

  return buildFacility(facility, organisation, performanceClaims);
}
