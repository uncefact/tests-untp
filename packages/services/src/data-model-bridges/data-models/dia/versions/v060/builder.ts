import type { BridgeEntities, CredentialSubject } from '../../../../types.js';
import { buildIdentifierScheme } from '../../../../primitives/identifier.js';

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDiaSubject(entities: BridgeEntities): CredentialSubject {
  // DIA anchors a single entity identity — use whichever is provided
  // Priority: organisation > facility > product (if multiple provided)
  // entities.conformity is silently ignored — DIA has no conformity fields
  const entity = entities.organisation ?? entities.facility ?? entities.product;

  // Map entity source to the DIA registerType vocabulary
  const registerType = entities.organisation
    ? 'Business'
    : entities.facility
      ? 'Facility'
      : entities.product
        ? 'Product'
        : undefined;

  return {
    type: ['RegisteredIdentity'],
    id: entity?.id,
    name: entity?.name,
    ...(registerType && { registerType }),
    ...(entity?.primaryIdentifier && {
      registeredId: entity.primaryIdentifier.value,
      idScheme: buildIdentifierScheme(entity.primaryIdentifier.scheme),
    }),
  };
}
