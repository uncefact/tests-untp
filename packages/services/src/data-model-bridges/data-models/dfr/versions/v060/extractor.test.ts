import { makeBridge } from '../../../../make-bridge.js';
import { dfrV060Spec } from './index.js';
import { dfrV061Spec } from '../v061/index.js';
import { createFacility, createConformityInput, createBridgeEntities } from '../../../../__fixtures__/entities.js';
import type { VersionSpec, CredentialSubject } from '../../../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dfrV060Spec],
  ['v0.6.1', dfrV061Spec],
];

const EMPTY_ARRAYS = { organisations: [], facilities: [], products: [] };

describe.each(versions)('extractDfrRefs (%s)', (_version, spec) => {
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

    it('returns empty arrays when facility is missing from subject', () => {
      const refs = bridge.extractRefs({ type: ['FacilityRecord'] });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });

    it('returns empty arrays (no facility ref) when facility has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: { id: 'some-id', name: 'A facility', operatedByParty: {} },
      });
      expect(refs.facilities).toEqual([]);
    });
  });

  // ── facility refs ─────────────────────────────────────────────────────────────

  describe('facility refs', () => {
    it('extracts facilities[0].id from facility.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: { registeredId: '4012345000009' },
      });
      expect(refs.facilities).toEqual([{ id: '4012345000009' }]);
    });
  });

  // ── organisation refs ────────────────────────────────────────────────────────

  describe('organisation refs', () => {
    it('extracts organisations[0].id from facility.operatedByParty.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: {
          registeredId: '4012345000009',
          operatedByParty: { registeredId: '9520123456788' },
        },
      });
      expect(refs.organisations).toEqual([{ id: '9520123456788' }]);
    });

    it('returns empty organisations array when operatedByParty has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: {
          registeredId: '4012345000009',
          operatedByParty: { name: 'An org' },
        },
      });
      expect(refs.organisations).toEqual([]);
    });
  });

  // ── conformity refs ──────────────────────────────────────────────────────────

  describe('conformity refs', () => {
    it('omits conformity when conformityClaim is absent', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: { registeredId: '4012345000009' },
      });
      expect(refs.conformity).toBeUndefined();
    });

    it('omits conformity when conformityClaim is an empty array', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: { registeredId: '4012345000009' },
        conformityClaim: [],
      });
      expect(refs.conformity).toBeUndefined();
    });

    it('extracts standardUrls from referenceStandard.id', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: { registeredId: '4012345000009' },
        conformityClaim: [{ referenceStandard: { id: 'https://example.org/standard/1.0' } }],
      });
      expect(refs.conformity?.standardUrls).toEqual(['https://example.org/standard/1.0']);
    });

    it('extracts regulationUrls from referenceRegulation.id', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: { registeredId: '4012345000009' },
        conformityClaim: [{ referenceRegulation: { id: 'https://example.org/regulation/1.0' } }],
      });
      expect(refs.conformity?.regulationUrls).toEqual(['https://example.org/regulation/1.0']);
    });

    it('extracts criteriaUrls from assessmentCriteria[].id', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: { registeredId: '4012345000009' },
        conformityClaim: [
          {
            assessmentCriteria: [{ id: 'https://example.org/criteria/1' }, { id: 'https://example.org/criteria/2' }],
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
        type: ['FacilityRecord'],
        facility: { registeredId: '4012345000009' },
        conformityClaim: [
          { referenceStandard: { id: 'https://example.org/standard/1.0' } },
          { referenceStandard: { id: 'https://example.org/standard/2.0' } },
        ],
      });
      expect(refs.conformity?.standardUrls).toEqual([
        'https://example.org/standard/1.0',
        'https://example.org/standard/2.0',
      ]);
    });

    it('omits conformity when all claims have no extractable urls', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: { registeredId: '4012345000009' },
        conformityClaim: [{ type: ['Claim', 'Declaration'] }],
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
