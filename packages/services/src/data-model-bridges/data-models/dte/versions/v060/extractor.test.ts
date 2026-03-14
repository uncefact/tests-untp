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

    it('returns empty arrays when epcList is absent', () => {
      const refs = bridge.extractRefs({ type: ['Event'] });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });

    it('returns empty arrays when epcList is empty', () => {
      const refs = bridge.extractRefs({ type: ['Event'], epcList: [] });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });

    it('returns empty arrays when first item has no id', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ type: ['Item'], name: 'A product' }],
      });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });
  });

  // ── product refs ─────────────────────────────────────────────────────────────

  describe('product refs', () => {
    it('extracts products[0].id from epcList[0].id', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ type: ['Item'], id: 'did:web:example.com:product:1' }],
      });
      expect(refs.products).toEqual([{ id: 'did:web:example.com:product:1' }]);
    });

    it('extracts only from the first epcList item', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [
          { type: ['Item'], id: 'did:web:example.com:product:1' },
          { type: ['Item'], id: 'did:web:example.com:product:2' },
        ],
      });
      expect(refs.products).toEqual([{ id: 'did:web:example.com:product:1' }]);
    });
  });

  // ── absent fields ─────────────────────────────────────────────────────────────

  describe('absent fields in result', () => {
    it('returns empty organisations array', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ type: ['Item'], id: 'did:web:example.com:product:1' }],
      });
      expect(refs.organisations).toEqual([]);
    });

    it('returns empty facilities array', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ type: ['Item'], id: 'did:web:example.com:product:1' }],
      });
      expect(refs.facilities).toEqual([]);
    });

    it('does not include conformity in refs', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ type: ['Item'], id: 'did:web:example.com:product:1' }],
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

      expect(refs.products).toEqual([{ id: 'did:web:example.com:product:1' }]);
    });

    it('extracts empty refs when product is absent', () => {
      const entities = createBridgeEntities({ product: undefined });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.products).toEqual([]);
    });

    it('has no organisation, facility, or conformity refs after round-trip', () => {
      const entities = createBridgeEntities({
        product: createProduct(),
        conformity: [createConformityInput()],
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.organisations).toEqual([]);
      expect(refs.facilities).toEqual([]);
      expect(refs.conformity).toBeUndefined();
    });
  });
});
