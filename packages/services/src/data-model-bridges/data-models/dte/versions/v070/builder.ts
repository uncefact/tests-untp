import type { BridgeEntities, CredentialSubject, ProductEntity } from '../../../../types.js';

// v0.7.0 replaces EPCIS-derived event types with semantic ones:
//   TransformationEvent → MakeEvent
//   ObjectEvent        → ModifyEvent
//   AggregationEvent   → MoveEvent
//   TransactionEvent   → MoveEvent
//   AssociationEvent   → removed (mapped here to MoveEvent for back-compat)

// ── Private helpers ─────────────────────────────────────────────────────────────

function buildEventProduct(product: ProductEntity) {
  return {
    type: ['EventProduct'] as const,
    product: { type: ['Product'] as const, id: product.id, name: product.name },
  };
}

function buildEventProductList(products: ProductEntity[] | undefined) {
  if (!products || products.length === 0) return undefined;
  return products.map(buildEventProduct);
}

function buildPartyRole(partyId: string, role: string) {
  return {
    type: ['PartyRole'] as const,
    role,
    party: { type: ['Party'] as const, id: partyId },
  };
}

// ── Public builder ─────────────────────────────────────────────────────────────

export function buildDteSubject(entities: BridgeEntities): CredentialSubject {
  const { event, product } = entities;

  if (!event) {
    // Legacy fallback — no event: emit a bare Event with movedProduct (closest v0.7.0 equivalent)
    return {
      type: ['Event'],
      ...(product ? { movedProduct: [buildEventProduct(product)] } : {}),
    };
  }

  switch (event.eventType) {
    case 'object':
      return {
        type: ['ModifyEvent', 'Event'],
        ...(buildEventProductList(event.products) && { modifiedProduct: buildEventProductList(event.products) }),
      };

    case 'transformation':
      return {
        type: ['MakeEvent', 'Event'],
        ...(buildEventProductList(event.inputProducts) && { inputProduct: buildEventProductList(event.inputProducts) }),
        ...(buildEventProductList(event.outputProducts) && {
          outputProduct: buildEventProductList(event.outputProducts),
        }),
      };

    case 'aggregation': {
      const movedProducts: ProductEntity[] = [];
      if (event.parentProduct) movedProducts.push(event.parentProduct);
      if (event.childProducts) movedProducts.push(...event.childProducts);
      return {
        type: ['MoveEvent', 'Event'],
        ...(movedProducts.length > 0 && { movedProduct: movedProducts.map(buildEventProduct) }),
      };
    }

    case 'transaction': {
      const relatedParty = [];
      if (event.sourceParty) relatedParty.push(buildPartyRole(event.sourceParty, 'source'));
      if (event.destinationParty) relatedParty.push(buildPartyRole(event.destinationParty, 'destination'));
      return {
        type: ['MoveEvent', 'Event'],
        ...(relatedParty.length > 0 && { relatedParty }),
        ...(buildEventProductList(event.products) && { movedProduct: buildEventProductList(event.products) }),
      };
    }

    case 'association': {
      // AssociationEvent removed in v0.7.0; closest semantic mapping is MoveEvent
      const movedProducts: ProductEntity[] = [];
      if (event.parentProduct) movedProducts.push(event.parentProduct);
      if (event.childProducts) movedProducts.push(...event.childProducts);
      return {
        type: ['MoveEvent', 'Event'],
        ...(movedProducts.length > 0 && { movedProduct: movedProducts.map(buildEventProduct) }),
      };
    }
  }
}
