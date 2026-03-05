import { DteV060Mapper } from './v060.mapper';
import type { ResolvedEntities, DataModelConfig, MapperOutput } from '../../types';

// -- Mock data model configs --------------------------------------------------

const mockCoreDataModel: DataModelConfig['core'] = {
  contextUrl: 'https://test.uncefact.org/vocabulary/untp/dte/0.6.1/',
  credentialType: 'DigitalTraceabilityEvent',
};

const mockExtensionDataModel: DataModelConfig['extension'] = {
  contextUrl: 'https://example.org/traceability-ext/v1/',
  credentialType: 'DigitalTraceabilityEvent',
};

// -- Mock entities ------------------------------------------------------------

const mockProduct: ResolvedEntities['product'] = {
  id: 'product-1',
  name: 'Test Product',
  description: 'A test product',
  level: 'MODEL',
  primaryIdentifier: {
    value: '01234567890123',
    scheme: { id: 'scheme-3', name: 'GTIN' },
  },
};

// -- Tests --------------------------------------------------------------------

describe('DteV060Mapper', () => {
  const mapper = new DteV060Mapper();
  const coreConfig: DataModelConfig = { core: mockCoreDataModel };

  const fullEntities: ResolvedEntities = {
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
      const entitiesNoProduct: ResolvedEntities = {};

      const result = await mapper.buildPayload(entitiesNoProduct, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.epcList).toBeUndefined();
    });
  });

  // -- extractEntityRefs ------------------------------------------------------

  describe('extractEntityRefs', () => {
    const stubContext = ['https://test.uncefact.org/vocabulary/untp/dte/0.6.1/'];
    const stubType = ['DigitalTraceabilityEvent'];

    it('extracts product id from the first item in epcList and sets primaryIdentifier', () => {
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
        primaryIdentifier: 'product-1',
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
});
