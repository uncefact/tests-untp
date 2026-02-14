import { verifyResolverDescription, verifyUntpLinkTypes } from './idr-verification';
import type { ResolverDescription, LinkType } from '../../interfaces/identityResolverService';

describe('IDR verification utilities', () => {
  describe('verifyResolverDescription', () => {
    it('should return true for a valid resolver description', () => {
      const description: ResolverDescription = {
        name: 'Pyx IDR',
        supportedLinkTypes: [],
      };
      expect(verifyResolverDescription(description)).toBe(true);
    });

    it('should return false when name is empty', () => {
      const description: ResolverDescription = {
        name: '',
        supportedLinkTypes: [],
      };
      expect(verifyResolverDescription(description)).toBe(false);
    });

    it('should return false when name is not a string', () => {
      const description = {
        name: 123,
        supportedLinkTypes: [],
      } as unknown as ResolverDescription;
      expect(verifyResolverDescription(description)).toBe(false);
    });

    it('should return true with additional metadata fields', () => {
      const description: ResolverDescription = {
        name: 'My Resolver',
        supportedLinkTypes: [],
        version: '1.0.0',
        region: 'AU',
      };
      expect(verifyResolverDescription(description)).toBe(true);
    });
  });

  describe('verifyUntpLinkTypes', () => {
    const allRequiredTypes: LinkType[] = [
      { namespace: 'untp', type: 'dpp', title: 'Digital Product Passport' },
      { namespace: 'untp', type: 'dcc', title: 'Digital Conformity Credential' },
      { namespace: 'untp', type: 'dte', title: 'Digital Traceability Event' },
      { namespace: 'untp', type: 'idr', title: 'Identity Resolver' },
    ];

    it('should return no warnings when all required link types are present', () => {
      const warnings = verifyUntpLinkTypes(allRequiredTypes);
      expect(warnings).toEqual([]);
    });

    it('should return warnings for missing link types', () => {
      const partialTypes: LinkType[] = [{ namespace: 'untp', type: 'dpp', title: 'Digital Product Passport' }];

      const warnings = verifyUntpLinkTypes(partialTypes);
      expect(warnings).toHaveLength(3);
      expect(warnings.every((w) => w.type === 'missing_link_type')).toBe(true);
    });

    it('should return 4 warnings when no link types are registered', () => {
      const warnings = verifyUntpLinkTypes([]);
      expect(warnings).toHaveLength(4);
    });

    it('should include the missing type name in the warning message', () => {
      const warnings = verifyUntpLinkTypes([]);
      expect(warnings[0].message).toContain('untp:dpp');
      expect(warnings[1].message).toContain('untp:dcc');
      expect(warnings[2].message).toContain('untp:dte');
      expect(warnings[3].message).toContain('untp:idr');
    });

    it('should not flag non-UNTP link types as missing', () => {
      const customTypes: LinkType[] = [
        ...allRequiredTypes,
        { namespace: 'gs1', type: 'pip', title: 'Product Information Page' },
      ];

      const warnings = verifyUntpLinkTypes(customTypes);
      expect(warnings).toEqual([]);
    });

    it('should correctly match namespace:type format', () => {
      // Types with correct namespace but wrong names should still match
      const types: LinkType[] = [
        { namespace: 'untp', type: 'dpp', title: 'Custom Title' },
        { namespace: 'untp', type: 'dcc', title: 'Custom Title' },
        { namespace: 'untp', type: 'dte', title: 'Custom Title' },
        { namespace: 'untp', type: 'idr', title: 'Custom Title' },
      ];

      const warnings = verifyUntpLinkTypes(types);
      expect(warnings).toEqual([]);
    });
  });
});
