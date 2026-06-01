import { makeBridge } from '../../../../make-bridge.js';
import { dppV070Spec } from './index.js';
import {
  createOrganisation,
  createFacility,
  createProduct,
  createConformityInput,
  createBridgeEntities,
} from '../../../../__fixtures__/entities.js';
import type { CredentialSubject } from '../../../../types.js';

const EMPTY_ARRAYS = { organisations: [], facilities: [], products: [] };

describe('extractDppRefs (v0.7.0)', () => {
  const bridge = makeBridge(dppV070Spec);

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

    it('returns empty arrays when subject has no extractable identifiers', () => {
      const refs = bridge.extractRefs({ type: ['Product'] });
      expect(refs).toEqual(EMPTY_ARRAYS);
    });
  });

  // ── product refs ─────────────────────────────────────────────────────────────

  describe('product refs', () => {
    it('extracts products[0].id from the modelNumber field (the primary identifier)', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        modelNumber: '09520123456788',
      });
      expect(refs.products).toEqual([{ id: '09520123456788' }]);
    });

    it('does not emit a product ref when modelNumber is absent (the id URI is not a resolvable identifier)', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
      });
      expect(refs.products).toEqual([]);
    });

    it('includes batchNumber when present', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        modelNumber: '09520123456788',
        batchNumber: 'BATCH-001',
      });
      expect(refs.products).toEqual([{ id: '09520123456788', batchNumber: 'BATCH-001' }]);
    });

    it('extracts serialNumber from itemNumber (v0.7.0 field rename)', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        modelNumber: '09520123456788',
        itemNumber: 'SN-999',
      });
      expect(refs.products).toEqual([{ id: '09520123456788', serialNumber: 'SN-999' }]);
    });

    it('includes both batchNumber and serialNumber when present', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        modelNumber: '09520123456788',
        batchNumber: 'BATCH-001',
        itemNumber: 'SN-999',
      });
      expect(refs.products).toEqual([{ id: '09520123456788', batchNumber: 'BATCH-001', serialNumber: 'SN-999' }]);
    });
  });

  // ── organisation refs ────────────────────────────────────────────────────────

  describe('organisation refs', () => {
    it('extracts organisations from relatedParty[].party.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
        relatedParty: [{ type: ['PartyRole'], role: 'producer', party: { registeredId: '1234567890' } }],
      });
      expect(refs.organisations).toEqual([{ id: '1234567890' }]);
    });

    it('returns empty organisations array when relatedParty is absent', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
      });
      expect(refs.organisations).toEqual([]);
    });

    it('returns empty organisations array when party has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
        relatedParty: [{ role: 'producer', party: { name: 'An org' } }],
      });
      expect(refs.organisations).toEqual([]);
    });
  });

  // ── facility refs ────────────────────────────────────────────────────────────

  describe('facility refs', () => {
    it('extracts facilities[0].id from producedAtFacility.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
        producedAtFacility: { registeredId: '9876543210' },
      });
      expect(refs.facilities).toEqual([{ id: '9876543210' }]);
    });

    it('returns empty facilities array when producedAtFacility has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
        producedAtFacility: { name: 'A facility' },
      });
      expect(refs.facilities).toEqual([]);
    });
  });

  // ── conformity refs ──────────────────────────────────────────────────────────

  describe('conformity refs', () => {
    it('omits conformity when performanceClaim is absent', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
      });
      expect(refs.conformity).toBeUndefined();
    });

    it('extracts standardUrls from performanceClaim[].referenceStandard[].id (array shape)', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
        performanceClaim: [{ referenceStandard: [{ id: 'https://example.org/standard/1.0' }] }],
      });
      expect(refs.conformity?.standardUrls).toEqual(['https://example.org/standard/1.0']);
    });

    it('extracts regulationUrls from performanceClaim[].referenceRegulation[].id (array shape)', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
        performanceClaim: [{ referenceRegulation: [{ id: 'https://example.org/regulation/1.0' }] }],
      });
      expect(refs.conformity?.regulationUrls).toEqual(['https://example.org/regulation/1.0']);
    });

    it('extracts criteriaUrls from performanceClaim[].referenceCriteria[].id', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
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
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
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

    it('always includes all three url arrays when conformity is present', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
        performanceClaim: [{ referenceStandard: [{ id: 'https://example.org/standard/1.0' }] }],
      });
      expect(refs.conformity?.standardUrls).toBeDefined();
      expect(refs.conformity?.regulationUrls).toBeDefined();
      expect(refs.conformity?.criteriaUrls).toBeDefined();
    });

    it('omits conformity when all claims have no extractable urls', () => {
      const refs = bridge.extractRefs({
        type: ['Product'],
        id: 'https://id.gs1.org/01/09520123456788',
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

      expect(refs.products).toEqual([
        {
          id: '9520123456788',
          batchNumber: 'BATCH-001',
        },
      ]);
      expect(refs.organisations).toEqual([{ id: '9520123456788' }]);
      expect(refs.facilities).toEqual([{ id: '4012345000009' }]);
      expect(refs.conformity?.standardUrls).toContain('https://example.org/standard/1.0');
      expect(refs.conformity?.regulationUrls).toContain('https://example.org/regulation/1.0');
      expect(refs.conformity?.criteriaUrls).toContain('https://example.org/criteria/1');
      expect(refs.conformity?.criteriaUrls).toContain('https://example.org/criteria/2');
    });

    it('extracts empty organisation and facility refs from a minimal built subject', () => {
      const entities = createBridgeEntities({
        organisation: createOrganisation({ primaryIdentifier: null }),
        facility: createFacility({ primaryIdentifier: null }),
        conformity: undefined,
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.organisations).toEqual([]);
      expect(refs.facilities).toEqual([]);
      expect(refs.conformity).toBeUndefined();
    });

    it('extracts serialNumber in round-trip via itemNumber mapping', () => {
      const entities = createBridgeEntities({
        product: createProduct({ serialNumber: 'SN-42', batchNumber: undefined }),
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.products[0]).toEqual({
        id: '9520123456788',
        serialNumber: 'SN-42',
      });
    });
  });
});
