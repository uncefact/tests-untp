import type { BridgeEntities, CredentialSubject, ProductEntity } from '../../../../types.js';

// TODO: DTE single-event limitation — the UNTP schema allows credentialSubject
// to be an array of events but this bridge builds a single event only.
// Raise with UNTP working group.

// ── Private helpers ─────────────────────────────────────────────────────────────

function buildItem(product: ProductEntity) {
  return { type: ['Item'] as const, id: product.id, name: product.name };
}

function buildItemList(products: ProductEntity[] | undefined) {
  if (!products || products.length === 0) return undefined;
  return products.map(buildItem);
}

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDteSubject(entities: BridgeEntities): CredentialSubject {
  const { event, product } = entities;

  if (!event) {
    // Fallback: legacy behaviour — build a generic Event from product
    return {
      type: ['Event'],
      ...(product ? { epcList: [buildItem(product)] } : {}),
    };
  }

  switch (event.eventType) {
    case 'object':
      return {
        type: ['ObjectEvent', 'Event'],
        ...(buildItemList(event.products) && { epcList: buildItemList(event.products) }),
      };

    case 'transformation':
      return {
        type: ['TransformationEvent', 'Event'],
        ...(buildItemList(event.inputProducts) && { inputEPCList: buildItemList(event.inputProducts) }),
        ...(buildItemList(event.outputProducts) && { outputEPCList: buildItemList(event.outputProducts) }),
      };

    case 'aggregation':
      return {
        type: ['AggregationEvent', 'Event'],
        ...(event.parentProduct && { parentEPC: buildItem(event.parentProduct) }),
        ...(buildItemList(event.childProducts) && { childEPCList: buildItemList(event.childProducts) }),
      };

    case 'transaction':
      return {
        type: ['TransactionEvent', 'Event'],
        ...(event.sourceParty && { sourceParty: event.sourceParty }),
        ...(event.destinationParty && { destinationParty: event.destinationParty }),
        ...(buildItemList(event.products) && { epcList: buildItemList(event.products) }),
      };

    case 'association':
      return {
        type: ['AssociationEvent', 'Event'],
        ...(event.parentProduct && { parentEPC: buildItem(event.parentProduct) }),
        ...(buildItemList(event.childProducts) && { childEPCList: buildItemList(event.childProducts) }),
      };
  }
}
