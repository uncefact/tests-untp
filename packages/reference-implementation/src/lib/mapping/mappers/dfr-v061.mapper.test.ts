import { DfrV061Mapper } from './dfr-v061.mapper';
import { getMapper } from '../mapper-registry';
import { ResolvedEntities, DataModelConfig, MapperOutput } from '../types';

// -- Mock data model configs --------------------------------------------------

const mockCoreDataModel = {
  id: 'dm-core-dfr',
  tenantId: null,
  name: 'Digital Facility Record v0.6.1',
  credentialType: 'DigitalFacilityRecord',
  version: '0.6.1',
  isExtension: false,
  parentConfigId: null,
  parentConfig: null,
  extensions: [],
  renderTemplates: [],
  schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dfr/0.6.1/schema.json',
  contextUrl: 'https://test.uncefact.org/vocabulary/untp/dfr/0.6.1/',
  websiteUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as DataModelConfig['core'];

const mockExtensionDataModel = {
  id: 'dm-ext-dfr',
  tenantId: 'tenant-1',
  name: 'Custom Facility Extension',
  credentialType: 'DigitalFacilityRecord',
  version: '0.6.1',
  isExtension: true,
  parentConfigId: 'dm-core-dfr',
  parentConfig: mockCoreDataModel,
  extensions: [],
  renderTemplates: [],
  schemaUrl: 'https://example.org/facility-ext/v1/schema.json',
  contextUrl: 'https://example.org/facility-ext/v1/',
  websiteUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
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

// -- Tests --------------------------------------------------------------------

describe('DfrV061Mapper', () => {
  const mapper = new DfrV061Mapper();
  const coreConfig: DataModelConfig = { core: mockCoreDataModel };

  const fullEntities: ResolvedEntities = {
    organisation: mockOrganisation,
    facility: mockFacility,
  };

  // -- buildPayload: @context and type ----------------------------------------

  describe('buildPayload', () => {
    it('returns @context array containing the core context URL', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);

      expect(result['@context']).toEqual(['https://test.uncefact.org/vocabulary/untp/dfr/0.6.1/']);
    });

    it('merges extension context URL into @context when extension is present', async () => {
      const configWithExt: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDataModel,
      };

      const result = await mapper.buildPayload(fullEntities, configWithExt);

      expect(result['@context']).toEqual([
        'https://test.uncefact.org/vocabulary/untp/dfr/0.6.1/',
        'https://example.org/facility-ext/v1/',
      ]);
    });

    it('returns type array containing the core credentialType', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);

      expect(result.type).toEqual(['DigitalFacilityRecord']);
    });

    it('deduplicates type when extension has the same credentialType as core', async () => {
      const configWithExt: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDataModel,
      };

      const result = await mapper.buildPayload(fullEntities, configWithExt);

      expect(result.type).toEqual(['DigitalFacilityRecord']);
    });

    // -- buildPayload: credentialSubject type ----------------------------------

    it('sets credentialSubject.type to FacilityRecord', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.type).toEqual(['FacilityRecord']);
    });

    // -- buildPayload: facility -----------------------------------------------

    it('maps facility data into credentialSubject.facility', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const facility = subject.facility as Record<string, unknown>;

      expect(facility).toMatchObject({
        type: ['Facility'],
        id: 'facility-1',
        name: 'Test Facility',
        description: 'A test facility',
        registeredId: '9876543210',
      });
    });

    it('includes idScheme when facility has primaryIdentifier', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const facility = subject.facility as Record<string, unknown>;

      expect(facility.idScheme).toEqual({
        type: ['IdentifierScheme'],
        id: 'scheme-2',
        name: 'Global Location Number (GLN)',
      });
    });

    it('omits registeredId and idScheme when facility has no primaryIdentifier', async () => {
      const facilityNoId: ResolvedEntities = {
        ...fullEntities,
        facility: {
          ...mockFacility!,
          primaryIdentifier: null,
        } as unknown as ResolvedEntities['facility'],
      };

      const result = await mapper.buildPayload(facilityNoId, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const facility = subject.facility as Record<string, unknown>;

      expect(facility.registeredId).toBeUndefined();
      expect(facility.idScheme).toBeUndefined();
    });

    // -- buildPayload: operatedByParty ----------------------------------------

    it('maps organisation to facility.operatedByParty with registeredId and idScheme', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const facility = subject.facility as Record<string, unknown>;
      const party = facility.operatedByParty as Record<string, unknown>;

      expect(party).toEqual({
        id: 'org-1',
        name: 'Test Organisation',
        registeredId: '1234567890',
        idScheme: {
          type: ['IdentifierScheme'],
          id: 'scheme-1',
          name: 'Global Location Number (GLN)',
        },
      });
    });

    // -- buildPayload: locationInformation and address ------------------------

    it('includes locationInformation with geo data', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const facility = subject.facility as Record<string, unknown>;

      expect(facility.locationInformation).toEqual({
        type: ['Location'],
        plusCode: '4RJ75MH2+XP',
        geoLocation: { type: 'Point', coordinates: [144.9631, -37.8136] },
      });
    });

    it('includes address from facility location', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const facility = subject.facility as Record<string, unknown>;

      expect(facility.address).toEqual({
        type: ['Address'],
        streetAddress: '123 Factory Lane',
        postalCode: '3000',
        addressLocality: 'Melbourne',
        addressRegion: 'VIC',
        addressCountry: 'AU',
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
      const facility = subject.facility as Record<string, unknown>;

      expect(facility.locationInformation).toBeUndefined();
      expect(facility.address).toEqual({
        type: ['Address'],
        streetAddress: '123 Factory Lane',
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
      const facility = subject.facility as Record<string, unknown>;

      expect(facility.locationInformation).toBeUndefined();
      expect(facility.address).toBeUndefined();
    });
  });

  // -- extractEntityRefs ------------------------------------------------------

  describe('extractEntityRefs', () => {
    const stubContext = ['https://test.uncefact.org/vocabulary/untp/dfr/0.6.1/'];
    const stubType = ['DigitalFacilityRecord'];

    it('extracts facility and organisation registeredIds', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['FacilityRecord'],
          facility: {
            registeredId: '9876543210',
            operatedByParty: { registeredId: '1234567890' },
          },
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({
        facility: { registeredId: '9876543210' },
        organisation: { registeredId: '1234567890' },
      });
    });

    it('returns empty object when facility is missing from credentialSubject', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: { type: ['FacilityRecord'] },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({});
    });

    it('returns empty object when facility has no registeredId', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['FacilityRecord'],
          facility: {
            name: 'Some facility',
            operatedByParty: { name: 'Some org' },
          },
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({});
    });
  });

  // -- Self-registration ------------------------------------------------------

  describe('self-registration', () => {
    it('registers itself in the mapper registry as DigitalFacilityRecord / 0.6.1', () => {
      const registered = getMapper('DigitalFacilityRecord', '0.6.1');
      expect(registered).toBeDefined();
      expect(registered).toBeInstanceOf(DfrV061Mapper);
    });
  });
});
