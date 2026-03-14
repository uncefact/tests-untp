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
import type { VersionSpec } from '../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dppV060Spec],
  ['v0.6.1', dppV061Spec],
];

describe.each(versions)('buildDppSubject (%s)', (_version, spec) => {
  const bridge = makeBridge(spec);

  // ── credentialSubject root structure ─────────────────────────────────────────

  describe('credentialSubject root', () => {
    it('sets type to ProductPassport', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.type).toEqual(['ProductPassport']);
    });

    it('includes a product field', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.product).toBeDefined();
    });

    it('sets granularityLevel to lowercased product.level when present', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ level: 'BATCH' }) }));
      expect(subject.granularityLevel).toBe('batch');
    });

    it('sets granularityLevel to model when level is MODEL', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ level: 'MODEL' }) }));
      expect(subject.granularityLevel).toBe('model');
    });

    it('sets granularityLevel to item when level is ITEM', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ level: 'ITEM' }) }));
      expect(subject.granularityLevel).toBe('item');
    });

    it('omits granularityLevel when product.level is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ level: undefined }) }));
      expect(subject.granularityLevel).toBeUndefined();
    });

    it('omits conformityClaim when conformity is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: undefined }));
      expect(subject.conformityClaim).toBeUndefined();
    });

    it('omits conformityClaim when conformity is an empty array', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ conformity: [] }));
      expect(subject.conformityClaim).toBeUndefined();
    });
  });

  // ── product ──────────────────────────────────────────────────────────────────

  describe('product', () => {
    it('sets product.type to Product', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const product = subject.product as Record<string, unknown>;
      expect(product.type).toEqual(['Product']);
    });

    it('maps product id and name', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ id: 'did:web:example.com:product:1', name: 'My Product' }) }),
      );
      const product = subject.product as Record<string, unknown>;
      expect(product.id).toBe('did:web:example.com:product:1');
      expect(product.name).toBe('My Product');
    });

    it('includes description when present', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ description: 'A fine product' }) }),
      );
      const product = subject.product as Record<string, unknown>;
      expect(product.description).toBe('A fine product');
    });

    it('omits description when absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ description: undefined }) }));
      const product = subject.product as Record<string, unknown>;
      expect(product.description).toBeUndefined();
    });

    it('includes registeredId and idScheme when primaryIdentifier is present', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const product = subject.product as Record<string, unknown>;
      expect(product.registeredId).toBe('9520123456788');
      expect(product.idScheme).toEqual({
        type: ['IdentifierScheme'],
        id: 'https://id.gs1.org/01/',
        name: 'Global Trade Item Number (GTIN)',
      });
    });

    it('omits registeredId and idScheme when primaryIdentifier is absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ primaryIdentifier: null }) }),
      );
      const product = subject.product as Record<string, unknown>;
      expect(product.registeredId).toBeUndefined();
      expect(product.idScheme).toBeUndefined();
    });

    it('includes batchNumber when present', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ batchNumber: 'BATCH-2024-001' }) }),
      );
      const product = subject.product as Record<string, unknown>;
      expect(product.batchNumber).toBe('BATCH-2024-001');
    });

    it('omits batchNumber when absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ batchNumber: undefined }) }));
      const product = subject.product as Record<string, unknown>;
      expect(product.batchNumber).toBeUndefined();
    });

    it('includes serialNumber when present', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ serialNumber: 'SN-12345' }) }),
      );
      const product = subject.product as Record<string, unknown>;
      expect(product.serialNumber).toBe('SN-12345');
    });

    it('omits serialNumber when absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ serialNumber: undefined }) }),
      );
      const product = subject.product as Record<string, unknown>;
      expect(product.serialNumber).toBeUndefined();
    });
  });

  // ── producedByParty ──────────────────────────────────────────────────────────

  describe('producedByParty', () => {
    it('maps organisation to producedByParty', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const product = subject.product as Record<string, unknown>;
      const party = product.producedByParty as Record<string, unknown>;

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
      const product = subject.product as Record<string, unknown>;
      const party = product.producedByParty as Record<string, unknown>;

      expect(party.id).toBeUndefined();
      expect(party.name).toBeUndefined();
    });
  });

  // ── producedAtFacility ───────────────────────────────────────────────────────

  describe('producedAtFacility', () => {
    it('sets facility type to Facility', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const product = subject.product as Record<string, unknown>;
      const facility = product.producedAtFacility as Record<string, unknown>;
      expect(facility.type).toEqual(['Facility']);
    });

    it('maps full facility including id, name, description, registeredId, idScheme', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const product = subject.product as Record<string, unknown>;
      const facility = product.producedAtFacility as Record<string, unknown>;

      expect(facility.id).toBe('did:web:example.com:facility:1');
      expect(facility.name).toBe('Test Facility');
      expect(facility.description).toBe('A test facility for unit tests');
      expect(facility.registeredId).toBe('4012345000009');
      expect(facility.idScheme).toEqual({
        type: ['IdentifierScheme'],
        id: 'https://id.gs1.org/414/',
        name: 'Global Location Number (GLN)',
      });
    });

    it('maps locationInformation when geo fields are present', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const product = subject.product as Record<string, unknown>;
      const facility = product.producedAtFacility as Record<string, unknown>;

      expect(facility.locationInformation).toEqual({
        type: ['Location'],
        plusCode: '4RRH469X+VF',
        geoLocation: { type: 'Point', coordinates: [151.2093, -33.8688] },
      });
    });

    it('maps address when present', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const product = subject.product as Record<string, unknown>;
      const facility = product.producedAtFacility as Record<string, unknown>;

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
      const product = subject.product as Record<string, unknown>;
      const facility = product.producedAtFacility as Record<string, unknown>;
      expect(facility.locationInformation).toBeUndefined();
    });

    it('omits address when facility location has no address', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          facility: createFacility({ location: { geoLocation: { type: 'Point', coordinates: [151.2093, -33.8688] } } }),
        }),
      );
      const product = subject.product as Record<string, unknown>;
      const facility = product.producedAtFacility as Record<string, unknown>;
      expect(facility.address).toBeUndefined();
    });

    it('omits both location and address when facility has no location data', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ facility: createFacility({ location: null }) }));
      const product = subject.product as Record<string, unknown>;
      const facility = product.producedAtFacility as Record<string, unknown>;
      expect(facility.locationInformation).toBeUndefined();
      expect(facility.address).toBeUndefined();
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
      const claim = (subject.conformityClaim as Record<string, unknown>[])[0];
      const criteria = claim.assessmentCriteria as Record<string, unknown>[];
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
      const claim = (subject.conformityClaim as Record<string, unknown>[])[0];
      const criteria = claim.assessmentCriteria as Record<string, unknown>[];
      expect(criteria).toHaveLength(1);
      expect(criteria[0].id).toBe('https://example.org/criteria/1');
    });

    it('omits assessmentCriteria when all criteria have empty-string ids', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [createConformityInput({ criteria: [{ id: '', name: 'Empty' }] })],
        }),
      );
      const claim = (subject.conformityClaim as Record<string, unknown>[])[0];
      expect(claim.assessmentCriteria).toBeUndefined();
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
