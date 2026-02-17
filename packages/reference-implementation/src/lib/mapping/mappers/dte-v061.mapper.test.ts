import { DteV061Mapper } from './dte-v061.mapper';
import { getMapper } from '../mapper-registry';
import { ResolvedEntities, DataModelConfig, MapperOutput } from '../types';

// -- Mock data model configs --------------------------------------------------

const mockCoreDataModel = {
  id: 'dm-core-dte',
  tenantId: null,
  name: 'Digital Traceability Event v0.6.1',
  credentialType: 'DigitalTraceabilityEvent',
  version: '0.6.1',
  isExtension: false,
  parentConfigId: null,
  parentConfig: null,
  extensions: [],
  renderTemplates: [],
  schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dte/0.6.1/schema.json',
  contextUrl: 'https://test.uncefact.org/vocabulary/untp/dte/0.6.1/',
  websiteUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as DataModelConfig['core'];

const mockExtensionDataModel = {
  id: 'dm-ext-dte',
  tenantId: 'tenant-1',
  name: 'Custom Traceability Extension',
  credentialType: 'DigitalTraceabilityEvent',
  version: '0.6.1',
  isExtension: true,
  parentConfigId: 'dm-core-dte',
  parentConfig: mockCoreDataModel,
  extensions: [],
  renderTemplates: [],
  schemaUrl: 'https://example.org/traceability-ext/v1/schema.json',
  contextUrl: 'https://example.org/traceability-ext/v1/',
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

describe('DteV061Mapper', () => {
  const mapper = new DteV061Mapper();
  const coreConfig: DataModelConfig = { core: mockCoreDataModel };

  const fullEntities: ResolvedEntities = {
    organisation: mockOrganisation,
    product: mockProduct,
  };

  // -- buildPayload: @context and type ----------------------------------------

  describe('buildPayload', () => {
    it('returns @context array containing the core context URL', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);

      expect(result['@context']).toEqual(['https://test.uncefact.org/vocabulary/untp/dte/0.6.1/']);
    });

    it('merges extension context URL into @context when extension is present', async () => {
      const configWithExt: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDataModel,
      };

      const result = await mapper.buildPayload(fullEntities, configWithExt);

      expect(result['@context']).toEqual([
        'https://test.uncefact.org/vocabulary/untp/dte/0.6.1/',
        'https://example.org/traceability-ext/v1/',
      ]);
    });

    it('returns type array containing the core credentialType', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);

      expect(result.type).toEqual(['DigitalTraceabilityEvent']);
    });

    it('deduplicates type when extension has the same credentialType as core', async () => {
      const configWithExt: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDataModel,
      };

      const result = await mapper.buildPayload(fullEntities, configWithExt);

      expect(result.type).toEqual(['DigitalTraceabilityEvent']);
    });

    // -- buildPayload: credentialSubject type ----------------------------------

    it('sets credentialSubject.type to Event', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.type).toEqual(['Event']);
    });

    // -- buildPayload: epcList ------------------------------------------------

    it('maps product to an Item in epcList', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;
      const epcList = subject.epcList as Record<string, unknown>[];

      expect(epcList).toHaveLength(1);
      expect(epcList[0]).toEqual({
        type: ['Item'],
        id: 'product-1',
        name: 'Test Product',
      });
    });

    it('omits epcList when product is undefined', async () => {
      const entitiesNoProduct: ResolvedEntities = {
        organisation: mockOrganisation,
      };

      const result = await mapper.buildPayload(entitiesNoProduct, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.epcList).toBeUndefined();
    });
  });

  // -- extractEntityRefs ------------------------------------------------------

  describe('extractEntityRefs', () => {
    const stubContext = ['https://test.uncefact.org/vocabulary/untp/dte/0.6.1/'];
    const stubType = ['DigitalTraceabilityEvent'];

    it('extracts product id from the first item in epcList', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['Event'],
          epcList: [{ type: ['Item'], id: 'product-1', name: 'Test Product' }],
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({
        product: { registeredId: 'product-1' },
      });
    });

    it('returns empty object when epcList is missing', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: { type: ['Event'] },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({});
    });

    it('returns empty object when epcList is empty', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['Event'],
          epcList: [],
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({});
    });
  });

  // -- Self-registration ------------------------------------------------------

  describe('self-registration', () => {
    it('registers itself in the mapper registry as DigitalTraceabilityEvent / 0.6.1', () => {
      const registered = getMapper('DigitalTraceabilityEvent', '0.6.1');
      expect(registered).toBeDefined();
      expect(registered).toBeInstanceOf(DteV061Mapper);
    });
  });
});
