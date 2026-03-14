import { makeBridge } from '../../make-bridge.js';
import { diaV060Spec } from './versions/v060.js';
import { diaV061Spec } from './versions/v061.js';
import { createOrganisation, createConformityInput, createResolvedEntities } from '../../__fixtures__/entities.js';
import type { VersionSpec, CredentialSubject } from '../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', diaV060Spec],
  ['v0.6.1', diaV061Spec],
];

describe.each(versions)('extractDiaRefs (%s)', (_version, spec) => {
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

    it('returns empty object when registeredId is absent', () => {
      const refs = bridge.extractRefs({ type: ['RegisteredIdentity'], id: 'did:web:example.com:org:1' });
      expect(refs).toEqual({});
    });
  });

  // ── organisation refs ────────────────────────────────────────────────────────

  describe('organisation refs', () => {
    it('extracts organisation.id from registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '9520123456788',
      });
      expect(refs.organisation).toEqual({ id: '9520123456788' });
    });
  });

  // ── absent fields ─────────────────────────────────────────────────────────────

  describe('absent fields in result', () => {
    it('does not include facility in refs', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '9520123456788',
      });
      expect(refs.facility).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(refs, 'facility')).toBe(false);
    });

    it('does not include product in refs', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '9520123456788',
      });
      expect(refs.product).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(refs, 'product')).toBe(false);
    });

    it('does not include conformity in refs', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '9520123456788',
      });
      expect(refs.conformity).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(refs, 'conformity')).toBe(false);
    });
  });

  // ── round-trip ───────────────────────────────────────────────────────────────

  describe('round-trip (build → extract)', () => {
    it('extracts organisation ref from a fully built subject', () => {
      const entities = createResolvedEntities({ conformity: [createConformityInput()] });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.organisation).toEqual({ id: '9520123456788' });
    });

    it('extracts empty refs from a subject built with no primaryIdentifier', () => {
      const entities = createResolvedEntities({
        organisation: createOrganisation({ primaryIdentifier: null }),
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.organisation).toBeUndefined();
    });

    it('has no facility, product, or conformity refs after round-trip', () => {
      const entities = createResolvedEntities({ conformity: [createConformityInput()] });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.facility).toBeUndefined();
      expect(refs.product).toBeUndefined();
      expect(refs.conformity).toBeUndefined();
    });
  });
});
