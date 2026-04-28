import { makeBridge } from '../../../../make-bridge.js';
import { dfrV070Spec } from './index.js';
import { createFacility, createConformityInput, createBridgeEntities } from '../../../../__fixtures__/entities.js';
import type { CredentialSubject } from '../../../../types.js';

const EMPTY_ARRAYS = { organisations: [], facilities: [], products: [] };

describe('extractDfrRefs (v0.7.0)', () => {
  const bridge = makeBridge(dfrV070Spec);

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

    it('returns empty arrays for a subject with no ids (no wrapper in v0.7.0)', () => {
      const refs = bridge.extractRefs({ type: ['Facility'] });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });
  });

  // ── facility refs ─────────────────────────────────────────────────────────────

  describe('facility refs', () => {
    it('extracts facilities[0].id from top-level registeredId', () => {
      const refs = bridge.extractRefs({ type: ['Facility'], registeredId: '4012345000009' });
      expect(refs.facilities).toEqual([{ id: '4012345000009' }]);
    });

    it('returns empty facilities array when registeredId is absent', () => {
      const refs = bridge.extractRefs({ type: ['Facility'], id: 'did:web:example.com:facility:1' });
      expect(refs.facilities).toEqual([]);
    });
  });

  // ── organisation refs ────────────────────────────────────────────────────────

  describe('organisation refs', () => {
    it('extracts organisations from relatedParty[].party.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['Facility'],
        registeredId: '4012345000009',
        relatedParty: [{ type: ['PartyRole'], role: 'operator', party: { registeredId: '9520123456788' } }],
      });
      expect(refs.organisations).toEqual([{ id: '9520123456788' }]);
    });

    it('returns empty organisations array when relatedParty is absent', () => {
      const refs = bridge.extractRefs({ type: ['Facility'], registeredId: '4012345000009' });
      expect(refs.organisations).toEqual([]);
    });

    it('returns empty organisations array when party has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['Facility'],
        registeredId: '4012345000009',
        relatedParty: [{ role: 'operator', party: { name: 'An org' } }],
      });
      expect(refs.organisations).toEqual([]);
    });
  });

  // ── conformity refs ──────────────────────────────────────────────────────────

  describe('conformity refs', () => {
    it('omits conformity when performanceClaim is absent', () => {
      const refs = bridge.extractRefs({ type: ['Facility'], registeredId: '4012345000009' });
      expect(refs.conformity).toBeUndefined();
    });

    it('omits conformity when performanceClaim is an empty array', () => {
      const refs = bridge.extractRefs({
        type: ['Facility'],
        registeredId: '4012345000009',
        performanceClaim: [],
      });
      expect(refs.conformity).toBeUndefined();
    });

    it('extracts standardUrls from performanceClaim[].referenceStandard[].id (array shape)', () => {
      const refs = bridge.extractRefs({
        type: ['Facility'],
        registeredId: '4012345000009',
        performanceClaim: [{ referenceStandard: [{ id: 'https://example.org/standard/1.0' }] }],
      });
      expect(refs.conformity?.standardUrls).toEqual(['https://example.org/standard/1.0']);
    });

    it('extracts regulationUrls from performanceClaim[].referenceRegulation[].id (array shape)', () => {
      const refs = bridge.extractRefs({
        type: ['Facility'],
        registeredId: '4012345000009',
        performanceClaim: [{ referenceRegulation: [{ id: 'https://example.org/regulation/1.0' }] }],
      });
      expect(refs.conformity?.regulationUrls).toEqual(['https://example.org/regulation/1.0']);
    });

    it('extracts criteriaUrls from performanceClaim[].referenceCriteria[].id', () => {
      const refs = bridge.extractRefs({
        type: ['Facility'],
        registeredId: '4012345000009',
        performanceClaim: [
          {
            referenceCriteria: [{ id: 'https://example.org/criteria/1' }, { id: 'https://example.org/criteria/2' }],
          },
        ],
      });
      expect(refs.conformity?.criteriaUrls).toEqual([
        'https://example.org/criteria/1',
        'https://example.org/criteria/2',
      ]);
    });

    it('aggregates urls across multiple claims', () => {
      const refs = bridge.extractRefs({
        type: ['Facility'],
        registeredId: '4012345000009',
        performanceClaim: [
          { referenceStandard: [{ id: 'https://example.org/standard/1.0' }] },
          { referenceStandard: [{ id: 'https://example.org/standard/2.0' }] },
        ],
      });
      expect(refs.conformity?.standardUrls).toEqual([
        'https://example.org/standard/1.0',
        'https://example.org/standard/2.0',
      ]);
    });

    it('omits conformity when all claims have no extractable urls', () => {
      const refs = bridge.extractRefs({
        type: ['Facility'],
        registeredId: '4012345000009',
        performanceClaim: [{ type: ['Claim', 'Declaration'] }],
      });
      expect(refs.conformity).toBeUndefined();
    });
  });

  // ── round-trip ───────────────────────────────────────────────────────────────

  describe('round-trip (build → extract)', () => {
    it('extracts all refs from a fully built subject', () => {
      const entities = createBridgeEntities({ conformity: [createConformityInput()] });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.facilities).toEqual([{ id: '4012345000009' }]);
      expect(refs.organisations).toEqual([{ id: '9520123456788' }]);
      expect(refs.conformity?.standardUrls).toContain('https://example.org/standard/1.0');
      expect(refs.conformity?.regulationUrls).toContain('https://example.org/regulation/1.0');
      expect(refs.conformity?.criteriaUrls).toContain('https://example.org/criteria/1');
      expect(refs.conformity?.criteriaUrls).toContain('https://example.org/criteria/2');
    });

    it('extracts no product ref from a built subject (DFR has no product)', () => {
      const entities = createBridgeEntities();
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);
      expect(refs.products).toEqual([]);
    });

    it('extracts empty refs from a minimal built subject', () => {
      const entities = createBridgeEntities({
        facility: createFacility({ primaryIdentifier: null }),
        organisation: undefined,
        conformity: undefined,
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.facilities).toEqual([]);
      expect(refs.organisations).toEqual([]);
      expect(refs.conformity).toBeUndefined();
    });
  });
});
