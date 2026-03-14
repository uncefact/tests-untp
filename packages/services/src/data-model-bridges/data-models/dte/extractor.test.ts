import { makeBridge } from '../../make-bridge.js';
import { dteV060Spec } from './versions/v060.js';
import { dteV061Spec } from './versions/v061.js';
import { createProduct, createConformityInput, createResolvedEntities } from '../../__fixtures__/entities.js';
import type { VersionSpec, CredentialSubject } from '../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dteV060Spec],
  ['v0.6.1', dteV061Spec],
];

describe.each(versions)('extractDteRefs (%s)', (_version, spec) => {
  const bridge = makeBridge(spec);

  // ── edge cases ───────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty object for null subject', () => {
      const refs = bridge.extractRefs(null as unknown as CredentialSubject);
      expect(refs).toEqual({});
    });

    it('returns empty object for undefined subject', () => {
      const refs = bridge.extractRefs(undefined as unknown as CredentialSubject);
      expect(refs).toEqual({});
    });

    it('returns empty object when epcList is absent', () => {
      const refs = bridge.extractRefs({ type: ['Event'] });
      expect(refs).toEqual({});
    });

    it('returns empty object when epcList is empty', () => {
      const refs = bridge.extractRefs({ type: ['Event'], epcList: [] });
      expect(refs).toEqual({});
    });

    it('returns empty object when first item has no id', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ type: ['Item'], name: 'A product' }],
      });
      expect(refs).toEqual({});
    });
  });

  // ── product refs ─────────────────────────────────────────────────────────────

  describe('product refs', () => {
    it('extracts product.id from epcList[0].id', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ type: ['Item'], id: 'did:web:example.com:product:1' }],
      });
      expect(refs.product).toEqual({ id: 'did:web:example.com:product:1' });
    });

    it('extracts only from the first epcList item', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [
          { type: ['Item'], id: 'did:web:example.com:product:1' },
          { type: ['Item'], id: 'did:web:example.com:product:2' },
        ],
      });
      expect(refs.product).toEqual({ id: 'did:web:example.com:product:1' });
    });
  });

  // ── absent fields ─────────────────────────────────────────────────────────────

  describe('absent fields in result', () => {
    it('does not include organisation in refs', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ type: ['Item'], id: 'did:web:example.com:product:1' }],
      });
      expect(refs.organisation).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(refs, 'organisation')).toBe(false);
    });

    it('does not include facility in refs', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ type: ['Item'], id: 'did:web:example.com:product:1' }],
      });
      expect(refs.facility).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(refs, 'facility')).toBe(false);
    });

    it('does not include conformity in refs', () => {
      const refs = bridge.extractRefs({
        type: ['Event'],
        epcList: [{ type: ['Item'], id: 'did:web:example.com:product:1' }],
      });
      expect(refs.conformity).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(refs, 'conformity')).toBe(false);
    });
  });

  // ── round-trip ───────────────────────────────────────────────────────────────

  describe('round-trip (build → extract)', () => {
    it('extracts product ref from a fully built subject', () => {
      const entities = createResolvedEntities({ conformity: [createConformityInput()] });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.product).toEqual({ id: 'did:web:example.com:product:1' });
    });

    it('extracts empty refs when product is absent', () => {
      const entities = createResolvedEntities({ product: undefined });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.product).toBeUndefined();
    });

    it('has no organisation, facility, or conformity refs after round-trip', () => {
      const entities = createResolvedEntities({
        product: createProduct(),
        conformity: [createConformityInput()],
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.organisation).toBeUndefined();
      expect(refs.facility).toBeUndefined();
      expect(refs.conformity).toBeUndefined();
    });
  });
});
