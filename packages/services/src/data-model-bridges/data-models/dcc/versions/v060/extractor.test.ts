import { makeBridge } from '../../../../make-bridge.js';
import { dccV060Spec } from './index.js';
import { dccV061Spec } from '../v061/index.js';
import {
  createOrganisation,
  createFacility,
  createProduct,
  createConformityInput,
  createBridgeEntities,
} from '../../../../__fixtures__/entities.js';
import type { VersionSpec, CredentialSubject } from '../../../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dccV060Spec],
  ['v0.6.1', dccV061Spec],
];

const EMPTY_ARRAYS = { organisations: [], facilities: [], products: [] };

describe.each(versions)('extractDccRefs (%s)', (_version, spec) => {
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

    it('returns empty arrays for minimal subject with no extractable refs', () => {
      const refs = bridge.extractRefs({ type: ['ConformityAttestation', 'Attestation'] });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });

    it('omits conformity when no assessments are present', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        issuedToParty: { registeredId: '1234567890' },
      });
      expect(refs.conformity).toBeUndefined();
    });

    it('extracts schemeUrl from scope.id when no assessments are present', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        scope: { id: 'https://example.org/scheme' },
      });
      expect(refs.conformity).toEqual({
        schemeUrl: 'https://example.org/scheme',
        standardUrls: [],
        regulationUrls: [],
        criteriaUrls: [],
      });
    });
  });

  // ── organisation refs ────────────────────────────────────────────────────────

  describe('organisation refs', () => {
    it('extracts organisations[0].id from issuedToParty.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        issuedToParty: { registeredId: '1234567890' },
      });
      expect(refs.organisations).toEqual([{ id: '1234567890' }]);
    });

    it('falls back to assessedOrganisation.registeredId when issuedToParty has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        issuedToParty: { name: 'Some org' },
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedOrganisation: { registeredId: '9999999999' },
          },
        ],
      });
      expect(refs.organisations).toEqual([{ id: '9999999999' }]);
    });

    it('uses issuedToParty.registeredId over assessedOrganisation.registeredId when both are present', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        issuedToParty: { registeredId: '1111111111' },
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedOrganisation: { registeredId: '9999999999' },
          },
        ],
      });
      expect(refs.organisations).toEqual([{ id: '1111111111' }]);
    });

    it('returns empty organisations array when neither issuedToParty nor assessedOrganisation has registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        issuedToParty: { name: 'Some org' },
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
          },
        ],
      });
      expect(refs.organisations).toEqual([]);
    });
  });

  // ── product refs ─────────────────────────────────────────────────────────────

  describe('product refs', () => {
    it('extracts products[0].id from assessment[0].assessedProduct[0].product.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedProduct: [{ type: ['ProductVerification'], product: { registeredId: '01234567890123' } }],
          },
        ],
      });
      expect(refs.products).toEqual([{ id: '01234567890123' }]);
    });

    it('includes batchNumber when present', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedProduct: [{ product: { registeredId: '01234567890123', batchNumber: 'BATCH-001' } }],
          },
        ],
      });
      expect(refs.products).toEqual([{ id: '01234567890123', batchNumber: 'BATCH-001' }]);
    });

    it('includes serialNumber when present', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedProduct: [{ product: { registeredId: '01234567890123', serialNumber: 'SN-12345' } }],
          },
        ],
      });
      expect(refs.products).toEqual([{ id: '01234567890123', serialNumber: 'SN-12345' }]);
    });

    it('returns empty products array when assessedProduct has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedProduct: [{ product: { id: 'some-id', name: 'A product' } }],
          },
        ],
      });
      expect(refs.products).toEqual([]);
    });

    it('extracts products from ALL assessments', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedProduct: [{ product: { registeredId: 'PROD-001' } }],
          },
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedProduct: [{ product: { registeredId: 'PROD-002' } }],
          },
        ],
      });
      expect(refs.products).toEqual([{ id: 'PROD-001' }, { id: 'PROD-002' }]);
    });

    it('deduplicates products across assessments', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedProduct: [{ product: { registeredId: 'PROD-001' } }],
          },
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedProduct: [{ product: { registeredId: 'PROD-001' } }],
          },
        ],
      });
      expect(refs.products).toEqual([{ id: 'PROD-001' }]);
    });
  });

  // ── facility refs ────────────────────────────────────────────────────────────

  describe('facility refs', () => {
    it('extracts facilities[0].id from assessment[0].assessedFacility[0].facility.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedFacility: [{ type: ['FacilityVerification'], facility: { registeredId: '9876543210' } }],
          },
        ],
      });
      expect(refs.facilities).toEqual([{ id: '9876543210' }]);
    });

    it('returns empty facilities array when assessedFacility has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedFacility: [{ facility: { name: 'A facility' } }],
          },
        ],
      });
      expect(refs.facilities).toEqual([]);
    });

    it('extracts facilities from ALL assessments', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedFacility: [{ facility: { registeredId: 'FAC-001' } }],
          },
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedFacility: [{ facility: { registeredId: 'FAC-002' } }],
          },
        ],
      });
      expect(refs.facilities).toEqual([{ id: 'FAC-001' }, { id: 'FAC-002' }]);
    });

    it('deduplicates facilities across assessments', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedFacility: [{ facility: { registeredId: 'FAC-001' } }],
          },
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessedFacility: [{ facility: { registeredId: 'FAC-001' } }],
          },
        ],
      });
      expect(refs.facilities).toEqual([{ id: 'FAC-001' }]);
    });
  });

  // ── conformity refs ──────────────────────────────────────────────────────────

  describe('conformity refs', () => {
    it('extracts schemeUrl from scope.id', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        scope: { id: 'https://example.org/conformity-scheme' },
        assessment: [{ type: ['ConformityAssessment', 'Declaration'] }],
      });
      expect(refs.conformity?.schemeUrl).toBe('https://example.org/conformity-scheme');
    });

    it('extracts standardUrls from assessment[].referenceStandard.id', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            referenceStandard: { id: 'https://example.org/standard/1.0' },
          },
        ],
      });
      expect(refs.conformity?.standardUrls).toEqual(['https://example.org/standard/1.0']);
    });

    it('extracts regulationUrls from assessment[].referenceRegulation.id', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            referenceRegulation: { id: 'https://example.org/regulation/1.0' },
          },
        ],
      });
      expect(refs.conformity?.regulationUrls).toEqual(['https://example.org/regulation/1.0']);
    });

    it('extracts criteriaUrls from assessment[].assessmentCriteria[].id', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessmentCriteria: [{ id: 'https://example.org/criteria/1' }, { id: 'https://example.org/criteria/2' }],
          },
        ],
      });
      expect(refs.conformity?.criteriaUrls).toEqual([
        'https://example.org/criteria/1',
        'https://example.org/criteria/2',
      ]);
    });

    it('flattens criteriaUrls across multiple assessments', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessmentCriteria: [{ id: 'https://example.org/criteria/1' }],
          },
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessmentCriteria: [{ id: 'https://example.org/criteria/3' }],
          },
        ],
      });
      expect(refs.conformity?.criteriaUrls).toEqual([
        'https://example.org/criteria/1',
        'https://example.org/criteria/3',
      ]);
    });

    it('deduplicates criteriaUrls across assessments', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessmentCriteria: [{ id: 'https://example.org/criteria/1' }],
          },
          {
            type: ['ConformityAssessment', 'Declaration'],
            assessmentCriteria: [{ id: 'https://example.org/criteria/1' }],
          },
        ],
      });
      expect(refs.conformity?.criteriaUrls).toEqual(['https://example.org/criteria/1']);
    });

    it('aggregates standardUrls across multiple assessments', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            referenceStandard: { id: 'https://example.org/std/1' },
          },
          {
            type: ['ConformityAssessment', 'Declaration'],
            referenceStandard: { id: 'https://example.org/std/2' },
          },
        ],
      });
      expect(refs.conformity?.standardUrls).toEqual(['https://example.org/std/1', 'https://example.org/std/2']);
    });

    it('omits conformity when assessments have no extractable refs', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [{ type: ['ConformityAssessment', 'Declaration'] }],
      });
      expect(refs.conformity).toBeUndefined();
    });

    it('always includes all three url arrays when conformity is present', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            referenceStandard: { id: 'https://example.org/std/1' },
          },
        ],
      });
      expect(refs.conformity?.standardUrls).toBeDefined();
      expect(refs.conformity?.regulationUrls).toBeDefined();
      expect(refs.conformity?.criteriaUrls).toBeDefined();
    });

    it('omits schemeUrl when scope is absent', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        assessment: [
          {
            type: ['ConformityAssessment', 'Declaration'],
            referenceStandard: { id: 'https://example.org/std/1' },
          },
        ],
      });
      expect(refs.conformity?.schemeUrl).toBeUndefined();
    });
  });

  // ── round-trip (build → extract) ─────────────────────────────────────────────

  describe('round-trip (build → extract)', () => {
    it('extracts all refs from a fully built subject', () => {
      const entities = createBridgeEntities({ conformity: [createConformityInput()] });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.organisations).toEqual([{ id: '9520123456788' }]);
      expect(refs.products).toEqual([{ id: '9520123456788', batchNumber: 'BATCH-001' }]);
      expect(refs.facilities).toEqual([{ id: '4012345000009' }]);
      expect(refs.conformity?.schemeUrl).toBe('https://example.org/conformity-scheme');
      expect(refs.conformity?.standardUrls).toContain('https://example.org/standard/1.0');
      expect(refs.conformity?.regulationUrls).toContain('https://example.org/regulation/1.0');
      expect(refs.conformity?.criteriaUrls).toContain('https://example.org/criteria/1');
      expect(refs.conformity?.criteriaUrls).toContain('https://example.org/criteria/2');
    });

    it('extracts schemeUrl and criteriaUrls correctly in round-trip', () => {
      const entities = createBridgeEntities({
        conformity: [
          createConformityInput({
            scheme: { id: 'https://example.org/scheme-A' },
            criteria: [
              { id: 'https://example.org/criteria/A', name: 'Criterion A' },
              { id: 'https://example.org/criteria/B', name: 'Criterion B' },
            ],
          }),
        ],
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.conformity?.schemeUrl).toBe('https://example.org/scheme-A');
      expect(refs.conformity?.criteriaUrls).toEqual([
        'https://example.org/criteria/A',
        'https://example.org/criteria/B',
      ]);
    });

    it('handles multiple conformity inputs in round-trip', () => {
      const entities = createBridgeEntities({
        conformity: [
          createConformityInput({
            scheme: { id: 'https://example.org/scheme-first' },
            standard: { id: 'https://example.org/std/1' },
          }),
          createConformityInput({
            standard: { id: 'https://example.org/std/2' },
          }),
        ],
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      // scope comes from first conformity input
      expect(refs.conformity?.schemeUrl).toBe('https://example.org/scheme-first');
      // standardUrls from all assessments
      expect(refs.conformity?.standardUrls).toEqual(['https://example.org/std/1', 'https://example.org/std/2']);
    });

    it('extracts empty refs from a minimal built subject with no conformity', () => {
      const entities = createBridgeEntities({
        organisation: createOrganisation({ primaryIdentifier: null }),
        facility: createFacility({ primaryIdentifier: null }),
        product: createProduct({ primaryIdentifier: null }),
        conformity: undefined,
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.organisations).toEqual([]);
      expect(refs.products).toEqual([]);
      expect(refs.facilities).toEqual([]);
      expect(refs.conformity).toBeUndefined();
    });
  });
});
