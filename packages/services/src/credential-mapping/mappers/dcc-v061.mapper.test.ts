import { DccV061Mapper } from './dcc-v061.mapper';
import type { ResolvedEntities, DataModelConfig, MapperOutput } from '../types';

// -- Mock data model configs --------------------------------------------------

const mockCoreDataModel: DataModelConfig['core'] = {
  contextUrl: 'https://test.uncefact.org/vocabulary/untp/dcc/0.6.1/',
  credentialType: 'DigitalConformityCredential',
};

const mockExtensionDataModel: DataModelConfig['extension'] = {
  contextUrl: 'https://example.org/conformity-ext/v1/',
  credentialType: 'DigitalConformityCredential',
};

const mockExtensionDifferentType: DataModelConfig['extension'] = {
  contextUrl: 'https://example.org/product-ext/v1/',
  credentialType: 'DigitalProductPassport',
};

// -- Mock entities ------------------------------------------------------------

const mockOrganisation: ResolvedEntities['organisation'] = {
  id: 'org-1',
  name: 'Test Organisation',
  description: 'A test org',
  primaryIdentifier: {
    value: '1234567890',
    scheme: {
      id: 'scheme-1',
      name: 'Global Location Number (GLN)',
    },
  },
};

const mockFacility: ResolvedEntities['facility'] = {
  id: 'facility-1',
  name: 'Test Facility',
  description: 'A test facility',
  location: null,
  primaryIdentifier: {
    value: '9876543210',
    scheme: {
      id: 'scheme-2',
      name: 'Global Location Number (GLN)',
    },
  },
};

const mockProduct: ResolvedEntities['product'] = {
  id: 'product-1',
  name: 'Test Product',
  description: 'A test product',
  level: 'MODEL',
  batchNumber: 'BATCH-001',
  serialNumber: 'SN-12345',
  primaryIdentifier: {
    value: '01234567890123',
    scheme: { id: 'scheme-3', name: 'GTIN' },
  },
};

// -- Tests --------------------------------------------------------------------

