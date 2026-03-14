import { makeBridge } from '../../../../make-bridge.js';
import { diaV060Spec } from './index.js';
import { diaV061Spec } from '../v061/index.js';
import {
  createOrganisation,
  createFacility,
  createProduct,
  createConformityInput,
  createBridgeEntities,
} from '../../../../__fixtures__/entities.js';
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

  // ── registerType routing ───────────────────────────────────────────────────

  describe('registerType routing', () => {
    it('places ref in organisations when registerType is Business', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '9520123456788',
        registerType: 'Business',
      });
      expect(refs.organisations).toEqual([{ id: '9520123456788' }]);
      expect(refs.facilities).toEqual([]);
      expect(refs.products).toEqual([]);
    });

    it('places ref in facilities when registerType is Facility', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '4012345000009',
        registerType: 'Facility',
      });
      expect(refs.organisations).toEqual([]);
      expect(refs.facilities).toEqual([{ id: '4012345000009' }]);
      expect(refs.products).toEqual([]);
    });

    it('places ref in products when registerType is Product', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '9520123456788',
        registerType: 'Product',
      });
      expect(refs.organisations).toEqual([]);
      expect(refs.facilities).toEqual([]);
      expect(refs.products).toEqual([{ id: '9520123456788' }]);
    });

    it('places ref in facilities when registerType is Land', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: 'LAND-001',
        registerType: 'Land',
      });
      expect(refs.organisations).toEqual([]);
      expect(refs.facilities).toEqual([{ id: 'LAND-001' }]);
      expect(refs.products).toEqual([]);
    });

    it('returns empty arrays when registerType is absent', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: '9520123456788',
      });
      expect(refs.organisations).toEqual([]);
      expect(refs.facilities).toEqual([]);
      expect(refs.products).toEqual([]);
    });

    it('returns empty arrays when registerType is Trademark', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: 'TM-12345',
        registerType: 'Trademark',
      });
      expect(refs.organisations).toEqual([]);
      expect(refs.facilities).toEqual([]);
      expect(refs.products).toEqual([]);
    });

    it('returns empty arrays when registerType is Accreditation', () => {
      const refs = bridge.extractRefs({
        type: ['RegisteredIdentity'],
        registeredId: 'ACC-001',
        registerType: 'Accreditation',
      });
      expect(refs.organisations).toEqual([]);
      expect(refs.facilities).toEqual([]);
      expect(refs.products).toEqual([]);
    });
  });

  // ── absent fields ─────────────────────────────────────────────────────────────

  describe('absent fields in result', () => {
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
    it('extracts organisation ref from a subject built with organisation', () => {
      const entities = createBridgeEntities({ conformity: [createConformityInput()] });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      // Builder sets registerType to 'Business' when built from organisation
      expect(refs.organisations).toEqual([{ id: '9520123456788' }]);
    });

    it('extracts ref from a subject built with facility only', () => {
      const entities = createBridgeEntities({
        organisation: undefined,
        facility: createFacility(),
        product: undefined,
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.facilities).toEqual([{ id: '4012345000009' }]);
      expect(refs.organisations).toEqual([]);
    });

    it('extracts ref from a subject built with product only', () => {
      const entities = createBridgeEntities({
        organisation: undefined,
        facility: undefined,
        product: createProduct(),
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.products).toEqual([{ id: '9520123456788' }]);
      expect(refs.organisations).toEqual([]);
    });

    it('extracts empty refs from a subject built with no primaryIdentifier', () => {
      const entities = createBridgeEntities({
        organisation: createOrganisation({ primaryIdentifier: null }),
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.organisations).toEqual([]);
    });

    it('has no conformity refs after round-trip', () => {
      const entities = createBridgeEntities({ conformity: [createConformityInput()] });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.conformity).toBeUndefined();
    });
  });
});
