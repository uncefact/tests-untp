import { makeBridge } from '../../../../make-bridge.js';
import { dccV070Spec } from './index.js';
import {
  createOrganisation,
  createProduct,
  createConformityInput,
  createBridgeEntities,
} from '../../../../__fixtures__/entities.js';

describe('buildDccSubject (v0.7.0)', () => {
  const bridge = makeBridge(dccV070Spec);

  // ── credentialSubject root structure ─────────────────────────────────────────

  describe('credentialSubject root', () => {
    it('sets type to ConformityAttestation and Attestation', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.type).toEqual(['ConformityAttestation', 'Attestation']);
    });

    it('includes issuedToParty field', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.issuedToParty).toBeDefined();
    });

    it('does not emit legacy scope key', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      expect(subject.scope).toBeUndefined();
    });

    it('does not emit legacy assessment key', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      expect(subject.assessment).toBeUndefined();
    });

    it('omits conformityAssessment when conformity is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: undefined }));
      expect(subject.conformityAssessment).toBeUndefined();
    });

    it('omits conformityAssessment when conformity is an empty array', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [] }));
      expect(subject.conformityAssessment).toBeUndefined();
    });

    it('omits referenceScheme when conformity is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: undefined }));
      expect(subject.referenceScheme).toBeUndefined();
    });

    it('omits referenceScheme when first conformity input has no scheme', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ conformity: [createConformityInput({ scheme: undefined })] }),
      );
      expect(subject.referenceScheme).toBeUndefined();
    });
  });

  // ── issuedToParty ─────────────────────────────────────────────────────────────

  describe('issuedToParty', () => {
    it('maps organisation to issuedToParty with all fields', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const party = subject.issuedToParty as Record<string, unknown>;

      expect(party).toEqual({
        id: 'did:web:example.com:org:1',
        name: 'Test Organisation',
        description: 'A test organisation for unit tests',
        registeredId: '9520123456788',
        idScheme: {
          type: ['IdentifierScheme'],
          id: 'https://id.gs1.org/01/',
          name: 'Global Trade Item Number (GTIN)',
        },
      });
    });

    it('omits registeredId and idScheme when organisation has no primaryIdentifier', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: createOrganisation({ primaryIdentifier: null }) }),
      );
      const party = subject.issuedToParty as Record<string, unknown>;
      expect(party.registeredId).toBeUndefined();
      expect(party.idScheme).toBeUndefined();
    });

    it('handles missing organisation gracefully', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ organisation: undefined }));
      const party = subject.issuedToParty as Record<string, unknown>;
      expect(party.id).toBeUndefined();
      expect(party.name).toBeUndefined();
    });
  });

  // ── referenceScheme (replaces scope) ────────────────────────────────────────

  describe('referenceScheme', () => {
    it('sets referenceScheme type to ConformityScheme', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const scheme = subject.referenceScheme as Record<string, unknown>;
      expect(scheme.type).toEqual(['ConformityScheme']);
    });

    it('builds referenceScheme from first conformity input scheme', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({
              scheme: { id: 'https://example.org/conformity-scheme', name: 'Test Conformity Scheme' },
            }),
          ],
        }),
      );
      const scheme = subject.referenceScheme as Record<string, unknown>;

      expect(scheme).toEqual({
        type: ['ConformityScheme'],
        id: 'https://example.org/conformity-scheme',
        name: 'Test Conformity Scheme',
      });
    });

    it('uses first conformity input scheme when multiple inputs are present', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({ scheme: { id: 'https://example.org/scheme-first' } }),
            createConformityInput({ scheme: { id: 'https://example.org/scheme-second' } }),
          ],
        }),
      );
      const scheme = subject.referenceScheme as Record<string, unknown>;
      expect(scheme.id).toBe('https://example.org/scheme-first');
    });

    it('omits name from referenceScheme when scheme has no name', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [createConformityInput({ scheme: { id: 'https://example.org/scheme' } })],
        }),
      );
      const scheme = subject.referenceScheme as Record<string, unknown>;
      expect(scheme.name).toBeUndefined();
    });
  });

  // ── conformityAssessment array (renamed from assessment) ───────────────────

  describe('conformityAssessment', () => {
    it('builds one conformityAssessment per conformity input', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ conformity: [createConformityInput(), createConformityInput()] }),
      );
      const assessments = subject.conformityAssessment as unknown[];
      expect(assessments).toHaveLength(2);
    });

    it('sets assessment type to ConformityAssessment and Declaration', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const assessment = (subject.conformityAssessment as Record<string, unknown>[])[0];
      expect(assessment.type).toEqual(['ConformityAssessment', 'Declaration']);
    });

    it('builds referenceStandard as an array (v0.7.0 shape)', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({
              standard: { id: 'https://example.org/standard/1.0', name: 'Test Standard 1.0' },
            }),
          ],
        }),
      );
      const assessment = (subject.conformityAssessment as Record<string, unknown>[])[0];
      expect(assessment.referenceStandard).toEqual([
        {
          type: ['Standard'],
          id: 'https://example.org/standard/1.0',
          name: 'Test Standard 1.0',
        },
      ]);
    });

    it('builds referenceRegulation as an array (v0.7.0 shape)', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({
              regulation: { id: 'https://example.org/regulation/1.0', name: 'Test Regulation 1.0' },
            }),
          ],
        }),
      );
      const assessment = (subject.conformityAssessment as Record<string, unknown>[])[0];
      expect(assessment.referenceRegulation).toEqual([
        {
          type: ['Regulation'],
          id: 'https://example.org/regulation/1.0',
          name: 'Test Regulation 1.0',
        },
      ]);
    });

    it('builds assessmentCriteria from criteria input', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({
              criteria: [
                { id: 'https://example.org/criteria/1', name: 'Criterion 1', conformityTopic: 'environment.emissions' },
              ],
            }),
          ],
        }),
      );
      const assessment = (subject.conformityAssessment as Record<string, unknown>[])[0];
      expect(assessment.assessmentCriteria).toEqual([
        {
          type: ['Criterion'],
          id: 'https://example.org/criteria/1',
          name: 'Criterion 1',
          conformityTopic: 'environment.emissions',
        },
      ]);
    });

    it('filters out criteria with empty-string id', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({
              criteria: [
                { id: '', name: 'Empty ID Criterion' },
                { id: 'https://example.org/criteria/1', name: 'Valid Criterion' },
              ],
            }),
          ],
        }),
      );
      const assessment = (subject.conformityAssessment as Record<string, unknown>[])[0];
      const criteria = assessment.assessmentCriteria as Record<string, unknown>[];
      expect(criteria).toHaveLength(1);
      expect(criteria[0].id).toBe('https://example.org/criteria/1');
    });

    it('each assessment includes assessedProduct with Product using itemNumber (renamed field)', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          product: createProduct({ batchNumber: 'BATCH-001', serialNumber: 'SN-999' }),
          conformity: [createConformityInput()],
        }),
      );
      const assessment = (subject.conformityAssessment as Record<string, unknown>[])[0];
      const assessedProduct = assessment.assessedProduct as Record<string, unknown>[];

      expect(assessedProduct).toHaveLength(1);
      const product = assessedProduct[0].product as Record<string, unknown>;
      expect(product.type).toEqual(['Product']);
      expect(product.registeredId).toBe('9520123456788');
      expect(product.batchNumber).toBe('BATCH-001');
      expect(product.itemNumber).toBe('SN-999');
      expect(product.serialNumber).toBeUndefined();
    });

    it('each assessment includes assessedFacility when facility is provided', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const assessment = (subject.conformityAssessment as Record<string, unknown>[])[0];
      const assessedFacility = assessment.assessedFacility as Record<string, unknown>[];

      expect(assessedFacility).toHaveLength(1);
      expect(assessedFacility[0]).toMatchObject({
        type: ['FacilityVerification'],
        facility: { type: ['Facility'], registeredId: '4012345000009' },
      });
    });

    it('each assessment includes assessedOrganisation when organisation is provided', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const assessment = (subject.conformityAssessment as Record<string, unknown>[])[0];
      const assessedOrg = assessment.assessedOrganisation as Record<string, unknown>;
      expect(assessedOrg).toMatchObject({ registeredId: '9520123456788', name: 'Test Organisation' });
    });

    it('omits assessedProduct when product is not provided', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: undefined, conformity: [createConformityInput()] }),
      );
      const assessment = (subject.conformityAssessment as Record<string, unknown>[])[0];
      expect(assessment.assessedProduct).toBeUndefined();
    });

    it('builds multiple assessments from multiple conformity inputs', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({ standard: { id: 'https://example.org/std/1' } }),
            createConformityInput({ standard: { id: 'https://example.org/std/2' } }),
          ],
        }),
      );
      const assessments = subject.conformityAssessment as Record<string, unknown>[];
      expect(assessments).toHaveLength(2);
      const firstStd = (assessments[0].referenceStandard as Record<string, unknown>[])[0];
      const secondStd = (assessments[1].referenceStandard as Record<string, unknown>[])[0];
      expect(firstStd.id).toBe('https://example.org/std/1');
      expect(secondStd.id).toBe('https://example.org/std/2');
    });
  });
});
