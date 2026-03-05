import { DiaV060Mapper } from './v060.mapper';
import type { ResolvedEntities, DataModelConfig, MapperOutput } from '../../types';

// -- Mock data model configs --------------------------------------------------

const mockCoreDataModel: DataModelConfig['core'] = {
  contextUrl: 'https://test.uncefact.org/vocabulary/untp/dia/0.6.1/',
  credentialType: 'DigitalIdentityAnchor',
};

const mockExtensionDataModel: DataModelConfig['extension'] = {
  contextUrl: 'https://example.org/identity-ext/v1/',
  credentialType: 'DigitalIdentityAnchor',
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

// -- Tests --------------------------------------------------------------------

describe('DiaV060Mapper', () => {
  const mapper = new DiaV060Mapper();
  const coreConfig: DataModelConfig = { core: mockCoreDataModel };

  const fullEntities: ResolvedEntities = {
    organisation: mockOrganisation,
  };

  // -- buildPayload: @context and type ----------------------------------------

  describe('buildPayload', () => {
    it('returns @context array containing the core context URL', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);

      expect(result['@context']).toEqual(['https://test.uncefact.org/vocabulary/untp/dia/0.6.1/']);
    });

    it('merges extension context URL into @context when extension is present', async () => {
      const configWithExt: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDataModel,
      };

      const result = await mapper.buildPayload(fullEntities, configWithExt);

      expect(result['@context']).toEqual([
        'https://test.uncefact.org/vocabulary/untp/dia/0.6.1/',
        'https://example.org/identity-ext/v1/',
      ]);
    });

    it('returns type array containing the core credentialType', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);

      expect(result.type).toEqual(['DigitalIdentityAnchor']);
    });

    it('deduplicates type when extension has the same credentialType as core', async () => {
      const configWithExt: DataModelConfig = {
        core: mockCoreDataModel,
        extension: mockExtensionDataModel,
      };

      const result = await mapper.buildPayload(fullEntities, configWithExt);

      expect(result.type).toEqual(['DigitalIdentityAnchor']);
    });

    // -- buildPayload: credentialSubject type ----------------------------------

    it('sets credentialSubject.type to RegisteredIdentity', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.type).toEqual(['RegisteredIdentity']);
    });

    // -- buildPayload: organisation identity fields ----------------------------

    it('maps organisation identity directly to credentialSubject', async () => {
      const result = await mapper.buildPayload(fullEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.id).toBe('org-1');
      expect(subject.name).toBe('Test Organisation');
      expect(subject.registeredId).toBe('1234567890');
      expect(subject.idScheme).toEqual({
        type: ['IdentifierScheme'],
        id: 'scheme-1',
        name: 'Global Location Number (GLN)',
      });
    });

    it('omits registeredId and idScheme when organisation has no primaryIdentifier', async () => {
      const orgNoIdentifier: ResolvedEntities = {
        organisation: {
          ...mockOrganisation,
          primaryIdentifier: null,
        },
      };

      const result = await mapper.buildPayload(orgNoIdentifier, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.registeredId).toBeUndefined();
      expect(subject.idScheme).toBeUndefined();
    });

    it('handles undefined organisation gracefully', async () => {
      const emptyEntities: ResolvedEntities = {};

      const result = await mapper.buildPayload(emptyEntities, coreConfig);
      const subject = result.credentialSubject as Record<string, unknown>;

      expect(subject.id).toBeUndefined();
      expect(subject.name).toBeUndefined();
      expect(subject.registeredId).toBeUndefined();
    });
  });

  // -- extractEntityRefs ------------------------------------------------------

  describe('extractEntityRefs', () => {
    const stubContext = ['https://test.uncefact.org/vocabulary/untp/dia/0.6.1/'];
    const stubType = ['DigitalIdentityAnchor'];

    it('extracts organisation registeredId and sets primaryIdentifier', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['RegisteredIdentity'],
          registeredId: '1234567890',
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({
        primaryIdentifier: '1234567890',
        organisation: { registeredId: '1234567890' },
      });
    });

    it('returns empty object when registeredId is missing', () => {
      const payload: MapperOutput = {
        '@context': stubContext,
        type: stubType,
        credentialSubject: {
          type: ['RegisteredIdentity'],
          name: 'Some org',
        },
      };

      const refs = mapper.extractEntityRefs(payload);

      expect(refs).toEqual({});
    });
  });
});
