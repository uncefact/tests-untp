import { makeBridge } from '../../../../make-bridge.js';
import { dteV060Spec } from './index.js';
import { dteV061Spec } from '../v061/index.js';
import { createProduct, createConformityInput, createBridgeEntities } from '../../../../__fixtures__/entities.js';
import type { VersionSpec, CredentialSubject } from '../../../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dteV060Spec],
  ['v0.6.1', dteV061Spec],
];

const EMPTY_ARRAYS = { organisations: [], facilities: [], products: [] };

describe.each(versions)('extractDteRefs (%s)', (_version, spec) => {
  const bridge = makeBridge(spec);

  // ── edge cases ───────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty arrays for null subject', () => {
      const refs = bridge.extractRefs(null as unknown as CredentialSubject);
      expect(refs).toEqual(EMPTY_ARRAYS);
    });

    it('returns empty arrays for undefined subject', () => {
      const refs = bridge.extractRefs(undefined as unknown as CredentialSubject);
      expect(refs).toEqual(EMPTY_ARRAYS);
    });

    it('returns empty arrays when no event fields present', () => {
      const refs = bridge.extractRefs({ type: ['Event'] });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });

    it('returns empty arrays when epcList is empty', () => {
      const refs = bridge.extractRefs({ type: ['Event'], epcList: [] });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });

    it('returns empty arrays when items have no id', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ type: ['Item'], name: 'A product' }],
      });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });
  });

  // ── ObjectEvent: epcList ──────────────────────────────────────────────────────

  describe('ObjectEvent (epcList)', () => {
    it('extracts product ids from epcList', () => {
      const refs = bridge.extractRefs({
        type: ['ObjectEvent', 'Event'],
        epcList: [{ id: 'https://id.gs1.org/01/09520123456788' }, { id: 'https://id.gs1.org/01/09520123456799' }],
      });
      expect(refs.products).toEqual([
        { id: 'https://id.gs1.org/01/09520123456788' },
        { id: 'https://id.gs1.org/01/09520123456799' },
      ]);
    });

    it('deduplicates product ids', () => {
      const refs = bridge.extractRefs({
        type: ['ObjectEvent', 'Event'],
        epcList: [{ id: 'https://id.gs1.org/01/09520123456788' }, { id: 'https://id.gs1.org/01/09520123456788' }],
      });
      expect(refs.products).toEqual([{ id: 'https://id.gs1.org/01/09520123456788' }]);
    });
  });

  // ── TransformationEvent: inputEPCList + outputEPCList ─────────────────────────

  describe('TransformationEvent (inputEPCList + outputEPCList)', () => {
    it('extracts product ids from inputEPCList', () => {
      const refs = bridge.extractRefs({
        type: ['TransformationEvent', 'Event'],
        inputEPCList: [{ id: 'https://id.gs1.org/01/input-1' }],
      });
      expect(refs.products).toEqual([{ id: 'https://id.gs1.org/01/input-1' }]);
    });

    it('extracts product ids from outputEPCList', () => {
      const refs = bridge.extractRefs({
        type: ['TransformationEvent', 'Event'],
        outputEPCList: [{ id: 'https://id.gs1.org/01/output-1' }],
      });
      expect(refs.products).toEqual([{ id: 'https://id.gs1.org/01/output-1' }]);
    });

    it('extracts from both input and output, deduplicated', () => {
      const refs = bridge.extractRefs({
        type: ['TransformationEvent', 'Event'],
        inputEPCList: [{ id: 'https://id.gs1.org/01/input-1' }, { id: 'https://id.gs1.org/01/shared' }],
        outputEPCList: [{ id: 'https://id.gs1.org/01/output-1' }, { id: 'https://id.gs1.org/01/shared' }],
      });
      expect(refs.products).toEqual([
        { id: 'https://id.gs1.org/01/input-1' },
        { id: 'https://id.gs1.org/01/shared' },
        { id: 'https://id.gs1.org/01/output-1' },
      ]);
    });
  });

  // ── AggregationEvent / AssociationEvent: parentEPC + childEPCList ──────────────

  describe('AggregationEvent (parentEPC + childEPCList)', () => {
    it('extracts product id from parentEPC', () => {
      const refs = bridge.extractRefs({
        type: ['AggregationEvent', 'Event'],
        parentEPC: { id: 'https://id.gs1.org/01/parent-1' },
      });
      expect(refs.products).toEqual([{ id: 'https://id.gs1.org/01/parent-1' }]);
    });

    it('extracts product ids from childEPCList', () => {
      const refs = bridge.extractRefs({
        type: ['AggregationEvent', 'Event'],
        childEPCList: [{ id: 'https://id.gs1.org/01/child-1' }, { id: 'https://id.gs1.org/01/child-2' }],
      });
      expect(refs.products).toEqual([{ id: 'https://id.gs1.org/01/child-1' }, { id: 'https://id.gs1.org/01/child-2' }]);
    });

    it('extracts from both parent and children, deduplicated', () => {
      const refs = bridge.extractRefs({
        type: ['AssociationEvent', 'Event'],
        parentEPC: { id: 'https://id.gs1.org/01/parent-1' },
        childEPCList: [{ id: 'https://id.gs1.org/01/child-1' }, { id: 'https://id.gs1.org/01/parent-1' }],
      });
      expect(refs.products).toEqual([
        { id: 'https://id.gs1.org/01/parent-1' },
        { id: 'https://id.gs1.org/01/child-1' },
      ]);
    });
  });

  // ── TransactionEvent: sourceParty + destinationParty ──────────────────────────

  describe('TransactionEvent (sourceParty + destinationParty)', () => {
    it('extracts organisation ids from sourceParty and destinationParty', () => {
      const refs = bridge.extractRefs({
        type: ['TransactionEvent', 'Event'],
        epcList: [{ id: 'https://id.gs1.org/01/product-1' }],
        sourceParty: 'https://id.gs1.org/417/seller-gln',
        destinationParty: 'https://id.gs1.org/417/buyer-gln',
      });
      expect(refs.organisations).toEqual([
        { id: 'https://id.gs1.org/417/seller-gln' },
        { id: 'https://id.gs1.org/417/buyer-gln' },
      ]);
      expect(refs.products).toEqual([{ id: 'https://id.gs1.org/01/product-1' }]);
    });

    it('deduplicates organisation ids', () => {
      const refs = bridge.extractRefs({
        type: ['TransactionEvent', 'Event'],
        sourceParty: 'https://id.gs1.org/417/same-party',
        destinationParty: 'https://id.gs1.org/417/same-party',
      });
      expect(refs.organisations).toEqual([{ id: 'https://id.gs1.org/417/same-party' }]);
    });
  });

  // ── absent fields ─────────────────────────────────────────────────────────────

  describe('absent fields in result', () => {
    it('returns empty facilities array (DTE has no facility refs)', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ id: 'https://id.gs1.org/01/product-1' }],
      });
      expect(refs.facilities).toEqual([]);
    });

    it('does not include conformity in refs', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ id: 'https://id.gs1.org/01/product-1' }],
      });
      expect(refs.conformity).toBeUndefined();
    });
  });

  // ── round-trip ───────────────────────────────────────────────────────────────

  describe('round-trip (build → extract)', () => {
    it('extracts product ref from a fully built subject', () => {
      const entities = createBridgeEntities({ conformity: [createConformityInput()] });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.products).toHaveLength(1);
      expect(refs.products[0].id).toBe('did:web:example.com:product:1');
    });

    it('extracts empty refs when product is absent', () => {
      const entities = createBridgeEntities({ product: undefined });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.products).toEqual([]);
    });
  });
});
