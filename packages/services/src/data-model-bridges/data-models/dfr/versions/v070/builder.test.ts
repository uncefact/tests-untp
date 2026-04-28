import { makeBridge } from '../../../../make-bridge.js';
import { dfrV070Spec } from './index.js';
import {
  createFacility,
  createProduct,
  createConformityInput,
  createBridgeEntities,
} from '../../../../__fixtures__/entities.js';

describe('buildDfrSubject (v0.7.0)', () => {
  const bridge = makeBridge(dfrV070Spec);

  // ── credentialSubject root structure ─────────────────────────────────────────

  describe('credentialSubject root', () => {
    it('sets type to Facility (no FacilityRecord wrapper)', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.type).toEqual(['Facility']);
    });

    it('does not emit a nested facility wrapper', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.facility).toBeUndefined();
    });

    it('does not emit legacy conformityClaim key', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      expect(subject.conformityClaim).toBeUndefined();
    });

    it('omits performanceClaim when conformity is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: undefined }));
      expect(subject.performanceClaim).toBeUndefined();
    });

    it('omits performanceClaim when conformity is an empty array', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [] }));
      expect(subject.performanceClaim).toBeUndefined();
    });

    it('silently ignores entities.product', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct() }));
      expect(subject.product).toBeUndefined();
    });
  });

  // ── facility fields ──────────────────────────────────────────────────────────

  describe('facility fields', () => {
    it('maps facility id and name at top level', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          facility: createFacility({ id: 'did:web:example.com:facility:1', name: 'My Facility' }),
        }),
      );
      expect(subject.id).toBe('did:web:example.com:facility:1');
      expect(subject.name).toBe('My Facility');
    });

    it('includes description when present', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ facility: createFacility({ description: 'A fine facility' }) }),
      );
      expect(subject.description).toBe('A fine facility');
    });

    it('omits description when absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ facility: createFacility({ description: undefined }) }),
      );
      expect(subject.description).toBeUndefined();
    });

    it('includes registeredId and idScheme at top level when primaryIdentifier is present', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.registeredId).toBe('4012345000009');
      expect(subject.idScheme).toEqual({
        type: ['IdentifierScheme'],
        id: 'https://id.gs1.org/414/',
        name: 'Global Location Number (GLN)',
      });
    });

    it('omits registeredId and idScheme when primaryIdentifier is absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ facility: createFacility({ primaryIdentifier: null }) }),
      );
      expect(subject.registeredId).toBeUndefined();
      expect(subject.idScheme).toBeUndefined();
    });

    it('maps locationInformation when geo fields are present', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.locationInformation).toEqual({
        type: ['Location'],
        plusCode: '4RRH469X+VF',
        geoLocation: { type: 'Point', coordinates: [151.2093, -33.8688] },
      });
    });

    it('maps address when present', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.address).toEqual({
        type: ['Address'],
        streetAddress: '123 Test Street',
        postalCode: '2000',
        addressLocality: 'Sydney',
        addressRegion: 'NSW',
        addressCountry: 'AU',
      });
    });

    it('omits both location and address when facility has no location data', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ facility: createFacility({ location: null }) }));
      expect(subject.locationInformation).toBeUndefined();
      expect(subject.address).toBeUndefined();
    });
  });

  // ── relatedParty (replaces operatedByParty) ─────────────────────────────────

  describe('relatedParty', () => {
    it('emits a single PartyRole entry with role=operator', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const parties = subject.relatedParty as Record<string, unknown>[];
      expect(Array.isArray(parties)).toBe(true);
      expect(parties).toHaveLength(1);
      expect(parties[0].type).toEqual(['PartyRole']);
      expect(parties[0].role).toBe('operator');
    });

    it('maps organisation to the embedded party', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const parties = subject.relatedParty as Record<string, unknown>[];
      const party = parties[0].party as Record<string, unknown>;

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

    it('does not emit legacy operatedByParty key', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.operatedByParty).toBeUndefined();
    });

    it('handles missing organisation gracefully', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ organisation: undefined }));
      const parties = subject.relatedParty as Record<string, unknown>[];
      const party = parties[0].party as Record<string, unknown>;
      expect(party.id).toBeUndefined();
      expect(party.name).toBeUndefined();
    });
  });

  // ── performanceClaim (replaces conformityClaim) ─────────────────────────────

  describe('performanceClaim', () => {
    it('builds performanceClaim array from conformity inputs', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const claims = subject.performanceClaim as unknown[];
      expect(Array.isArray(claims)).toBe(true);
      expect(claims).toHaveLength(1);
    });

    it('sets claim type to Claim and Declaration', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const claim = (subject.performanceClaim as Record<string, unknown>[])[0];
      expect(claim.type).toEqual(['Claim', 'Declaration']);
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
      const claim = (subject.performanceClaim as Record<string, unknown>[])[0];
      expect(claim.referenceStandard).toEqual([
        { type: ['Standard'], id: 'https://example.org/standard/1.0', name: 'Test Standard 1.0' },
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
      const claim = (subject.performanceClaim as Record<string, unknown>[])[0];
      expect(claim.referenceRegulation).toEqual([
        { type: ['Regulation'], id: 'https://example.org/regulation/1.0', name: 'Test Regulation 1.0' },
      ]);
    });

    it('builds referenceCriteria (renamed from assessmentCriteria)', () => {
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
      const claim = (subject.performanceClaim as Record<string, unknown>[])[0];
      expect(claim.referenceCriteria).toEqual([
        {
          type: ['Criterion'],
          id: 'https://example.org/criteria/1',
          name: 'Criterion 1',
          conformityTopic: 'environment.emissions',
        },
      ]);
      expect(claim.assessmentCriteria).toBeUndefined();
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
      const claim = (subject.performanceClaim as Record<string, unknown>[])[0];
      const criteria = claim.referenceCriteria as Record<string, unknown>[];
      expect(criteria).toHaveLength(1);
      expect(criteria[0].id).toBe('https://example.org/criteria/1');
    });

    it('builds multiple performance claims', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [createConformityInput(), createConformityInput({ standard: { id: 'https://other.org/std' } })],
        }),
      );
      const claims = subject.performanceClaim as unknown[];
      expect(claims).toHaveLength(2);
    });
  });
});
