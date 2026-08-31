import { getBridge, listRegisteredVersions } from './bridge-registry.js';
import { createBridgeEntities, createFacility, createOrganisation, createProduct } from './__fixtures__/entities.js';

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
  });

  describe('listRegisteredVersions', () => {
    it('lists every version getBridge can resolve for a registered type', () => {
      const versions = listRegisteredVersions('DigitalProductPassport');

      expect(versions).toEqual(expect.arrayContaining(['0.6.0', '0.6.1', '0.7.0']));
      for (const version of versions) {
        expect(getBridge('DigitalProductPassport', version)).toBeDefined();
      }
    });

    it('returns an empty list for an unknown type rather than inventing versions', () => {
      expect(listRegisteredVersions('UnknownType')).toEqual([]);
    });
  });

  describe('getBridge subject extraction', () => {
    it.each(['0.6.0', '0.6.1'])(
      'DPP %s extracts product.id and product.name from a builder-produced subject',
      (version) => {
        const bridge = getBridge('DigitalProductPassport', version)!;
        const subject = bridge.buildSubject(
          createBridgeEntities({
            product: createProduct({ id: 'did:web:example.com:product:1', name: 'My Product' }),
          }),
        );

        expect(bridge.extractSubjectSummary(subject)).toEqual({
          id: 'did:web:example.com:product:1',
          name: 'My Product',
        });
      },
    );

    it.each(['0.6.0', '0.6.1'])(
      'DFR %s extracts facility.id and facility.name from a builder-produced subject',
      (version) => {
        const bridge = getBridge('DigitalFacilityRecord', version)!;
        const subject = bridge.buildSubject(
          createBridgeEntities({
            facility: createFacility({ id: 'did:web:example.com:facility:1', name: 'My Facility' }),
          }),
        );

        expect(bridge.extractSubjectSummary(subject)).toEqual({
          id: 'did:web:example.com:facility:1',
          name: 'My Facility',
        });
      },
    );

    it('DIA 0.7.0 extracts id and registeredName from a builder-produced subject', () => {
      const bridge = getBridge('DigitalIdentityAnchor', '0.7.0')!;
      const subject = bridge.buildSubject(
        createBridgeEntities({
          organisation: createOrganisation({ id: 'did:web:example.com:org:1', name: 'ACME Corp' }),
        }),
      );

      expect(bridge.extractSubjectSummary(subject)).toEqual({
        id: 'did:web:example.com:org:1',
        name: 'ACME Corp',
      });
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
