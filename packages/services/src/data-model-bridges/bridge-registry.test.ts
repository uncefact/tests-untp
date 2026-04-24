import { getBridge } from './bridge-registry.js';

describe('bridge-registry', () => {
  describe('getBridge', () => {
    it.each([
      'DigitalProductPassport',
      'DigitalConformityCredential',
      'DigitalFacilityRecord',
      'DigitalIdentityAnchor',
      'DigitalTraceabilityEvent',
    ])('returns a bridge for %s at version 0.6.0', (dataModelType) => {
      expect(getBridge(dataModelType, '0.6.0')).toBeDefined();
    });

    it.each([
      'DigitalProductPassport',
      'DigitalConformityCredential',
      'DigitalFacilityRecord',
      'DigitalIdentityAnchor',
      'DigitalTraceabilityEvent',
    ])('returns a bridge for %s at version 0.6.1', (dataModelType) => {
      expect(getBridge(dataModelType, '0.6.1')).toBeDefined();
    });

    it.each([
      'DigitalProductPassport',
      'DigitalConformityCredential',
      'DigitalFacilityRecord',
      'DigitalIdentityAnchor',
      'DigitalTraceabilityEvent',
    ])('returns a bridge for %s at version 0.7.0', (dataModelType) => {
      expect(getBridge(dataModelType, '0.7.0')).toBeDefined();
    });

    it('returns undefined for an unknown type', () => {
      expect(getBridge('UnknownType', '0.6.0')).toBeUndefined();
    });

    it('returns undefined for an unknown version', () => {
      expect(getBridge('DigitalProductPassport', '999.0.0')).toBeUndefined();
    });

    it.each([
      'DigitalProductPassport',
      'DigitalConformityCredential',
      'DigitalFacilityRecord',
      'DigitalIdentityAnchor',
      'DigitalTraceabilityEvent',
    ])('each bridge for %s has buildSubject and extractRefs methods', (dataModelType) => {
      const bridge060 = getBridge(dataModelType, '0.6.0');
      const bridge061 = getBridge(dataModelType, '0.6.1');
      const bridge070 = getBridge(dataModelType, '0.7.0');

      expect(bridge060).toHaveProperty('buildSubject');
      expect(bridge060).toHaveProperty('extractRefs');
      expect(typeof bridge060!.buildSubject).toBe('function');
      expect(typeof bridge060!.extractRefs).toBe('function');

      expect(bridge061).toHaveProperty('buildSubject');
      expect(bridge061).toHaveProperty('extractRefs');
      expect(typeof bridge061!.buildSubject).toBe('function');
      expect(typeof bridge061!.extractRefs).toBe('function');

      expect(bridge070).toHaveProperty('buildSubject');
      expect(bridge070).toHaveProperty('extractRefs');
      expect(typeof bridge070!.buildSubject).toBe('function');
      expect(typeof bridge070!.extractRefs).toBe('function');
    });
  });
});
