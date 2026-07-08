import type { BridgeEntities, CredentialSubject } from '../../../../types.js';
import { buildIdentifierScheme } from '../../../../primitives/identifier.js';

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDiaSubject(entities: BridgeEntities): CredentialSubject {
  // DIA anchors a single entity identity. Priority: organisation > facility > product.
  // entities.conformity is silently ignored.
  const entity = entities.organisation ?? entities.facility ?? entities.product;

  // The v0.7.0 registerType code list is lowercase, unlike v0.6.x's capitalised
  // values. See the RegisteredIdentity definition in
  // https://untp.unece.org/artefacts/schema/v0.7.0/dia/DigitalIdentityAnchor.json
  const registerType = entities.organisation
    ? 'business'
    : entities.facility
      ? 'facility'
      : entities.product
        ? 'product'
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
