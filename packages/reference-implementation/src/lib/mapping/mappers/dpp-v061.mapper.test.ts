import { DppV061Mapper } from './dpp-v061.mapper';
import { getMapper } from '../mapper-registry';
import { ResolvedEntities, DataModelConfig, MapperOutput } from '../types';

// -- Mock data model configs --------------------------------------------------

const mockCoreDataModel = {
  id: 'dm-core-1',
  tenantId: null,
  name: 'Digital Product Passport v0.6.1',
  credentialType: 'DigitalProductPassport',
  version: '0.6.1',
  isExtension: false,
  parentConfigId: null,
  parentConfig: null,
  extensions: [],
  renderTemplates: [],
  schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/schema.json',
  contextUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/',
  websiteUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as DataModelConfig['core'];

const mockExtensionDataModel = {
  id: 'dm-ext-1',
  tenantId: 'tenant-1',
  name: 'Australian Agriculture Extension',
  credentialType: 'DigitalProductPassport',
  version: '0.6.1',
  isExtension: true,
  parentConfigId: 'dm-core-1',
  parentConfig: mockCoreDataModel,
  extensions: [],
  renderTemplates: [],
  schemaUrl: 'https://example.org/aus-agri/v1/schema.json',
  contextUrl: 'https://example.org/aus-agri/v1/',
  websiteUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as DataModelConfig['extension'];

const mockExtensionDifferentType = {
  ...mockExtensionDataModel!,
  id: 'dm-ext-2',
  name: 'Custom Conformity Extension',
  credentialType: 'DigitalConformityCredential',
  contextUrl: 'https://example.org/conformity-ext/v1/',
} as DataModelConfig['extension'];

// -- Mock entities ------------------------------------------------------------

const mockOrganisation = {
  id: 'org-1',
  name: 'Test Organisation',
  description: 'A test org',
  tenantId: 'tenant-1',
  primaryIdentifier: {
    id: 'id-1',
    value: '1234567890',
    scheme: {
      id: 'scheme-1',
      primaryKey: 'gs1:gln',
      name: 'Global Location Number (GLN)',
      linkTemplate: '/{primaryKey}/{value}',
    },
  },
} as unknown as ResolvedEntities['organisation'];

const mockFacility = {
  id: 'facility-1',
  name: 'Test Facility',
  description: 'A test facility',
  tenantId: 'tenant-1',
  location: {
    address: {
      streetAddress: '123 Factory Lane',
      postalCode: '3000',
      addressLocality: 'Melbourne',
      addressRegion: 'VIC',
      addressCountry: 'AU',
    },
    plusCode: '4RJ75MH2+XP',
    geoLocation: { type: 'Point', coordinates: [144.9631, -37.8136] },
  },
  primaryIdentifier: {
    id: 'id-2',
    value: '9876543210',
    scheme: {
      id: 'scheme-2',
      primaryKey: 'gs1:gln',
      name: 'Global Location Number (GLN)',
      linkTemplate: '/{primaryKey}/{value}',
    },
  },
} as unknown as ResolvedEntities['facility'];

const mockProduct = {
  id: 'product-1',
  name: 'Test Product',
  description: 'A test product',
  tenantId: 'tenant-1',
  level: 'MODEL',
  batchNumber: null,
  serialNumber: null,
  primaryIdentifier: {
    id: 'id-3',
    value: '01234567890123',
    scheme: { id: 'scheme-3', primaryKey: 'gs1:gtin', name: 'GTIN', linkTemplate: '/{primaryKey}/{value}' },
  },
} as unknown as ResolvedEntities['product'];

// -- Tests --------------------------------------------------------------------

describe('DppV061Mapper', () => {
  const mapper = new DppV061Mapper();
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

      expect(result['@context']).toEqual(['https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/']);
    });

    it('merges extension context URL into @context when extension is present', async () => {
      const configWithExt: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDataModel,
      };

      const result = await mapper.buildPayload(fullEntities, configWithExt);

      expect(result['@context']).toEqual([
        'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/',
        'https://example.org/aus-agri/v1/',
      ]);
    });

    it('returns type array containing the core credentialType', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);

      expect(result.type).toEqual(['DigitalProductPassport']);
    });

    it('deduplicates type when extension has the same credentialType as core', async () => {
      const configWithExt: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDataModel,
      };

      const result = await mapper.buildPayload(fullEntities, configWithExt);

      expect(result.type).toEqual(['DigitalProductPassport']);
    });

    it('includes both types when extension has a different credentialType', async () => {
      const configWithDifferentType: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDifferentType,
      };

      const result = await mapper.buildPayload(fullEntities, configWithDifferentType);

      expect(result['@context']).toEqual([
        'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/',
        'https://example.org/conformity-ext/v1/',
      ]);
      expect(result.type).toEqual(['DigitalProductPassport', 'DigitalConformityCredential']);
    });

    // -- buildPayload: credentialSubject type ----------------------------------

    it('sets credentialSubject.type to ProductPassport', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.type).toEqual(['ProductPassport']);
    });

    // -- buildPayload: credentialSubject.product ------------------------------

    it('maps product data into credentialSubject.product', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const product = subject.product as Record<string, unknown>;

      expect(product).toMatchObject({
        type: ['Product'],
        id: 'product-1',
        name: 'Test Product',
        description: 'A test product',
      });
    });

    // -- buildPayload: registeredId and idScheme ------------------------------

    it('includes registeredId and idScheme when primaryIdentifier is present', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const product = subject.product as Record<string, unknown>;

      expect(product.registeredId).toBe('01234567890123');
      expect(product.idScheme).toEqual({
        type: ['IdentifierScheme'],
        id: 'scheme-3',
        name: 'GTIN',
      });
    });

    it('omits registeredId and idScheme when primaryIdentifier is absent', async () => {
      const entitiesWithoutProductIdentifier: ResolvedEntities = {
        organisation: mockOrganisation,
        facility: mockFacility,
        product: {
          ...mockProduct!,
          primaryIdentifier: null,
        } as unknown as ResolvedEntities['product'],
      };

      const result = await mapper.buildPayload(entitiesWithoutProductIdentifier, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const product = subject.product as Record<string, unknown>;

      expect(product.registeredId).toBeUndefined();
      expect(product.idScheme).toBeUndefined();
    });

    // -- buildPayload: batchNumber and serialNumber ---------------------------

    it('includes batchNumber when present on product', async () => {
      const productWithBatch: ResolvedEntities = {
        ...fullEntities,
        product: {
          ...mockProduct!,
          level: 'BATCH',
          batchNumber: 'BATCH-2024-001',
        } as unknown as ResolvedEntities['product'],
      };

      const result = await mapper.buildPayload(productWithBatch, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const product = subject.product as Record<string, unknown>;

      expect(product.batchNumber).toBe('BATCH-2024-001');
      expect(subject.granularityLevel).toBe('batch');
    });

    it('includes serialNumber when present on product', async () => {
      const productWithSerial: ResolvedEntities = {
        ...fullEntities,
        product: {
          ...mockProduct!,
          level: 'ITEM',
          serialNumber: 'SN-12345678',
        } as unknown as ResolvedEntities['product'],
      };

      const result = await mapper.buildPayload(productWithSerial, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const product = subject.product as Record<string, unknown>;

      expect(product.serialNumber).toBe('SN-12345678');
      expect(subject.granularityLevel).toBe('item');
    });

    it('omits batchNumber and serialNumber when null', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const product = subject.product as Record<string, unknown>;

      expect(product.batchNumber).toBeUndefined();
      expect(product.serialNumber).toBeUndefined();
    });

    // -- buildPayload: producedByParty ----------------------------------------

    it('maps organisation to producedByParty with description and idScheme', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const product = subject.product as Record<string, unknown>;
      const party = product.producedByParty as Record<string, unknown>;

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

    // -- buildPayload: producedAtFacility -------------------------------------

    it('maps facility to producedAtFacility with description, idScheme, location, and address', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const product = subject.product as Record<string, unknown>;
      const facilityRef = product.producedAtFacility as Record<string, unknown>;

      expect(facilityRef).toEqual({
        id: 'facility-1',
        name: 'Test Facility',
        description: 'A test facility',
        registeredId: '9876543210',
        idScheme: {
          type: ['IdentifierScheme'],
          id: 'scheme-2',
          name: 'Global Location Number (GLN)',
        },
        locationInformation: {
          type: ['Location'],
          plusCode: '4RJ75MH2+XP',
          geoLocation: { type: 'Point', coordinates: [144.9631, -37.8136] },
        },
        address: {
          type: ['Address'],
          streetAddress: '123 Factory Lane',
          postalCode: '3000',
          addressLocality: 'Melbourne',
          addressRegion: 'VIC',
          addressCountry: 'AU',
        },
      });
    });

    it('omits locationInformation when facility has no geo data', async () => {
      const facilityNoGeo: ResolvedEntities = {
        ...fullEntities,
        facility: {
          ...mockFacility!,
          location: {
            address: { streetAddress: '123 Factory Lane' },
          },
        } as unknown as ResolvedEntities['facility'],
      };

      const result = await mapper.buildPayload(facilityNoGeo, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const product = subject.product as Record<string, unknown>;
      const facilityRef = product.producedAtFacility as Record<string, unknown>;

      expect(facilityRef.locationInformation).toBeUndefined();
      expect(facilityRef.address).toEqual({
        type: ['Address'],
        streetAddress: '123 Factory Lane',
      });
    });

    it('omits address when facility location has no address', async () => {
      const facilityNoAddress: ResolvedEntities = {
        ...fullEntities,
        facility: {
          ...mockFacility!,
          location: {
            geoLocation: { type: 'Point', coordinates: [144.9631, -37.8136] },
          },
        } as unknown as ResolvedEntities['facility'],
      };

      const result = await mapper.buildPayload(facilityNoAddress, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const product = subject.product as Record<string, unknown>;
      const facilityRef = product.producedAtFacility as Record<string, unknown>;

      expect(facilityRef.address).toBeUndefined();
      expect(facilityRef.locationInformation).toEqual({
        type: ['Location'],
        geoLocation: { type: 'Point', coordinates: [144.9631, -37.8136] },
      });
    });

    it('omits both location and address when facility has no location data', async () => {
      const facilityNoLocation: ResolvedEntities = {
        ...fullEntities,
        facility: {
          ...mockFacility!,
          location: null,
        } as unknown as ResolvedEntities['facility'],
      };

      const result = await mapper.buildPayload(facilityNoLocation, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const product = subject.product as Record<string, unknown>;
      const facilityRef = product.producedAtFacility as Record<string, unknown>;

      expect(facilityRef.locationInformation).toBeUndefined();
      expect(facilityRef.address).toBeUndefined();
    });

    // -- buildPayload: granularityLevel ---------------------------------------

    it('maps product.level to credentialSubject.granularityLevel (lowercased)', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.granularityLevel).toBe('model');
    });
  });

  // -- extractEntityRefs ------------------------------------------------------

  describe('extractEntityRefs', () => {
    const stubContext = ['https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/'];
    const stubType = ['DigitalProductPassport'];

    it('extracts registered IDs from a valid payload', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['ProductPassport'],
          product: {
            registeredId: '01234567890123',
            producedByParty: { registeredId: '1234567890' },
            producedAtFacility: { registeredId: '9876543210' },
          },
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({
        product: { registeredId: '01234567890123' },
        organisation: { registeredId: '1234567890' },
        facility: { registeredId: '9876543210' },
      });
    });

    it('includes batchNumber and serialNumber as qualifiers when present', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['ProductPassport'],
          product: {
            registeredId: '01234567890123',
            batchNumber: 'BATCH-001',
            serialNumber: 'SN-999',
            producedByParty: { registeredId: '1234567890' },
            producedAtFacility: { registeredId: '9876543210' },
          },
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs.product).toEqual({
        registeredId: '01234567890123',
        batchNumber: 'BATCH-001',
        serialNumber: 'SN-999',
      });
    });

    it('returns empty object when product is missing from credentialSubject', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: { type: ['ProductPassport'] },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({});
    });

    it('returns empty object when product has no registeredId', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['ProductPassport'],
          product: {
            name: 'Some product',
            producedByParty: { name: 'Some org' },
          },
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({});
    });
  });

  // -- Self-registration ------------------------------------------------------

  describe('self-registration', () => {
    it('registers itself in the mapper registry as DigitalProductPassport / 0.6.1', () => {
      const registered = getMapper('DigitalProductPassport', '0.6.1');
      expect(registered).toBeDefined();
      expect(registered).toBeInstanceOf(DppV061Mapper);
    });
  });
});
