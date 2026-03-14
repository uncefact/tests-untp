import { makeBridge } from '../../make-bridge.js';
import { dccV060Spec } from './versions/v060.js';
import { dccV061Spec } from './versions/v061.js';
import {
  createOrganisation,
  createFacility,
  createProduct,
  createConformityInput,
  createBridgeEntities,
} from '../../__fixtures__/entities.js';
import type { VersionSpec } from '../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dccV060Spec],
  ['v0.6.1', dccV061Spec],
];

describe.each(versions)('buildDccSubject (%s)', (_version, spec) => {
  const bridge = makeBridge(spec);

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

    it('omits assessment when conformity is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: undefined }));
      expect(subject.assessment).toBeUndefined();
    });

    it('omits assessment when conformity is an empty array', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [] }));
      expect(subject.assessment).toBeUndefined();
    });

    it('omits scope when conformity is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: undefined }));
      expect(subject.scope).toBeUndefined();
    });

    it('omits scope when first conformity input has no scheme', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ conformity: [createConformityInput({ scheme: undefined })] }),
      );
      expect(subject.scope).toBeUndefined();
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

    it('omits description when organisation has none', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: createOrganisation({ description: undefined }) }),
      );
      const party = subject.issuedToParty as Record<string, unknown>;
      expect(party.description).toBeUndefined();
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

  // ── scope ─────────────────────────────────────────────────────────────────────

  describe('scope', () => {
    it('builds scope from first conformity input scheme', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({
              scheme: { id: 'https://example.org/conformity-scheme', name: 'Test Conformity Scheme' },
            }),
          ],
        }),
      );
      const scope = subject.scope as Record<string, unknown>;

      expect(scope).toEqual({
        type: ['ConformityAssessmentScheme', 'Standard'],
        id: 'https://example.org/conformity-scheme',
        name: 'Test Conformity Scheme',
      });
    });

    it('sets scope from first conformity input only when multiple inputs are present', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({
              scheme: { id: 'https://example.org/scheme-first' },
            }),
            createConformityInput({
              scheme: { id: 'https://example.org/scheme-second' },
            }),
          ],
        }),
      );
      const scope = subject.scope as Record<string, unknown>;
      expect(scope.id).toBe('https://example.org/scheme-first');
    });

    it('omits name from scope when scheme has no name', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [createConformityInput({ scheme: { id: 'https://example.org/scheme' } })],
        }),
      );
      const scope = subject.scope as Record<string, unknown>;
      expect(scope.name).toBeUndefined();
    });

    it('sets scope type to ConformityAssessmentScheme and Standard', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const scope = subject.scope as Record<string, unknown>;
      expect(scope.type).toEqual(['ConformityAssessmentScheme', 'Standard']);
    });
  });

  // ── assessment array ──────────────────────────────────────────────────────────

  describe('assessment', () => {
    it('builds one assessment per conformity input', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [createConformityInput(), createConformityInput()],
        }),
      );
      const assessments = subject.assessment as unknown[];
      expect(assessments).toHaveLength(2);
    });

    it('sets assessment type to ConformityAssessment and Declaration', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      expect(assessment.type).toEqual(['ConformityAssessment', 'Declaration']);
    });

    it('builds referenceStandard from standard input', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({
              standard: { id: 'https://example.org/standard/1.0', name: 'Test Standard 1.0' },
            }),
          ],
        }),
      );
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      expect(assessment.referenceStandard).toEqual({
        type: ['Standard'],
        id: 'https://example.org/standard/1.0',
        name: 'Test Standard 1.0',
      });
    });

    it('omits referenceStandard when standard is absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ conformity: [createConformityInput({ standard: undefined })] }),
      );
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      expect(assessment.referenceStandard).toBeUndefined();
    });

    it('builds referenceRegulation from regulation input', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({
              regulation: { id: 'https://example.org/regulation/1.0', name: 'Test Regulation 1.0' },
            }),
          ],
        }),
      );
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      expect(assessment.referenceRegulation).toEqual({
        type: ['Regulation'],
        id: 'https://example.org/regulation/1.0',
        name: 'Test Regulation 1.0',
      });
    });

    it('omits referenceRegulation when regulation is absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ conformity: [createConformityInput({ regulation: undefined })] }),
      );
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      expect(assessment.referenceRegulation).toBeUndefined();
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
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      expect(assessment.assessmentCriteria).toEqual([
        {
          type: ['Criterion'],
          id: 'https://example.org/criteria/1',
          name: 'Criterion 1',
          conformityTopic: 'environment.emissions',
        },
      ]);
    });

    it('omits conformityTopic from criterion when absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({
              criteria: [{ id: 'https://example.org/criteria/1', name: 'Criterion 1' }],
            }),
          ],
        }),
      );
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      const criteria = assessment.assessmentCriteria as Record<string, unknown>[];
      expect(criteria[0].conformityTopic).toBeUndefined();
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
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      const criteria = assessment.assessmentCriteria as Record<string, unknown>[];
      expect(criteria).toHaveLength(1);
      expect(criteria[0].id).toBe('https://example.org/criteria/1');
    });

    it('omits assessmentCriteria when all criteria have empty-string ids', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [createConformityInput({ criteria: [{ id: '', name: 'Empty' }] })],
        }),
      );
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      expect(assessment.assessmentCriteria).toBeUndefined();
    });

    it('each assessment includes assessedProduct when product is provided', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      const assessedProduct = assessment.assessedProduct as Record<string, unknown>[];

      expect(assessedProduct).toHaveLength(1);
      expect(assessedProduct[0]).toMatchObject({
        type: ['ProductVerification'],
        product: {
          type: ['Product'],
          registeredId: '9520123456788',
        },
      });
    });

    it('assessedProduct includes batchNumber and serialNumber when present', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          product: createProduct({ batchNumber: 'BATCH-001', serialNumber: 'SN-999' }),
          conformity: [createConformityInput()],
        }),
      );
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      const product = (assessment.assessedProduct as Record<string, unknown>[])[0].product as Record<string, unknown>;
      expect(product.batchNumber).toBe('BATCH-001');
      expect(product.serialNumber).toBe('SN-999');
    });

    it('each assessment includes assessedFacility when facility is provided', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      const assessedFacility = assessment.assessedFacility as Record<string, unknown>[];

      expect(assessedFacility).toHaveLength(1);
      expect(assessedFacility[0]).toMatchObject({
        type: ['FacilityVerification'],
        facility: {
          type: ['Facility'],
          registeredId: '4012345000009',
        },
      });
    });

    it('each assessment includes assessedOrganisation when organisation is provided', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      const assessedOrg = assessment.assessedOrganisation as Record<string, unknown>;

      expect(assessedOrg).toMatchObject({
        registeredId: '9520123456788',
        name: 'Test Organisation',
      });
    });

    it('omits assessedProduct when product is not provided', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: undefined, conformity: [createConformityInput()] }),
      );
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      expect(assessment.assessedProduct).toBeUndefined();
    });

    it('omits assessedFacility when facility is not provided', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ facility: undefined, conformity: [createConformityInput()] }),
      );
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      expect(assessment.assessedFacility).toBeUndefined();
    });

    it('omits assessedOrganisation when organisation is not provided', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ organisation: undefined, conformity: [createConformityInput()] }),
      );
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      expect(assessment.assessedOrganisation).toBeUndefined();
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
      const assessments = subject.assessment as Record<string, unknown>[];
      expect(assessments).toHaveLength(2);
      expect((assessments[0].referenceStandard as Record<string, unknown>).id).toBe('https://example.org/std/1');
      expect((assessments[1].referenceStandard as Record<string, unknown>).id).toBe('https://example.org/std/2');
    });

    it('product type is set to Product inside assessedProduct', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      const product = (assessment.assessedProduct as Record<string, unknown>[])[0].product as Record<string, unknown>;
      expect(product.type).toEqual(['Product']);
    });

    it('facility type is set to Facility inside assessedFacility', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      const facility = (assessment.assessedFacility as Record<string, unknown>[])[0].facility as Record<
        string,
        unknown
      >;
      expect(facility.type).toEqual(['Facility']);
    });
  });
});
