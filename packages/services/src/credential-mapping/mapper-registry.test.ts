import { registerMapper, getMapper, listRegisteredMappers, clearRegistry } from './mapper-registry';
import { ICredentialMapper } from './types';

// -- Helpers ------------------------------------------------------------------

function createMockMapper(label = 'mock'): ICredentialMapper {
  return {
    buildPayload: jest.fn().mockResolvedValue({ _label: label }),
    extractEntityRefs: jest.fn().mockReturnValue({}),
  };
}

// -- Tests --------------------------------------------------------------------

describe('mapper-registry', () => {
  afterEach(() => {
    clearRegistry();
  });

  // -- getMapper --------------------------------------------------------------

  describe('getMapper', () => {
    it('returns undefined for a completely unknown credential type', () => {
      expect(getMapper('UnknownType', '0.6.0')).toBeUndefined();
    });

    it('returns undefined for an unknown version of a registered type', () => {
      registerMapper('DigitalProductPassport', '0.6.0', createMockMapper());

      expect(getMapper('DigitalProductPassport', '999.0.0')).toBeUndefined();
    });

    it('returns the mapper after it has been registered', () => {
      const mapper = createMockMapper('dpp-0.6');
      registerMapper('DigitalProductPassport', '0.6.0', mapper);

      expect(getMapper('DigitalProductPassport', '0.6.0')).toBe(mapper);
    });
  });

  // -- registerMapper ---------------------------------------------------------

  describe('registerMapper', () => {
    it('overwrites an existing mapper for the same type + version', () => {
      const original = createMockMapper('original');
      const replacement = createMockMapper('replacement');

      registerMapper('DigitalProductPassport', '0.6.0', original);
      registerMapper('DigitalProductPassport', '0.6.0', replacement);

      expect(getMapper('DigitalProductPassport', '0.6.0')).toBe(replacement);
    });
  });

  // -- listRegisteredMappers --------------------------------------------------

  describe('listRegisteredMappers', () => {
    it('returns an empty array when nothing is registered', () => {
      expect(listRegisteredMappers()).toEqual([]);
    });

    it('returns all registered type + version combinations', () => {
      registerMapper('DigitalProductPassport', '0.6.0', createMockMapper());
      registerMapper('DigitalConformityCredential', '0.6.0', createMockMapper());
      registerMapper('DigitalProductPassport', '0.7.0', createMockMapper());

      const result = listRegisteredMappers();

      expect(result).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining([
          { credentialType: 'DigitalProductPassport', version: '0.6.0' },
          { credentialType: 'DigitalProductPassport', version: '0.7.0' },
          { credentialType: 'DigitalConformityCredential', version: '0.6.0' },
        ]),
      );
    });
  });
});
