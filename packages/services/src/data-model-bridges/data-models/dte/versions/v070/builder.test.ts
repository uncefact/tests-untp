import { makeBridge } from '../../../../make-bridge.js';
import { dteV070Spec } from './index.js';
import { createProduct, createBridgeEntities } from '../../../../__fixtures__/entities.js';

describe('buildDteSubject (v0.7.0)', () => {
  const bridge = makeBridge(dteV070Spec);

  // ── legacy fallback (no event input) ────────────────────────────────────────

  describe('legacy fallback (no event input)', () => {
    it('sets type to Event', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.type).toEqual(['Event']);
    });

    it('builds movedProduct from product (v0.7.0 EventProduct shape)', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct() }));
      const moved = subject.movedProduct as Record<string, unknown>[];
      expect(moved).toHaveLength(1);
      expect(moved[0].type).toEqual(['EventProduct']);
      const wrapped = moved[0].product as Record<string, unknown>;
      expect(wrapped.type).toEqual(['Product']);
      expect(wrapped.id).toBe('did:web:example.com:product:1');
    });

    it('omits movedProduct when product is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: undefined }));
      expect(subject.movedProduct).toBeUndefined();
    });

    it('does not emit legacy epcList key', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct() }));
      expect(subject.epcList).toBeUndefined();
    });
  });

  // ── ModifyEvent (replaces ObjectEvent) ──────────────────────────────────────

  describe('ModifyEvent (from object event)', () => {
    it('sets type to ModifyEvent + Event', () => {
      const subject = bridge.buildSubject({ event: { eventType: 'object', products: [createProduct()] } });
      expect(subject.type).toEqual(['ModifyEvent', 'Event']);
    });

    it('builds modifiedProduct from event.products as EventProduct[]', () => {
      const p1 = createProduct({ id: 'product-1', name: 'P1' });
      const p2 = createProduct({ id: 'product-2', name: 'P2' });
      const subject = bridge.buildSubject({ event: { eventType: 'object', products: [p1, p2] } });
      const modified = subject.modifiedProduct as Record<string, unknown>[];
      expect(modified).toHaveLength(2);
      expect(modified[0].type).toEqual(['EventProduct']);
      expect((modified[0].product as Record<string, unknown>).id).toBe('product-1');
      expect((modified[1].product as Record<string, unknown>).id).toBe('product-2');
    });

    it('does not emit legacy epcList key', () => {
      const subject = bridge.buildSubject({ event: { eventType: 'object', products: [createProduct()] } });
      expect(subject.epcList).toBeUndefined();
    });
  });

  // ── MakeEvent (replaces TransformationEvent) ────────────────────────────────

  describe('MakeEvent (from transformation event)', () => {
    it('sets type to MakeEvent + Event', () => {
      const subject = bridge.buildSubject({ event: { eventType: 'transformation' } });
      expect(subject.type).toEqual(['MakeEvent', 'Event']);
    });

    it('builds inputProduct and outputProduct as EventProduct arrays', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'transformation',
          inputProducts: [createProduct({ id: 'input-1', name: 'In' })],
          outputProducts: [createProduct({ id: 'output-1', name: 'Out' })],
        },
      });
      const inputs = subject.inputProduct as Record<string, unknown>[];
      const outputs = subject.outputProduct as Record<string, unknown>[];
      expect(inputs).toHaveLength(1);
      expect((inputs[0].product as Record<string, unknown>).id).toBe('input-1');
      expect(outputs).toHaveLength(1);
      expect((outputs[0].product as Record<string, unknown>).id).toBe('output-1');
    });

    it('does not emit legacy inputEPCList/outputEPCList keys', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'transformation',
          inputProducts: [createProduct({ id: 'input-1', name: 'In' })],
        },
      });
      expect(subject.inputEPCList).toBeUndefined();
      expect(subject.outputEPCList).toBeUndefined();
    });
  });

  // ── MoveEvent (replaces AggregationEvent) ───────────────────────────────────

  describe('MoveEvent (from aggregation event)', () => {
    it('sets type to MoveEvent + Event', () => {
      const subject = bridge.buildSubject({ event: { eventType: 'aggregation' } });
      expect(subject.type).toEqual(['MoveEvent', 'Event']);
    });

    it('merges parentProduct + childProducts into movedProduct', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'aggregation',
          parentProduct: createProduct({ id: 'parent-1', name: 'Box' }),
          childProducts: [
            createProduct({ id: 'child-1', name: 'Item A' }),
            createProduct({ id: 'child-2', name: 'Item B' }),
          ],
        },
      });
      const moved = subject.movedProduct as Record<string, unknown>[];
      expect(moved).toHaveLength(3);
      expect((moved[0].product as Record<string, unknown>).id).toBe('parent-1');
      expect((moved[1].product as Record<string, unknown>).id).toBe('child-1');
      expect((moved[2].product as Record<string, unknown>).id).toBe('child-2');
    });

    it('does not emit legacy parentEPC/childEPCList keys', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'aggregation',
          parentProduct: createProduct({ id: 'parent-1' }),
        },
      });
      expect(subject.parentEPC).toBeUndefined();
      expect(subject.childEPCList).toBeUndefined();
    });
  });

  // ── MoveEvent (replaces TransactionEvent) ───────────────────────────────────

  describe('MoveEvent (from transaction event)', () => {
    it('sets type to MoveEvent + Event', () => {
      const subject = bridge.buildSubject({ event: { eventType: 'transaction' } });
      expect(subject.type).toEqual(['MoveEvent', 'Event']);
    });

    it('maps sourceParty and destinationParty to relatedParty with PartyRole entries', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'transaction',
          sourceParty: 'https://id.gs1.org/417/seller',
          destinationParty: 'https://id.gs1.org/417/buyer',
          products: [createProduct({ id: 'traded-1', name: 'Goods' })],
        },
      });
      const parties = subject.relatedParty as Record<string, unknown>[];
      expect(parties).toHaveLength(2);
      expect(parties[0].role).toBe('source');
      expect((parties[0].party as Record<string, unknown>).id).toBe('https://id.gs1.org/417/seller');
      expect(parties[1].role).toBe('destination');
      expect((parties[1].party as Record<string, unknown>).id).toBe('https://id.gs1.org/417/buyer');
    });

    it('builds movedProduct from event.products', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'transaction',
          products: [createProduct({ id: 'traded-1', name: 'Goods' })],
        },
      });
      const moved = subject.movedProduct as Record<string, unknown>[];
      expect(moved).toHaveLength(1);
      expect((moved[0].product as Record<string, unknown>).id).toBe('traded-1');
    });

    it('does not emit legacy sourceParty/destinationParty top-level keys', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'transaction',
          sourceParty: 'https://id.gs1.org/417/seller',
          destinationParty: 'https://id.gs1.org/417/buyer',
        },
      });
      expect(subject.sourceParty).toBeUndefined();
      expect(subject.destinationParty).toBeUndefined();
    });
  });

  // ── AssociationEvent (removed in v0.7.0, mapped to MoveEvent) ──────────────

  describe('association event (removed in v0.7.0)', () => {
    it('maps association to a MoveEvent for back-compat', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'association',
          parentProduct: createProduct({ id: 'assembly', name: 'Assembly' }),
          childProducts: [createProduct({ id: 'component-1', name: 'Part' })],
        },
      });
      expect(subject.type).toEqual(['MoveEvent', 'Event']);
      const moved = subject.movedProduct as Record<string, unknown>[];
      expect(moved).toHaveLength(2);
      expect((moved[0].product as Record<string, unknown>).id).toBe('assembly');
      expect((moved[1].product as Record<string, unknown>).id).toBe('component-1');
    });
  });
});
