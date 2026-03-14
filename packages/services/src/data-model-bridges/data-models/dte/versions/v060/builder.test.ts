import { makeBridge } from '../../../../make-bridge.js';
import { dteV060Spec } from './index.js';
import { dteV061Spec } from '../v061/index.js';
import { createProduct, createBridgeEntities } from '../../../../__fixtures__/entities.js';
import type { VersionSpec } from '../../../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dteV060Spec],
  ['v0.6.1', dteV061Spec],
];

describe.each(versions)('buildDteSubject (%s)', (_version, spec) => {
  const bridge = makeBridge(spec);

  // ── legacy fallback (no event input) ────────────────────────────────────────

  describe('legacy fallback (no event input)', () => {
    it('sets type to Event', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.type).toEqual(['Event']);
    });

    it('builds epcList from product', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct() }));
      const epcList = subject.epcList as Record<string, unknown>[];
      expect(epcList).toHaveLength(1);
      expect(epcList[0].type).toEqual(['Item']);
      expect(epcList[0].id).toBe('did:web:example.com:product:1');
    });

    it('omits epcList when product is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: undefined }));
      expect(subject.epcList).toBeUndefined();
    });
  });

  // ── ObjectEvent ─────────────────────────────────────────────────────────────

  describe('ObjectEvent', () => {
    it('sets type to ObjectEvent + Event', () => {
      const subject = bridge.buildSubject({
        event: { eventType: 'object', products: [createProduct()] },
      });
      expect(subject.type).toEqual(['ObjectEvent', 'Event']);
    });

    it('builds epcList from event.products', () => {
      const p1 = createProduct({ id: 'product-1', name: 'P1' });
      const p2 = createProduct({ id: 'product-2', name: 'P2' });
      const subject = bridge.buildSubject({
        event: { eventType: 'object', products: [p1, p2] },
      });
      const epcList = subject.epcList as Record<string, unknown>[];
      expect(epcList).toHaveLength(2);
      expect(epcList[0].id).toBe('product-1');
      expect(epcList[1].id).toBe('product-2');
    });
  });

  // ── TransformationEvent ─────────────────────────────────────────────────────

  describe('TransformationEvent', () => {
    it('sets type to TransformationEvent + Event', () => {
      const subject = bridge.buildSubject({
        event: { eventType: 'transformation' },
      });
      expect(subject.type).toEqual(['TransformationEvent', 'Event']);
    });

    it('builds inputEPCList and outputEPCList', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'transformation',
          inputProducts: [createProduct({ id: 'input-1', name: 'In' })],
          outputProducts: [createProduct({ id: 'output-1', name: 'Out' })],
        },
      });
      const inputs = subject.inputEPCList as Record<string, unknown>[];
      const outputs = subject.outputEPCList as Record<string, unknown>[];
      expect(inputs).toHaveLength(1);
      expect(inputs[0].id).toBe('input-1');
      expect(outputs).toHaveLength(1);
      expect(outputs[0].id).toBe('output-1');
    });
  });

  // ── AggregationEvent ────────────────────────────────────────────────────────

  describe('AggregationEvent', () => {
    it('sets type to AggregationEvent + Event', () => {
      const subject = bridge.buildSubject({
        event: { eventType: 'aggregation' },
      });
      expect(subject.type).toEqual(['AggregationEvent', 'Event']);
    });

    it('builds parentEPC and childEPCList', () => {
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
      const parent = subject.parentEPC as Record<string, unknown>;
      const children = subject.childEPCList as Record<string, unknown>[];
      expect(parent.id).toBe('parent-1');
      expect(children).toHaveLength(2);
      expect(children[0].id).toBe('child-1');
      expect(children[1].id).toBe('child-2');
    });
  });

  // ── TransactionEvent ────────────────────────────────────────────────────────

  describe('TransactionEvent', () => {
    it('sets type to TransactionEvent + Event', () => {
      const subject = bridge.buildSubject({
        event: { eventType: 'transaction' },
      });
      expect(subject.type).toEqual(['TransactionEvent', 'Event']);
    });

    it('includes sourceParty, destinationParty, and epcList', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'transaction',
          sourceParty: 'https://id.gs1.org/417/seller',
          destinationParty: 'https://id.gs1.org/417/buyer',
          products: [createProduct({ id: 'traded-1', name: 'Goods' })],
        },
      });
      expect(subject.sourceParty).toBe('https://id.gs1.org/417/seller');
      expect(subject.destinationParty).toBe('https://id.gs1.org/417/buyer');
      const epcList = subject.epcList as Record<string, unknown>[];
      expect(epcList).toHaveLength(1);
      expect(epcList[0].id).toBe('traded-1');
    });
  });

  // ── AssociationEvent ────────────────────────────────────────────────────────

  describe('AssociationEvent', () => {
    it('sets type to AssociationEvent + Event', () => {
      const subject = bridge.buildSubject({
        event: { eventType: 'association' },
      });
      expect(subject.type).toEqual(['AssociationEvent', 'Event']);
    });

    it('builds parentEPC and childEPCList', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'association',
          parentProduct: createProduct({ id: 'assembly', name: 'Assembly' }),
          childProducts: [createProduct({ id: 'component-1', name: 'Part' })],
        },
      });
      const parent = subject.parentEPC as Record<string, unknown>;
      const children = subject.childEPCList as Record<string, unknown>[];
      expect(parent.id).toBe('assembly');
      expect(children).toHaveLength(1);
    });
  });
});
