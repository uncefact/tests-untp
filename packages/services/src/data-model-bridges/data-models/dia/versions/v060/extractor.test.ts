import { makeBridge } from '../../../../make-bridge.js';
import { diaV060Spec } from './index.js';
import { diaV061Spec } from '../v061/index.js';
import { createOrganisation, createConformityInput, createBridgeEntities } from '../../../../__fixtures__/entities.js';
import type { VersionSpec, CredentialSubject } from '../../../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', diaV060Spec],
  ['v0.6.1', diaV061Spec],
];

const EMPTY_ARRAYS = { organisations: [], facilities: [], products: [] };

describe.each(versions)('extractDiaRefs (%s)', (_version, spec) => {
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

    it('returns empty arrays when registeredId is absent', () => {
      const refs = bridge.extractRefs({ type: ['RegisteredIdentity'], id: 'did:web:example.com:org:1' });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });
  });

  // ── organisation refs ────────────────────────────────────────────────────────

  describe('organisation refs', () => {
    it('extracts organisations[0].id from registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '9520123456788',
      });
      expect(refs.organisations).toEqual([{ id: '9520123456788' }]);
    });
  });

  // ── absent fields ─────────────────────────────────────────────────────────────

  describe('absent fields in result', () => {
    it('returns empty facilities array', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '9520123456788',
      });
      expect(refs.facilities).toEqual([]);
    });

    it('returns empty products array', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '9520123456788',
      });
      expect(refs.products).toEqual([]);
    });

    it('does not include conformity in refs', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '9520123456788',
      });
      expect(refs.conformity).toBeUndefined();
    });
  });

  // ── round-trip ───────────────────────────────────────────────────────────────

  describe('round-trip (build → extract)', () => {
    it('extracts organisation ref from a fully built subject', () => {
      const entities = createBridgeEntities({ conformity: [createConformityInput()] });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.organisations).toEqual([{ id: '9520123456788' }]);
    });

    it('extracts empty refs from a subject built with no primaryIdentifier', () => {
      const entities = createBridgeEntities({
        organisation: createOrganisation({ primaryIdentifier: null }),
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.organisations).toEqual([]);
    });

    it('has no facility, product, or conformity refs after round-trip', () => {
      const entities = createBridgeEntities({ conformity: [createConformityInput()] });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.facilities).toEqual([]);
      expect(refs.products).toEqual([]);
      expect(refs.conformity).toBeUndefined();
    });
  });
});