describe('DccV061Mapper', () => {
  const mapper = new DccV061Mapper();
  const coreConfig: DataModelConfig = { core: mockCoreDataModel };

  const fullEntities: ResolvedEntities = {
    organisation: mockOrganisation,
    facility: mockFacility,
    product: mockProduct,
  };

  // -- buildPayload: @context and type ----------------------------------------

  describe('buildPayload', () => {
    it('returns @context array containing the core context URL', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);

      expect(result['@context']).toEqual(['https://test.uncefact.org/vocabulary/untp/dcc/0.6.1/']);
    });

    it('merges extension context URL into @context when extension is present', async () => {
      const configWithExt: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDataModel,
      };

      const result = await mapper.buildPayload(fullEntities, configWithExt);

      expect(result['@context']).toEqual([
        'https://test.uncefact.org/vocabulary/untp/dcc/0.6.1/',
        'https://example.org/conformity-ext/v1/',
      ]);
    });

    it('returns type array containing the core credentialType', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);

      expect(result.type).toEqual(['DigitalConformityCredential']);
    });

    it('deduplicates type when extension has the same credentialType as core', async () => {
      const configWithExt: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDataModel,
      };

      const result = await mapper.buildPayload(fullEntities, configWithExt);

      expect(result.type).toEqual(['DigitalConformityCredential']);
    });

    it('includes both types when extension has a different credentialType', async () => {
      const configWithDifferentType: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDifferentType,
      };

      const result = await mapper.buildPayload(fullEntities, configWithDifferentType);

      expect(result['@context']).toEqual([
        'https://test.uncefact.org/vocabulary/untp/dcc/0.6.1/',
        'https://example.org/product-ext/v1/',
      ]);
      expect(result.type).toEqual(['DigitalConformityCredential', 'DigitalProductPassport']);
    });

    // -- credentialSubject type ------------------------------------------------

    it('sets credentialSubject.type to ConformityAttestation + Attestation', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.type).toEqual(['ConformityAttestation', 'Attestation']);
    });

    // -- issuedToParty --------------------------------------------------------

    it('maps organisation to issuedToParty with idScheme and description', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const party = subject.issuedToParty as Record<string, unknown>;

      expect(party).toEqual({
        id: 'org-1',
        name: 'Test Organisation',
        description: 'A test org',
        registeredId: '1234567890',
        idScheme: {
          type: ['IdentifierScheme'],
          id: 'scheme-1',
          name: 'Global Location Number (GLN)',
        },
      });
    });

    it('omits description on issuedToParty when organisation has none', async () => {
      const orgNoDescription: ResolvedEntities = {
        organisation: {
          ...mockOrganisation,
          description: undefined,
        },
      };

      const result = await mapper.buildPayload(orgNoDescription, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const party = subject.issuedToParty as Record<string, unknown>;

      expect(party.description).toBeUndefined();
    });

    it('omits registeredId and idScheme on issuedToParty when organisation has no primaryIdentifier', async () => {
      const orgNoIdentifier: ResolvedEntities = {
        organisation: {
          ...mockOrganisation,
          primaryIdentifier: null,
        },
      };

      const result = await mapper.buildPayload(orgNoIdentifier, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const party = subject.issuedToParty as Record<string, unknown>;

      expect(party.registeredId).toBeUndefined();
      expect(party.idScheme).toBeUndefined();
    });

    // -- assessment: ConformityAssessment -------------------------------------

    it('includes assessment array with ConformityAssessment type when entities are present', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const assessment = subject.assessment as Record<string, unknown>[];

      expect(assessment).toHaveLength(1);
      expect(assessment[0].type).toEqual(['ConformityAssessment', 'Declaration']);
    });

    it('includes assessedProduct with ProductVerification when product is provided', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      const assessedProduct = assessment.assessedProduct as Record<string, unknown>[];

      expect(assessedProduct).toHaveLength(1);
      expect(assessedProduct[0]).toEqual({
        type: ['ProductVerification'],
        product: {
          id: 'product-1',
          name: 'Test Product',
          registeredId: '01234567890123',
          idScheme: {
            type: ['IdentifierScheme'],
            id: 'scheme-3',
            name: 'GTIN',
          },
          batchNumber: 'BATCH-001',
          serialNumber: 'SN-12345',
        },
      });
    });

    it('includes assessedFacility with FacilityVerification when facility is provided', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      const assessedFacility = assessment.assessedFacility as Record<string, unknown>[];

      expect(assessedFacility).toHaveLength(1);
      expect(assessedFacility[0]).toEqual({
        type: ['FacilityVerification'],
        facility: {
          id: 'facility-1',
          name: 'Test Facility',
          registeredId: '9876543210',
          idScheme: {
            type: ['IdentifierScheme'],
            id: 'scheme-2',
            name: 'Global Location Number (GLN)',
          },
        },
      });
    });

    it('includes assessedOrganisation in assessment', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const assessment = (subject.assessment as Record<string, unknown>[])[0];
      const assessedOrg = assessment.assessedOrganisation as Record<string, unknown>;

      expect(assessedOrg).toEqual({
        id: 'org-1',
        name: 'Test Organisation',
        description: 'A test org',
        registeredId: '1234567890',
        idScheme: {
          type: ['IdentifierScheme'],
          id: 'scheme-1',
          name: 'Global Location Number (GLN)',
        },
      });
    });

    it('omits assessedProduct when product is not provided', async () => {
      const entitiesNoProduct: ResolvedEntities = {
        organisation: mockOrganisation,
        facility: mockFacility,
      };

      const result = await mapper.buildPayload(entitiesNoProduct, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const assessment = (subject.assessment as Record<string, unknown>[])[0];

      expect(assessment.assessedProduct).toBeUndefined();
      expect(assessment.assessedFacility).toBeDefined();
    });

    it('omits assessedFacility when facility is not provided', async () => {
      const entitiesNoFacility: ResolvedEntities = {
        organisation: mockOrganisation,
        product: mockProduct,
      };

      const result = await mapper.buildPayload(entitiesNoFacility, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const assessment = (subject.assessment as Record<string, unknown>[])[0];

      expect(assessment.assessedFacility).toBeUndefined();
      expect(assessment.assessedProduct).toBeDefined();
    });

    it('creates assessment with only assessedOrganisation when no product or facility', async () => {
      const orgOnly: ResolvedEntities = {
        organisation: mockOrganisation,
      };

      const result = await mapper.buildPayload(orgOnly, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const assessment = (subject.assessment as Record<string, unknown>[])[0];

      expect(assessment.type).toEqual(['ConformityAssessment', 'Declaration']);
      expect(assessment.assessedOrganisation).toBeDefined();
      expect(assessment.assessedProduct).toBeUndefined();
      expect(assessment.assessedFacility).toBeUndefined();
    });

    it('omits assessment when no entities are provided', async () => {
      const emptyEntities: ResolvedEntities = {};

      const result = await mapper.buildPayload(emptyEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.assessment).toBeUndefined();
    });

    it('handles undefined organisation gracefully in issuedToParty', async () => {
      const emptyEntities: ResolvedEntities = {};

      const result = await mapper.buildPayload(emptyEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const party = subject.issuedToParty as Record<string, unknown>;

      expect(party.id).toBeUndefined();
      expect(party.name).toBeUndefined();
    });
  });

  // -- extractEntityRefs ------------------------------------------------------

  describe('extractEntityRefs', () => {
    const stubContext = ['https://test.uncefact.org/vocabulary/untp/dcc/0.6.1/'];
    const stubType = ['DigitalConformityCredential'];

    it('extracts organisation registeredId from issuedToParty', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['ConformityAttestation'],
          issuedToParty: { registeredId: '1234567890' },
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs.organisation).toEqual({ registeredId: '1234567890' });
    });

    it('extracts product registeredId from assessment.assessedProduct', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['ConformityAttestation'],
          issuedToParty: { registeredId: '1234567890' },
          assessment: [
            {
              type: ['ConformityAssessment', 'Declaration'],
              assessedProduct: [
                {
                  type: ['ProductVerification'],
                  product: {
                    registeredId: '01234567890123',
                    batchNumber: 'BATCH-001',
                    serialNumber: 'SN-12345',
                  },
                },
              ],
            },
          ],
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs.product).toEqual({
        registeredId: '01234567890123',
        batchNumber: 'BATCH-001',
        serialNumber: 'SN-12345',
      });
    });

    it('extracts facility registeredId from assessment.assessedFacility', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['ConformityAttestation'],
          issuedToParty: { registeredId: '1234567890' },
          assessment: [
            {
              type: ['ConformityAssessment', 'Declaration'],
              assessedFacility: [
                {
                  type: ['FacilityVerification'],
                  facility: { registeredId: '9876543210' },
                },
              ],
            },
          ],
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs.facility).toEqual({ registeredId: '9876543210' });
    });

    it('extracts all three entity refs and sets primaryIdentifier to product registeredId', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['ConformityAttestation'],
          issuedToParty: { registeredId: '1234567890' },
          assessment: [
            {
              type: ['ConformityAssessment', 'Declaration'],
              assessedProduct: [
                {
                  type: ['ProductVerification'],
                  product: { registeredId: '01234567890123' },
                },
              ],
              assessedFacility: [
                {
                  type: ['FacilityVerification'],
                  facility: { registeredId: '9876543210' },
                },
              ],
              assessedOrganisation: { registeredId: '1234567890' },
            },
          ],
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({
        primaryIdentifier: '01234567890123',
        organisation: { registeredId: '1234567890' },
        product: { registeredId: '01234567890123' },
        facility: { registeredId: '9876543210' },
      });
    });

    it('sets primaryIdentifier to facility registeredId when no product', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['ConformityAttestation'],
          issuedToParty: { registeredId: '1234567890' },
          assessment: [
            {
              type: ['ConformityAssessment', 'Declaration'],
              assessedFacility: [
                {
                  type: ['FacilityVerification'],
                  facility: { registeredId: '9876543210' },
                },
              ],
            },
          ],
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs.primaryIdentifier).toBe('9876543210');
    });

    it('sets primaryIdentifier to organisation registeredId when no product or facility', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['ConformityAttestation'],
          issuedToParty: { registeredId: '1234567890' },
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs.primaryIdentifier).toBe('1234567890');
    });

    it('falls back to assessedOrganisation when issuedToParty has no registeredId', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['ConformityAttestation'],
          issuedToParty: { name: 'Some org' },
          assessment: [
            {
              type: ['ConformityAssessment', 'Declaration'],
              assessedOrganisation: { registeredId: '1234567890' },
            },
          ],
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs.organisation).toEqual({ registeredId: '1234567890' });
    });

    it('returns empty object when issuedToParty is missing and no assessment', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: { type: ['ConformityAttestation'] },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({});
    });
  });
});
