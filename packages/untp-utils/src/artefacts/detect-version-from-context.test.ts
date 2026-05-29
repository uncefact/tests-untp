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

    it('recognises the test.uncefact.org domain', () => {
      const doc = { '@context': 'https://test.uncefact.org/untp/0.7.0/context/' };
      expect(detectVersionFromContext(doc)).toBe('0.7.0');
    });

    it('returns undefined for non-UNTP context domains', () => {
      const doc = { '@context': ['https://schema.org/', 'https://example.com/0.7.0/'] };
      expect(detectVersionFromContext(doc)).toBeUndefined();
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
