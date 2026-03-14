import { makeBridge } from '../../make-bridge.js';
import { dfrV060Spec } from './versions/v060.js';
import { dfrV061Spec } from './versions/v061.js';
import {
  createOrganisation,
  createFacility,
  createProduct,
  createConformityInput,
  createBridgeEntities,
} from '../../__fixtures__/entities.js';
import type { VersionSpec } from '../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dfrV060Spec],
  ['v0.6.1', dfrV061Spec],
];

describe.each(versions)('buildDfrSubject (%s)', (_version, spec) => {
  const bridge = makeBridge(spec);

  // ── credentialSubject root structure ─────────────────────────────────────────

  describe('credentialSubject root', () => {
    it('sets type to FacilityRecord', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.type).toEqual(['FacilityRecord']);
    });

    it('includes a facility field', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.facility).toBeDefined();
    });

    it('omits conformityClaim when conformity is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: undefined }));
      expect(subject.conformityClaim).toBeUndefined();
    });

    it('omits conformityClaim when conformity is an empty array', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [] }));
      expect(subject.conformityClaim).toBeUndefined();
    });

    it('silently ignores entities.product', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct() }));
      expect(subject.product).toBeUndefined();
    });
  });

  // ── facility ─────────────────────────────────────────────────────────────────

  describe('facility', () => {
    it('sets facility.type to Facility', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const facility = subject.facility as Record<string, unknown>;
      expect(facility.type).toEqual(['Facility']);
    });

    it('maps facility id and name', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          facility: createFacility({ id: 'did:web:example.com:facility:1', name: 'My Facility' }),
        }),
      );
      const facility = subject.facility as Record<string, unknown>;
      expect(facility.id).toBe('did:web:example.com:facility:1');
      expect(facility.name).toBe('My Facility');
    });

    it('includes description when present', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ facility: createFacility({ description: 'A fine facility' }) }),
      );
      const facility = subject.facility as Record<string, unknown>;
      expect(facility.description).toBe('A fine facility');
    });

    it('omits description when absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ facility: createFacility({ description: undefined }) }),
      );
      const facility = subject.facility as Record<string, unknown>;
      expect(facility.description).toBeUndefined();
    });

    it('includes registeredId and idScheme when primaryIdentifier is present', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const facility = subject.facility as Record<string, unknown>;
      expect(facility.registeredId).toBe('4012345000009');
      expect(facility.idScheme).toEqual({
        type: ['IdentifierScheme'],
        id: 'https://id.gs1.org/414/',
        name: 'Global Location Number (GLN)',
      });
    });

    it('omits registeredId and idScheme when primaryIdentifier is absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ facility: createFacility({ primaryIdentifier: null }) }),
      );
      const facility = subject.facility as Record<string, unknown>;
      expect(facility.registeredId).toBeUndefined();
      expect(facility.idScheme).toBeUndefined();
    });

    it('maps locationInformation when geo fields are present', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const facility = subject.facility as Record<string, unknown>;
      expect(facility.locationInformation).toEqual({
        type: ['Location'],
        plusCode: '4RRH469X+VF',
        geoLocation: { type: 'Point', coordinates: [151.2093, -33.8688] },
      });
    });

    it('maps address when present', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const facility = subject.facility as Record<string, unknown>;
      expect(facility.address).toEqual({
        type: ['Address'],
        streetAddress: '123 Test Street',
        postalCode: '2000',
        addressLocality: 'Sydney',
        addressRegion: 'NSW',
        addressCountry: 'AU',
      });
    });

    it('omits locationInformation when facility has no geo data', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          facility: createFacility({ location: { address: { streetAddress: '123 Test Street' } } }),
        }),
      );
      const facility = subject.facility as Record<string, unknown>;
      expect(facility.locationInformation).toBeUndefined();
    });

    it('omits address when facility location has no address', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          facility: createFacility({ location: { geoLocation: { type: 'Point', coordinates: [151.2093, -33.8688] } } }),
        }),
      );
      const facility = subject.facility as Record<string, unknown>;
      expect(facility.address).toBeUndefined();
    });

    it('omits both location and address when facility has no location data', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ facility: createFacility({ location: null }) }));
      const facility = subject.facility as Record<string, unknown>;
      expect(facility.locationInformation).toBeUndefined();
      expect(facility.address).toBeUndefined();
    });
  });

  // ── operatedByParty ──────────────────────────────────────────────────────────

  describe('operatedByParty', () => {
    it('maps organisation to operatedByParty', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const facility = subject.facility as Record<string, unknown>;
      const party = facility.operatedByParty as Record<string, unknown>;

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

    it('handles missing organisation gracefully', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ organisation: undefined }));
      const facility = subject.facility as Record<string, unknown>;
      const party = facility.operatedByParty as Record<string, unknown>;

      expect(party.id).toBeUndefined();
      expect(party.name).toBeUndefined();
    });
  });

  // ── conformityClaim ──────────────────────────────────────────────────────────

  describe('conformityClaim', () => {
    it('builds conformityClaim array from conformity inputs', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const claims = subject.conformityClaim as unknown[];
      expect(Array.isArray(claims)).toBe(true);
      expect(claims).toHaveLength(1);
    });

    it('sets claim type to Claim and Declaration', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [createConformityInput()] }));
      const claim = (subject.conformityClaim as Record<string, unknown>[])[0];
      expect(claim.type).toEqual(['Claim', 'Declaration']);
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
      const claim = (subject.conformityClaim as Record<string, unknown>[])[0];
      expect(claim.referenceStandard).toEqual({
        type: ['Standard'],
        id: 'https://example.org/standard/1.0',
        name: 'Test Standard 1.0',
      });
    });

    it('omits referenceStandard when standard is absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ conformity: [createConformityInput({ standard: undefined })] }),
      );
      const claim = (subject.conformityClaim as Record<string, unknown>[])[0];
      expect(claim.referenceStandard).toBeUndefined();
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
      const claim = (subject.conformityClaim as Record<string, unknown>[])[0];
      expect(claim.referenceRegulation).toEqual({
        type: ['Regulation'],
        id: 'https://example.org/regulation/1.0',
        name: 'Test Regulation 1.0',
      });
    });

    it('omits referenceRegulation when regulation is absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ conformity: [createConformityInput({ regulation: undefined })] }),
      );
      const claim = (subject.conformityClaim as Record<string, unknown>[])[0];
      expect(claim.referenceRegulation).toBeUndefined();
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
      const claim = (subject.conformityClaim as Record<string, unknown>[])[0];
      expect(claim.assessmentCriteria).toEqual([
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
      const claim = (subject.conformityClaim as Record<string, unknown>[])[0];
      const criteria = claim.assessmentCriteria as Record<string, unknown>[];
      expect(criteria).toHaveLength(1);
      expect(criteria[0].id).toBe('https://example.org/criteria/1');
    });

    it('builds multiple conformity claims', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [createConformityInput(), createConformityInput({ standard: { id: 'https://other.org/std' } })],
        }),
      );
      const claims = subject.conformityClaim as unknown[];
      expect(claims).toHaveLength(2);
    });
  });
});
