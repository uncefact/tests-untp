import { makeBridge } from '../../../../make-bridge.js';
import { dccV070Spec } from './index.js';
import {
  createOrganisation,
  createFacility,
  createProduct,
  createConformityInput,
  createBridgeEntities,
} from '../../../../__fixtures__/entities.js';
import type { CredentialSubject } from '../../../../types.js';

const EMPTY_ARRAYS = { organisations: [], facilities: [], products: [] };

describe('extractDccRefs (v0.7.0)', () => {
  const bridge = makeBridge(dccV070Spec);

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

    it('omits conformity when no conformityAssessment is present', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        issuedToParty: { registeredId: '1234567890' },
      });
      expect(refs.conformity).toBeUndefined();
    });

    it('extracts schemeUrl from referenceScheme.id when no assessments are present', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        referenceScheme: { id: 'https://example.org/scheme' },
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
        conformityAssessment: [{ assessedOrganisation: { registeredId: '9999999999' } }],
      });
      expect(refs.organisations).toEqual([{ id: '9999999999' }]);
    });

    it('uses issuedToParty.registeredId over assessedOrganisation.registeredId when both are present', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        issuedToParty: { registeredId: '1111111111' },
        conformityAssessment: [{ assessedOrganisation: { registeredId: '9999999999' } }],
      });
      expect(refs.organisations).toEqual([{ id: '1111111111' }]);
    });
  });

  // ── product refs ─────────────────────────────────────────────────────────────

  describe('product refs', () => {
    it('extracts products from conformityAssessment[].assessedProduct[].product.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [{ assessedProduct: [{ product: { registeredId: '01234567890123' } }] }],
      });
      expect(refs.products).toEqual([{ id: '01234567890123' }]);
    });

    it('includes batchNumber when present', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [
          { assessedProduct: [{ product: { registeredId: '01234567890123', batchNumber: 'BATCH-001' } }] },
        ],
      });
      expect(refs.products).toEqual([{ id: '01234567890123', batchNumber: 'BATCH-001' }]);
    });

    it('extracts serialNumber from itemNumber (renamed field in v0.7.0)', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [
          { assessedProduct: [{ product: { registeredId: '01234567890123', itemNumber: 'SN-12345' } }] },
        ],
      });
      expect(refs.products).toEqual([{ id: '01234567890123', serialNumber: 'SN-12345' }]);
    });

    it('extracts products from ALL assessments and deduplicates', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [
          { assessedProduct: [{ product: { registeredId: 'PROD-001' } }] },
          { assessedProduct: [{ product: { registeredId: 'PROD-002' } }] },
          { assessedProduct: [{ product: { registeredId: 'PROD-001' } }] },
        ],
      });
      expect(refs.products).toEqual([{ id: 'PROD-001' }, { id: 'PROD-002' }]);
    });
  });

  // ── facility refs ────────────────────────────────────────────────────────────

  describe('facility refs', () => {
    it('extracts facilities from conformityAssessment[].assessedFacility[].facility.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [{ assessedFacility: [{ facility: { registeredId: '9876543210' } }] }],
      });
      expect(refs.facilities).toEqual([{ id: '9876543210' }]);
    });

    it('extracts facilities from ALL assessments and deduplicates', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [
          { assessedFacility: [{ facility: { registeredId: 'FAC-001' } }] },
          { assessedFacility: [{ facility: { registeredId: 'FAC-002' } }] },
          { assessedFacility: [{ facility: { registeredId: 'FAC-001' } }] },
        ],
      });
      expect(refs.facilities).toEqual([{ id: 'FAC-001' }, { id: 'FAC-002' }]);
    });
  });

  // ── conformity refs ──────────────────────────────────────────────────────────

  describe('conformity refs', () => {
    it('extracts schemeUrl from referenceScheme.id (renamed from scope)', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        referenceScheme: { id: 'https://example.org/conformity-scheme' },
        conformityAssessment: [{}],
      });
      expect(refs.conformity?.schemeUrl).toBe('https://example.org/conformity-scheme');
    });

    it('extracts standardUrls from conformityAssessment[].referenceStandard[] (array shape)', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [{ referenceStandard: [{ id: 'https://example.org/standard/1.0' }] }],
      });
      expect(refs.conformity?.standardUrls).toEqual(['https://example.org/standard/1.0']);
    });

    it('extracts regulationUrls from conformityAssessment[].referenceRegulation[] (array shape)', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [{ referenceRegulation: [{ id: 'https://example.org/regulation/1.0' }] }],
      });
      expect(refs.conformity?.regulationUrls).toEqual(['https://example.org/regulation/1.0']);
    });

    it('extracts criteriaUrls from conformityAssessment[].assessmentCriteria[].id', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [
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

    it('deduplicates criteriaUrls across assessments', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [
          { assessmentCriteria: [{ id: 'https://example.org/criteria/1' }] },
          { assessmentCriteria: [{ id: 'https://example.org/criteria/1' }] },
        ],
      });
      expect(refs.conformity?.criteriaUrls).toEqual(['https://example.org/criteria/1']);
    });

    it('aggregates standardUrls across multiple assessments', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [
          { referenceStandard: [{ id: 'https://example.org/std/1' }] },
          { referenceStandard: [{ id: 'https://example.org/std/2' }] },
        ],
      });
      expect(refs.conformity?.standardUrls).toEqual(['https://example.org/std/1', 'https://example.org/std/2']);
    });

    it('omits conformity when assessments have no extractable refs', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [{}],
      });
      expect(refs.conformity).toBeUndefined();
    });

    it('always includes all three url arrays when conformity is present', () => {
      const refs = bridge.extractRefs({
        type: ['ConformityAttestation', 'Attestation'],
        conformityAssessment: [{ referenceStandard: [{ id: 'https://example.org/std/1' }] }],
      });
      expect(refs.conformity?.standardUrls).toBeDefined();
      expect(refs.conformity?.regulationUrls).toBeDefined();
      expect(refs.conformity?.criteriaUrls).toBeDefined();
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

    it('handles multiple conformity inputs in round-trip', () => {
      const entities = createBridgeEntities({
        conformity: [
          createConformityInput({
            scheme: { id: 'https://example.org/scheme-first' },
            standard: { id: 'https://example.org/std/1' },
          }),
          createConformityInput({ standard: { id: 'https://example.org/std/2' } }),
        ],
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.conformity?.schemeUrl).toBe('https://example.org/scheme-first');
      expect(refs.conformity?.standardUrls).toEqual(['https://example.org/std/1', 'https://example.org/std/2']);
    });

    it('round-trips serialNumber via itemNumber field', () => {
      const entities = createBridgeEntities({
        product: createProduct({ serialNumber: 'SN-777', batchNumber: undefined }),
        conformity: [createConformityInput()],
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.products).toEqual([{ id: '9520123456788', serialNumber: 'SN-777' }]);
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
