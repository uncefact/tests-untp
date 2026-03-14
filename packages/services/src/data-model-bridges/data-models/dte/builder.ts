import type { BridgeEntities, CredentialSubject } from '../../types.js';

// TODO: DTE single-event limitation — the UNTP schema allows an array of events
// but this bridge builds a single event only. Raise with UNTP working group.

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDteSubject(entities: BridgeEntities): CredentialSubject {
  // entities.organisation, entities.facility, and entities.conformity are silently ignored
  // DTE is product/event scoped only
  const { product } = entities;

  return {
    type: ['Event'],
    ...(product ? { epcList: [{ type: ['Item'], id: product.id, name: product.name }] } : {}),
  };
}
