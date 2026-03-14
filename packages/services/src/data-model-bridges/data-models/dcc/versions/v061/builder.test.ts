import { makeBridge } from '../../../../make-bridge.js';
import { dccV061Spec } from './index.js';
import {
  createOrganisation,
  createFacility,
  createProduct,
  createConformityInput,
  createBridgeEntities,
} from '../../../../__fixtures__/entities.js';

describe('buildDccSubject (v0.6.1)', () => {
  const bridge = makeBridge(dccV061Spec);

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

  // ── scope (v0.6.1: ConformityScheme) ───────────────────────────────────────

  describe('scope', () => {
    it('sets scope type to ConformityScheme (not ConformityAssessmentScheme)', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const scope = subject.scope as Record<string, unknown>;
      expect(scope.type).toEqual(['ConformityScheme']);
    });

    it('builds scope with id and name from first conformity input scheme', () => {
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
        type: ['ConformityScheme'],
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
  });

  // ── v0.6.1 produces identical output to v0.6.0 except for scope ────────────

  describe('non-scope fields match v0.6.0 output', () => {
    it('assessment structure is identical to v0.6.0', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [
            createConformityInput({
              standard: { id: 'https://example.org/standard/1.0', name: 'Test Standard 1.0' },
              regulation: { id: 'https://example.org/regulation/1.0', name: 'Test Regulation 1.0' },
              criteria: [
                { id: 'https://example.org/criteria/1', name: 'Criterion 1', conformityTopic: 'environment.emissions' },
              ],
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
      expect(assessment.referenceRegulation).toEqual({
        type: ['Regulation'],
        id: 'https://example.org/regulation/1.0',
        name: 'Test Regulation 1.0',
      });
      expect(assessment.assessmentCriteria).toEqual([
        {
          type: ['Criterion'],
          id: 'https://example.org/criteria/1',
          name: 'Criterion 1',
          conformityTopic: 'environment.emissions',
        },
      ]);
    });
  });
});
