import { makeBridge } from '../../make-bridge.js';
import { dfrV060Spec } from './versions/v060.js';
import { dfrV061Spec } from './versions/v061.js';
import { createFacility, createConformityInput, createResolvedEntities } from '../../__fixtures__/entities.js';
import type { VersionSpec, CredentialSubject } from '../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dfrV060Spec],
  ['v0.6.1', dfrV061Spec],
];

describe.each(versions)('extractDfrRefs (%s)', (_version, spec) => {
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

    it('returns empty object when facility is missing from subject', () => {
      const refs = bridge.extractRefs({ type: ['FacilityRecord'] });
      expect(refs).toEqual({});
    });

    it('returns empty object (no facility ref) when facility has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: { id: 'some-id', name: 'A facility', operatedByParty: {} },
      });
      expect(refs.facility).toBeUndefined();
    });
  });

  // ── facility refs ─────────────────────────────────────────────────────────────

  describe('facility refs', () => {
    it('extracts facility.id from facility.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: { registeredId: '4012345000009' },
      });
      expect(refs.facility).toEqual({ id: '4012345000009' });
    });
  });

  // ── organisation refs ────────────────────────────────────────────────────────

  describe('organisation refs', () => {
    it('extracts organisation.id from facility.operatedByParty.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: {
          registeredId: '4012345000009',
          operatedByParty: { registeredId: '9520123456788' },
        },
      });
      expect(refs.organisation).toEqual({ id: '9520123456788' });
    });

    it('omits organisation when operatedByParty has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['FacilityRecord'],
        facility: {
          registeredId: '4012345000009',
          operatedByParty: { name: 'An org' },
        },
      });
      expect(refs.organisation).toBeUndefined();
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
      const entities = createResolvedEntities({ conformity: [createConformityInput()] });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.facility).toEqual({ id: '4012345000009' });
      expect(refs.organisation).toEqual({ id: '9520123456788' });
      expect(refs.conformity?.standardUrls).toContain('https://example.org/standard/1.0');
      expect(refs.conformity?.regulationUrls).toContain('https://example.org/regulation/1.0');
      expect(refs.conformity?.criteriaUrls).toContain('https://example.org/criteria/1');
      expect(refs.conformity?.criteriaUrls).toContain('https://example.org/criteria/2');
    });

    it('extracts no product ref from a built subject (DFR has no product)', () => {
      const entities = createResolvedEntities();
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.product).toBeUndefined();
    });

    it('extracts empty refs from a minimal built subject', () => {
      const entities = createResolvedEntities({
        facility: createFacility({ primaryIdentifier: null }),
        organisation: undefined,
        conformity: undefined,
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.facility).toBeUndefined();
      expect(refs.organisation).toBeUndefined();
      expect(refs.conformity).toBeUndefined();
    });
  });
});
