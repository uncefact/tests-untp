import type {
  BridgeEntities,
  CredentialSubject,
  ConformityInput,
  ConformityTopicRef,
  FacilityEntity,
} from '../../../../types.js';
import { buildParty } from '../../../../primitives/party.js';
import { buildIdentifierScheme } from '../../../../primitives/identifier.js';

// ── Internal types ─────────────────────────────────────────────────────────────

// producedAtFacility is a facility *reference*, not the full Facility node: the
// schema shape at this path is {type, id, name, registeredId} only — no
// idScheme, location, or description (see DigitalProductPassport.json,
// Product.producedAtFacility).
type DppFacility = {
  type: ['Facility'];
  id: string | undefined;
  name: string | undefined;
  registeredId?: string;
};

type PartyRole = {
  type: ['PartyRole'];
  role: string;
  party: ReturnType<typeof buildParty>;
};

type ReferenceItem = { type: [string]; id: string; name: string };

type DppConformityTopic = { type: ['ConformityTopic']; id: string; name?: string; definition?: string };

type PerformanceClaim = {
  type: ['Claim', 'Declaration'];
  referenceStandard?: ReferenceItem[];
  referenceRegulation?: ReferenceItem[];
  referenceCriteria?: { type: ['Criterion']; id: string; name: string; conformityTopic?: DppConformityTopic[] }[];
  // Required by the schema on every Claim (distinct from the undeclared,
  // permissively-tolerated per-criterion field above).
  conformityTopic?: DppConformityTopic[];
};

// ── Private helpers ────────────────────────────────────────────────────────────

function buildFacility(facility: FacilityEntity | undefined): DppFacility {
  return {
    type: ['Facility'],
    id: facility?.id,
    name: facility?.name,
    ...(facility?.primaryIdentifier && { registeredId: facility.primaryIdentifier.value }),
  };
}

// Deduplicates by id, keeping the first occurrence's name/definition, since the
// same topic is commonly referenced by more than one criterion within a claim.
function buildClaimConformityTopics(criteria: ConformityInput['criteria']): DppConformityTopic[] | undefined {
  const byId = new Map<string, ConformityTopicRef>();
  for (const criterion of criteria ?? []) {
    for (const topic of criterion.conformityTopics ?? []) {
      if (!byId.has(topic.id)) byId.set(topic.id, topic);
    }
  }

  if (byId.size === 0) return undefined;

  return [...byId.values()].map((t) => ({
    type: ['ConformityTopic'],
    id: t.id,
    ...(t.name && { name: t.name }),
    ...(t.definition && { definition: t.definition }),
  }));
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
        ...(c.conformityTopics &&
          c.conformityTopics.length > 0 && {
            conformityTopic: c.conformityTopics.map(
              (t): DppConformityTopic => ({
                type: ['ConformityTopic'],
                id: t.id,
                ...(t.name && { name: t.name }),
                ...(t.definition && { definition: t.definition }),
              }),
            ),
          }),
      }));

    if (filteredCriteria.length > 0) {
      claim.referenceCriteria = filteredCriteria;
      const conformityTopic = buildClaimConformityTopics(input.criteria);
      if (conformityTopic) claim.conformityTopic = conformityTopic;
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
      modelNumber: product.primaryIdentifier.value,
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
