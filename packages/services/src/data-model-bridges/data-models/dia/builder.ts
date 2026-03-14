import type { BridgeEntities, CredentialSubject } from '../../types.js';
import { buildIdentifierScheme } from '../../primitives/identifier.js';

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDiaSubject(entities: BridgeEntities): CredentialSubject {
  // entities.conformity, entities.facility, and entities.product are silently ignored
  // DIA is organisation-identity only
  const { organisation } = entities;

  return {
    type: ['RegisteredIdentity'],
    id: organisation?.id,
    name: organisation?.name,
    ...(organisation?.primaryIdentifier && {
      registeredId: organisation.primaryIdentifier.value,
      idScheme: buildIdentifierScheme(organisation.primaryIdentifier.scheme),
    }),
  };
}
