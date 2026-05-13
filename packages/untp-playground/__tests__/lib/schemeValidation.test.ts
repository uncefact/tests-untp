import { detectSchemeVersion, schemeSchemaUrl } from '@/lib/schemeValidation';

describe('schemeValidation', () => {
  describe('schemeSchemaUrl', () => {
    it('builds the published cvc schema URL for a version', () => {
      expect(schemeSchemaUrl('0.7.0')).toBe('https://untp.unece.org/artefacts/schema/v0.7.0/cvc/ConformityScheme.json');
    });
  });

  describe('detectSchemeVersion', () => {
    it('extracts the version from the UNTP vocabulary.uncefact.org context URI', () => {
      const scheme = {
        '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
        type: ['ConformityScheme'],
      };
      expect(detectSchemeVersion(scheme)).toBe('0.7.0');
    });

    it('extracts the version from a test.uncefact.org context URI', () => {
      const scheme = {
        '@context': ['https://test.uncefact.org/vocabulary/untp/cs/0.6.0/'],
        type: ['ConformityScheme'],
      };
      expect(detectSchemeVersion(scheme)).toBe('0.6.0');
    });

    it('returns null when no UNTP context entry is present', () => {
      const scheme = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['ConformityScheme'],
      };
      expect(detectSchemeVersion(scheme)).toBeNull();
    });

    it('returns null when @context is not an array', () => {
      expect(detectSchemeVersion({ '@context': 'not-an-array' })).toBeNull();
    });

    it('ignores non-string context entries', () => {
      const scheme = {
        '@context': [{ inline: 'definition' }, 'https://vocabulary.uncefact.org/untp/0.7.1/context/'],
        type: ['ConformityScheme'],
      };
      expect(detectSchemeVersion(scheme)).toBe('0.7.1');
    });
  });
});
