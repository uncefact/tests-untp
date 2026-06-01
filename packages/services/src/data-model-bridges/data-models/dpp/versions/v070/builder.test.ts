import { makeBridge } from '../../../../make-bridge.js';
import { dppV070Spec } from './index.js';
import {
  createOrganisation,
  createFacility,
  createProduct,
  createConformityInput,
  createBridgeEntities,
} from '../../../../__fixtures__/entities.js';

describe('buildDppSubject (v0.7.0)', () => {
  const bridge = makeBridge(dppV070Spec);

  // ── credentialSubject root structure ─────────────────────────────────────────

  describe('credentialSubject root', () => {
    it('sets type to Product (no ProductPassport wrapper)', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.type).toEqual(['Product']);
    });

    it('maps product id and name to top-level', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          product: createProduct({ id: 'did:web:example.com:product:1', name: 'My Product' }),
        }),
      );
      expect(subject.id).toBe('did:web:example.com:product:1');
      expect(subject.name).toBe('My Product');
    });

    it('includes description when present', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ description: 'A fine product' }) }),
      );
      expect(subject.description).toBe('A fine product');
    });

    it('omits description when absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ description: undefined }) }));
      expect(subject.description).toBeUndefined();
    });

    it('sets idGranularity to lowercased product.level when present', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ level: 'BATCH' }) }));
      expect(subject.idGranularity).toBe('batch');
    });

    it('sets idGranularity to model when level is MODEL', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ level: 'MODEL' }) }));
      expect(subject.idGranularity).toBe('model');
    });

    it('sets idGranularity to item when level is ITEM', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ level: 'ITEM' }) }));
      expect(subject.idGranularity).toBe('item');
    });

    it('omits idGranularity when product.level is absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ level: undefined }) }));
      expect(subject.idGranularity).toBeUndefined();
    });

    it('does not emit legacy granularityLevel key', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ level: 'BATCH' }) }));
      expect(subject.granularityLevel).toBeUndefined();
    });

    it('does not emit a nested product wrapper', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.product).toBeUndefined();
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
  });

  // ── product identifier fields ─────────────────────────────────────────────────

  describe('product identifiers', () => {
    it('writes the primary identifier value to modelNumber and idScheme inline (no top-level registeredId)', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.modelNumber).toBe('9520123456788');
      expect(subject.idScheme).toEqual({
        type: ['IdentifierScheme'],
        id: 'https://id.gs1.org/01/',
        name: 'Global Trade Item Number (GTIN)',
      });
      expect(subject.registeredId).toBeUndefined();
    });

    it('omits modelNumber and idScheme when primaryIdentifier is absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ primaryIdentifier: null }) }),
      );
      expect(subject.modelNumber).toBeUndefined();
      expect(subject.idScheme).toBeUndefined();
    });

    it('includes batchNumber when present', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ batchNumber: 'BATCH-2024-001' }) }),
      );
      expect(subject.batchNumber).toBe('BATCH-2024-001');
    });

    it('omits batchNumber when absent', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ product: createProduct({ batchNumber: undefined }) }));
      expect(subject.batchNumber).toBeUndefined();
    });

    it('maps product.serialNumber to itemNumber (renamed field)', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ serialNumber: 'SN-12345' }) }),
      );
      expect(subject.itemNumber).toBe('SN-12345');
      expect(subject.serialNumber).toBeUndefined();
    });

    it('omits itemNumber when serialNumber is absent', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({ product: createProduct({ serialNumber: undefined }) }),
      );
      expect(subject.itemNumber).toBeUndefined();
    });
  });

  // ── relatedParty (replaces producedByParty) ─────────────────────────────────

  describe('relatedParty', () => {
    it('emits a single PartyRole entry with role=producer', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const parties = subject.relatedParty as Record<string, unknown>[];
      expect(Array.isArray(parties)).toBe(true);
      expect(parties).toHaveLength(1);
      expect(parties[0].type).toEqual(['PartyRole']);
      expect(parties[0].role).toBe('producer');
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

    it('does not emit legacy producedByParty key', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      expect(subject.producedByParty).toBeUndefined();
    });

    it('handles missing organisation gracefully', () => {
      const subject = bridge.buildSubject(createBridgeEntities({ organisation: undefined }));
      const parties = subject.relatedParty as Record<string, unknown>[];
      const party = parties[0].party as Record<string, unknown>;
      expect(party.id).toBeUndefined();
      expect(party.name).toBeUndefined();
    });
  });

  // ── producedAtFacility ───────────────────────────────────────────────────────

  describe('producedAtFacility', () => {
    it('sets facility type to Facility', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const facility = subject.producedAtFacility as Record<string, unknown>;
      expect(facility.type).toEqual(['Facility']);
    });

    it('maps full facility including id, name, description, registeredId, idScheme', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const facility = subject.producedAtFacility as Record<string, unknown>;

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
      const facility = subject.producedAtFacility as Record<string, unknown>;
      expect(facility.locationInformation).toEqual({
        type: ['Location'],
        plusCode: '4RRH469X+VF',
        geoLocation: { type: 'Point', coordinates: [151.2093, -33.8688] },
      });
    });

    it('maps address when present', () => {
      const subject = bridge.buildSubject(createBridgeEntities());
      const facility = subject.producedAtFacility as Record<string, unknown>;
      expect(facility.address).toEqual({
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
      const facility = subject.producedAtFacility as Record<string, unknown>;
      expect(facility.locationInformation).toBeUndefined();
      expect(facility.address).toBeUndefined();
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
      const claim = (subject.performanceClaim as Record<string, unknown>[])[0];
      expect(claim.referenceRegulation).toEqual([
        {
          type: ['Regulation'],
          id: 'https://example.org/regulation/1.0',
          name: 'Test Regulation 1.0',
        },
      ]);
    });

    it('builds referenceCriteria from criteria input (renamed from assessmentCriteria)', () => {
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

    it('omits referenceCriteria when all criteria have empty-string ids', () => {
      const subject = bridge.buildSubject(
        createBridgeEntities({
          conformity: [createConformityInput({ criteria: [{ id: '', name: 'Empty' }] })],
        }),
      );
      const claim = (subject.performanceClaim as Record<string, unknown>[])[0];
      expect(claim.referenceCriteria).toBeUndefined();
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
