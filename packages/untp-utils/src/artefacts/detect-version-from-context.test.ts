import { detectVersionFromContext } from './detect-version-from-context.js';

describe('detectVersionFromContext', () => {
  describe('UNTP context detection (default domain set)', () => {
    it('returns the version from a single string @context', () => {
      const doc = { '@context': 'https://vocabulary.uncefact.org/untp/0.7.0/context/' };
      expect(detectVersionFromContext(doc)).toBe('0.7.0');
    });

    it('returns the version when @context is an array including the UNTP context', () => {
      const doc = {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://vocabulary.uncefact.org/untp/0.7.0/context/'],
      };
      expect(detectVersionFromContext(doc)).toBe('0.7.0');
    });

    it('recognises pre-release versions', () => {
      const doc = { '@context': 'https://vocabulary.uncefact.org/untp/0.7.0-rc.1/context/' };
      expect(detectVersionFromContext(doc)).toBe('0.7.0-rc.1');
    });

    it('returns the version when it is the terminal path segment without a trailing slash', () => {
      const doc = { '@context': 'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0' };
      expect(detectVersionFromContext(doc)).toBe('0.5.0');
    });

    it('recognises a terminal pre-release version without a trailing slash', () => {
      const doc = { '@context': 'https://vocabulary.uncefact.org/untp/0.7.0-rc.1' };
      expect(detectVersionFromContext(doc)).toBe('0.7.0-rc.1');
    });

    it('uses the first version-shaped path segment', () => {
      // The first version-shaped segment wins when a later path segment also looks like a version.
      const doc = { '@context': 'https://vocabulary.uncefact.org/untp/0.6.0/dpp/0.7.0/' };
      expect(detectVersionFromContext(doc)).toBe('0.6.0');
    });

    it('ignores a version-shaped path in a query', () => {
      const doc = { '@context': 'https://vocabulary.uncefact.org/untp/context?path=/0.7.0' };
      expect(detectVersionFromContext(doc)).toBeUndefined();
    });

    it('ignores a version-shaped path in a fragment', () => {
      const doc = { '@context': 'https://vocabulary.uncefact.org/untp/context#path=/0.7.0' };
      expect(detectVersionFromContext(doc)).toBeUndefined();
    });

    it('uses a genuine pathname version after a query-only context entry', () => {
      const doc = {
        '@context': [
          'https://vocabulary.uncefact.org/untp/context?path=/0.7.0',
          'https://vocabulary.uncefact.org/untp/0.6.0/context/',
        ],
      };
      expect(detectVersionFromContext(doc)).toBe('0.6.0');
    });

    it('recognises a version bounded by a query string', () => {
      const doc = { '@context': 'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0?format=json' };
      expect(detectVersionFromContext(doc)).toBe('0.5.0');
    });

    it('recognises a version bounded by a fragment', () => {
      const doc = { '@context': 'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0#context' };
      expect(detectVersionFromContext(doc)).toBe('0.5.0');
    });

    it('rejects a version with a trailing dot', () => {
      const doc = { '@context': 'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0./' };
      expect(detectVersionFromContext(doc)).toBeUndefined();
    });

    it('rejects a four-part version', () => {
      const doc = { '@context': 'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0.1/' };
      expect(detectVersionFromContext(doc)).toBeUndefined();
    });

    it('does not detect a filename-shaped version on an unrelated domain', () => {
      const doc = { '@context': 'https://example.org/untp/0.5.0-rc.1.jsonld' };
      expect(detectVersionFromContext(doc)).toBeUndefined();
    });

    it('keeps the complete filename-shaped suffix when the domain is recognised', () => {
      // SemVer permits dotted prerelease identifiers, so the detector cannot tell a filename extension from a prerelease part; no published UNTP context has this shape.
      const doc = { '@context': 'https://vocabulary.uncefact.org/untp/0.5.0-rc.1.jsonld' };
      expect(detectVersionFromContext(doc)).toBe('0.5.0-rc.1.jsonld');
    });

    it('recognises the test.uncefact.org domain', () => {
      const doc = { '@context': 'https://test.uncefact.org/untp/0.7.0/context/' };
      expect(detectVersionFromContext(doc)).toBe('0.7.0');
    });

    it('returns undefined for non-UNTP context domains', () => {
      const doc = { '@context': ['https://schema.org/', 'https://example.com/0.7.0/'] };
      expect(detectVersionFromContext(doc)).toBeUndefined();
    });

    it('does not recognise a filename-embedded version', () => {
      const doc = { '@context': 'https://aatp.foodagility.com/context/aatp-dlp-context-0.4.0.jsonld' };
      expect(detectVersionFromContext(doc, { domain: 'aatp.foodagility.com' })).toBeUndefined();
    });

    it('skips non-string entries within an array @context', () => {
      const doc = {
        '@context': [{ '@vocab': 'https://example.com/' }, 'https://vocabulary.uncefact.org/untp/0.7.0/context/'],
      };
      expect(detectVersionFromContext(doc)).toBe('0.7.0');
    });
  });

  describe('domain-scoped detection', () => {
    it('finds the version under a caller-supplied domain (extension context)', () => {
      const doc = {
        '@context': [
          'https://www.w3.org/ns/credentials/v2',
          'https://vocabulary.uncefact.org/untp/0.7.0/context/',
          'https://aatp.example.com/untp/0.5.0/context/',
        ],
      };
      expect(detectVersionFromContext(doc, { domain: 'aatp.example.com' })).toBe('0.5.0');
    });

    it('returns undefined when no context matches the supplied domain', () => {
      const doc = {
        '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
      };
      expect(detectVersionFromContext(doc, { domain: 'nope.example.com' })).toBeUndefined();
    });
  });

  describe('input handling', () => {
    it('returns undefined when @context is missing', () => {
      expect(detectVersionFromContext({})).toBeUndefined();
    });

    it('returns undefined for non-object input', () => {
      expect(detectVersionFromContext(null)).toBeUndefined();
      expect(detectVersionFromContext(undefined)).toBeUndefined();
      expect(detectVersionFromContext('a string')).toBeUndefined();
      expect(detectVersionFromContext(42)).toBeUndefined();
    });
  });

  describe('regex robustness', () => {
    it('ignores version-like substrings outside a path segment', () => {
      const doc = { '@context': 'https://vocabulary.uncefact.org/untp/context?v=1.2.3' };
      expect(detectVersionFromContext(doc)).toBeUndefined();
    });
  });
});
