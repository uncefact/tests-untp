import type { BridgeEntities, CredentialSubject } from '../../../../types.js';
import { buildIdentifierScheme } from '../../../../primitives/identifier.js';

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDiaSubject(entities: BridgeEntities): CredentialSubject {
  // DIA anchors a single entity identity. Priority: organisation > facility > product.
  // entities.conformity is silently ignored.
  const entity = entities.organisation ?? entities.facility ?? entities.product;

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
    registeredName: entity?.name,
    ...(registerType && { registerType }),
    ...(entity?.primaryIdentifier && {
      registeredId: entity.primaryIdentifier.value,
      idScheme: buildIdentifierScheme(entity.primaryIdentifier.scheme),
    }),
  };
}
