import { getMapper } from './mapper-registry';

describe('mapper-registry', () => {
  describe('getMapper', () => {
    it.each([
      'DigitalProductPassport',
      'DigitalConformityCredential',
      'DigitalFacilityRecord',
      'DigitalIdentityAnchor',
      'DigitalTraceabilityEvent',
    ])('returns a mapper for %s at version 0.6.1', (credentialType) => {
      expect(getMapper(credentialType, '0.6.1')).toBeDefined();
    });

    it('returns undefined for an unknown credential type', () => {
      expect(getMapper('UnknownType', '0.6.1')).toBeUndefined();
    });

    it('returns undefined for an unknown version', () => {
      expect(getMapper('DigitalProductPassport', '999.0.0')).toBeUndefined();
    });
  });
});
