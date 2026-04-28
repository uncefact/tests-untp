import { makeBridge } from '../../../../make-bridge.js';
import { dteV070Spec } from './index.js';
import { createProduct, createConformityInput, createBridgeEntities } from '../../../../__fixtures__/entities.js';
import type { CredentialSubject } from '../../../../types.js';

const EMPTY_ARRAYS = { organisations: [], facilities: [], products: [] };

describe('extractDteRefs (v0.7.0)', () => {
  const bridge = makeBridge(dteV070Spec);

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

    it('returns empty arrays when modifiedProduct is empty', () => {
      const refs = bridge.extractRefs({ type: ['ModifyEvent', 'Event'], modifiedProduct: [] });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });

    it('returns empty arrays when EventProduct has no product.id', () => {
      const refs = bridge.extractRefs({
        type: ['ModifyEvent', 'Event'],
        modifiedProduct: [{ type: ['EventProduct'], product: { name: 'A product' } }],
      });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });
  });

  // ── ModifyEvent: modifiedProduct ────────────────────────────────────────────

  describe('ModifyEvent (modifiedProduct)', () => {
    it('extracts product ids from modifiedProduct[].product.id', () => {
      const refs = bridge.extractRefs({
        type: ['ModifyEvent', 'Event'],
        modifiedProduct: [
          { product: { id: 'https://id.gs1.org/01/09520123456788' } },
          { product: { id: 'https://id.gs1.org/01/09520123456799' } },
        ],
      });
      expect(refs.products).toEqual([
        { id: 'https://id.gs1.org/01/09520123456788' },
        { id: 'https://id.gs1.org/01/09520123456799' },
      ]);
    });

    it('deduplicates product ids', () => {
      const refs = bridge.extractRefs({
        type: ['ModifyEvent', 'Event'],
        modifiedProduct: [
          { product: { id: 'https://id.gs1.org/01/09520123456788' } },
          { product: { id: 'https://id.gs1.org/01/09520123456788' } },
        ],
      });
      expect(refs.products).toEqual([{ id: 'https://id.gs1.org/01/09520123456788' }]);
    });

    it('extracts modifiedAtFacility id', () => {
      const refs = bridge.extractRefs({
        type: ['ModifyEvent', 'Event'],
        modifiedProduct: [{ product: { id: 'p-1' } }],
        modifiedAtFacility: { id: 'https://example.org/facility/A' },
      });
      expect(refs.facilities).toEqual([{ id: 'https://example.org/facility/A' }]);
    });
  });

  // ── MakeEvent: inputProduct + outputProduct ─────────────────────────────────

  describe('MakeEvent (inputProduct + outputProduct)', () => {
    it('extracts product ids from inputProduct', () => {
      const refs = bridge.extractRefs({
        type: ['MakeEvent', 'Event'],
        inputProduct: [{ product: { id: 'https://id.gs1.org/01/input-1' } }],
      });
      expect(refs.products).toEqual([{ id: 'https://id.gs1.org/01/input-1' }]);
    });

    it('extracts product ids from outputProduct', () => {
      const refs = bridge.extractRefs({
        type: ['MakeEvent', 'Event'],
        outputProduct: [{ product: { id: 'https://id.gs1.org/01/output-1' } }],
      });
      expect(refs.products).toEqual([{ id: 'https://id.gs1.org/01/output-1' }]);
    });

    it('extracts from both input and output, deduplicated', () => {
      const refs = bridge.extractRefs({
        type: ['MakeEvent', 'Event'],
        inputProduct: [
          { product: { id: 'https://id.gs1.org/01/input-1' } },
          { product: { id: 'https://id.gs1.org/01/shared' } },
        ],
        outputProduct: [
          { product: { id: 'https://id.gs1.org/01/output-1' } },
          { product: { id: 'https://id.gs1.org/01/shared' } },
        ],
      });
      expect(refs.products).toEqual([
        { id: 'https://id.gs1.org/01/input-1' },
        { id: 'https://id.gs1.org/01/shared' },
        { id: 'https://id.gs1.org/01/output-1' },
      ]);
    });

    it('extracts madeAtFacility id', () => {
      const refs = bridge.extractRefs({
        type: ['MakeEvent', 'Event'],
        madeAtFacility: { registeredId: 'FAC-123' },
      });
      expect(refs.facilities).toEqual([{ id: 'FAC-123' }]);
    });
  });

  // ── MoveEvent: movedProduct + from/toFacility + relatedParty ────────────────

  describe('MoveEvent (movedProduct + facilities + relatedParty)', () => {
    it('extracts product ids from movedProduct', () => {
      const refs = bridge.extractRefs({
        type: ['MoveEvent', 'Event'],
        movedProduct: [
          { product: { id: 'https://id.gs1.org/01/product-1' } },
          { product: { id: 'https://id.gs1.org/01/product-2' } },
        ],
      });
      expect(refs.products).toEqual([
        { id: 'https://id.gs1.org/01/product-1' },
        { id: 'https://id.gs1.org/01/product-2' },
      ]);
    });

    it('extracts fromFacility and toFacility ids', () => {
      const refs = bridge.extractRefs({
        type: ['MoveEvent', 'Event'],
        fromFacility: { id: 'facility-origin' },
        toFacility: { registeredId: 'facility-dest' },
      });
      expect(refs.facilities).toEqual([{ id: 'facility-origin' }, { id: 'facility-dest' }]);
    });

    it('deduplicates facility ids across from/to fields', () => {
      const refs = bridge.extractRefs({
        type: ['MoveEvent', 'Event'],
        fromFacility: { id: 'same-facility' },
        toFacility: { id: 'same-facility' },
      });
      expect(refs.facilities).toEqual([{ id: 'same-facility' }]);
    });

    it('extracts organisation ids from relatedParty[].party', () => {
      const refs = bridge.extractRefs({
        type: ['MoveEvent', 'Event'],
        relatedParty: [
          { type: ['PartyRole'], role: 'source', party: { type: ['Party'], id: 'https://id.gs1.org/417/seller' } },
          { type: ['PartyRole'], role: 'destination', party: { type: ['Party'], id: 'https://id.gs1.org/417/buyer' } },
        ],
      });
      expect(refs.organisations).toEqual([
        { id: 'https://id.gs1.org/417/seller' },
        { id: 'https://id.gs1.org/417/buyer' },
      ]);
    });

    it('prefers party.registeredId over party.id when both are present', () => {
      const refs = bridge.extractRefs({
        type: ['MoveEvent', 'Event'],
        relatedParty: [{ role: 'source', party: { id: 'did:web:seller', registeredId: 'SELLER-REG' } }],
      });
      expect(refs.organisations).toEqual([{ id: 'SELLER-REG' }]);
    });

    it('deduplicates organisation ids', () => {
      const refs = bridge.extractRefs({
        type: ['MoveEvent', 'Event'],
        relatedParty: [
          { role: 'source', party: { id: 'https://id.gs1.org/417/same-party' } },
          { role: 'destination', party: { id: 'https://id.gs1.org/417/same-party' } },
        ],
      });
      expect(refs.organisations).toEqual([{ id: 'https://id.gs1.org/417/same-party' }]);
    });
  });

  // ── absent fields ─────────────────────────────────────────────────────────────

  describe('absent fields in result', () => {
    it('returns empty facilities array when no facility fields present', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        movedProduct: [{ product: { id: 'p-1' } }],
      });
      expect(refs.facilities).toEqual([]);
    });

    it('does not include conformity in refs', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        movedProduct: [{ product: { id: 'p-1' } }],
      });
      expect(refs.conformity).toBeUndefined();
    });
  });

  // ── round-trip ───────────────────────────────────────────────────────────────

  describe('round-trip (build → extract)', () => {
    it('extracts product ref from a fully built fallback subject', () => {
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

    it('round-trips a transformation event through MakeEvent', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'transformation',
          inputProducts: [createProduct({ id: 'input-a' })],
          outputProducts: [createProduct({ id: 'output-b' })],
        },
      });
      const refs = bridge.extractRefs(subject);
      expect(refs.products).toEqual([{ id: 'input-a' }, { id: 'output-b' }]);
    });

    it('round-trips a transaction event through MoveEvent', () => {
      const subject = bridge.buildSubject({
        event: {
          eventType: 'transaction',
          sourceParty: 'https://id.gs1.org/417/seller',
          destinationParty: 'https://id.gs1.org/417/buyer',
          products: [createProduct({ id: 'traded-1' })],
        },
      });
      const refs = bridge.extractRefs(subject);
      expect(refs.products).toEqual([{ id: 'traded-1' }]);
      expect(refs.organisations).toEqual([
        { id: 'https://id.gs1.org/417/seller' },
        { id: 'https://id.gs1.org/417/buyer' },
      ]);
    });
  });
});
