import { makeBridge } from '../../make-bridge.js';
import { dppV060Spec } from './versions/v060.js';
import { dppV061Spec } from './versions/v061.js';
import {
  createOrganisation,
  createFacility,
  createProduct,
  createConformityInput,
  createBridgeEntities,
} from '../../__fixtures__/entities.js';
import type { VersionSpec, CredentialSubject } from '../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dppV060Spec],
  ['v0.6.1', dppV061Spec],
];

describe.each(versions)('extractDppRefs (%s)', (_version, spec) => {
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

    it('returns empty object when product is missing from subject', () => {
      const refs = bridge.extractRefs({ type: ['ProductPassport'] });
      expect(refs).toEqual({});
    });

    it('returns empty object when product has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { id: 'some-id', name: 'A product' },
      });
      expect(refs).toEqual({});
    });
  });

  // ── product refs ─────────────────────────────────────────────────────────────

  describe('product refs', () => {
    it('extracts product.id from product.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123' },
      });
      expect(refs.product).toEqual({ id: '01234567890123' });
    });

    it('includes batchNumber when present', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123', batchNumber: 'BATCH-001' },
      });
      expect(refs.product).toEqual({ id: '01234567890123', batchNumber: 'BATCH-001' });
    });

    it('includes serialNumber when present', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123', serialNumber: 'SN-999' },
      });
      expect(refs.product).toEqual({ id: '01234567890123', serialNumber: 'SN-999' });
    });

    it('includes both batchNumber and serialNumber when present', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123', batchNumber: 'BATCH-001', serialNumber: 'SN-999' },
      });
      expect(refs.product).toEqual({ id: '01234567890123', batchNumber: 'BATCH-001', serialNumber: 'SN-999' });
    });

    it('omits batchNumber and serialNumber when absent', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123' },
      });
      expect(refs.product?.batchNumber).toBeUndefined();
      expect(refs.product?.serialNumber).toBeUndefined();
    });
  });

  // ── organisation refs ────────────────────────────────────────────────────────

  describe('organisation refs', () => {
    it('extracts organisation.id from producedByParty.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: {
          registeredId: '01234567890123',
          producedByParty: { registeredId: '1234567890' },
        },
      });
      expect(refs.organisation).toEqual({ id: '1234567890' });
    });

    it('omits organisation when producedByParty has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: {
          registeredId: '01234567890123',
          producedByParty: { name: 'An org' },
        },
      });
      expect(refs.organisation).toBeUndefined();
    });
  });

  // ── facility refs ────────────────────────────────────────────────────────────

  describe('facility refs', () => {
    it('extracts facility.id from producedAtFacility.registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: {
          registeredId: '01234567890123',
          producedAtFacility: { registeredId: '9876543210' },
        },
      });
      expect(refs.facility).toEqual({ id: '9876543210' });
    });

    it('omits facility when producedAtFacility has no registeredId', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: {
          registeredId: '01234567890123',
          producedAtFacility: { name: 'A facility' },
        },
      });
      expect(refs.facility).toBeUndefined();
    });
  });

  // ── conformity refs ──────────────────────────────────────────────────────────

  describe('conformity refs', () => {
    it('omits conformity when conformityClaim is absent', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123' },
      });
      expect(refs.conformity).toBeUndefined();
    });

    it('omits conformity when conformityClaim is an empty array', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123' },
        conformityClaim: [],
      });
      expect(refs.conformity).toBeUndefined();
    });

    it('extracts standardUrls from referenceStandard.id', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123' },
        conformityClaim: [{ referenceStandard: { id: 'https://example.org/standard/1.0' } }],
      });
      expect(refs.conformity?.standardUrls).toEqual(['https://example.org/standard/1.0']);
    });

    it('extracts regulationUrls from referenceRegulation.id', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123' },
        conformityClaim: [{ referenceRegulation: { id: 'https://example.org/regulation/1.0' } }],
      });
      expect(refs.conformity?.regulationUrls).toEqual(['https://example.org/regulation/1.0']);
    });

    it('extracts criteriaUrls from assessmentCriteria[].id', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123' },
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
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123' },
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

    it('always includes all three url arrays when conformity is present', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123' },
        conformityClaim: [{ referenceStandard: { id: 'https://example.org/standard/1.0' } }],
      });
      expect(refs.conformity?.standardUrls).toBeDefined();
      expect(refs.conformity?.regulationUrls).toBeDefined();
      expect(refs.conformity?.criteriaUrls).toBeDefined();
    });

    it('omits conformity when all claims have no extractable urls', () => {
      const refs = bridge.extractRefs({
        type: ['ProductPassport'],
        product: { registeredId: '01234567890123' },
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

      expect(refs.product).toEqual({
        id: '9520123456788',
        batchNumber: 'BATCH-001',
      });
      expect(refs.organisation).toEqual({ id: '9520123456788' });
      expect(refs.facility).toEqual({ id: '4012345000009' });
      expect(refs.conformity?.standardUrls).toContain('https://example.org/standard/1.0');
      expect(refs.conformity?.regulationUrls).toContain('https://example.org/regulation/1.0');
      expect(refs.conformity?.criteriaUrls).toContain('https://example.org/criteria/1');
      expect(refs.conformity?.criteriaUrls).toContain('https://example.org/criteria/2');
    });

    it('extracts empty refs from a minimal built subject', () => {
      const entities = createBridgeEntities({
        product: createProduct({ primaryIdentifier: null }),
        organisation: undefined,
        facility: undefined,
        conformity: undefined,
      });
      const subject = bridge.buildSubject(entities);
      const refs = bridge.extractRefs(subject);

      expect(refs.product).toBeUndefined();
      expect(refs.organisation).toBeUndefined();
      expect(refs.facility).toBeUndefined();
      expect(refs.conformity).toBeUndefined();
    });
  });
});
