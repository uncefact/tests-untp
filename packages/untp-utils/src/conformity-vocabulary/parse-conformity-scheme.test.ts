import { ConformitySchemeError, ConformitySchemeParseError, ConformityUnsupportedSpecVersionError } from './errors.js';
import { parseConformityScheme } from './parse-conformity-scheme.js';

const UNTP_V070_CONTEXT = 'https://vocabulary.uncefact.org/untp/0.7.0/context/';

function minimalSchemeDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '@context': [UNTP_V070_CONTEXT],
    type: ['ConformityScheme'],
    id: 'https://example.com/scheme',
    name: 'Example Scheme',
    includedProfile: [],
    ...overrides,
  };
}

function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'https://example.com/scheme/full/1.0.0',
    name: 'Full',
    version: '1.0.0',
    status: 'active',
    criterion: [],
    ...overrides,
  };
}

function criterion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: ['Criterion'],
    id: 'https://example.com/criterion/forced-labour/1.0.0',
    name: 'Forced Labour',
    version: '1.0.0',
    status: 'active',
    ...overrides,
  };
}

describe('parseConformityScheme', () => {
  describe('version handling', () => {
    it('auto-detects 0.7.0 from the @context', () => {
      const scheme = parseConformityScheme(minimalSchemeDoc(), { sourceUrl: 'https://example.com/scheme' });
      expect(scheme.specVersion).toBe('0.7.0');
    });

    it('honours the specVersion override', () => {
      const doc = minimalSchemeDoc({ '@context': ['https://unknown.example/ctx'] });
      const scheme = parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme', specVersion: '0.7.0' });
      expect(scheme.specVersion).toBe('0.7.0');
    });

    it('throws ConformityUnsupportedSpecVersionError when version cannot be detected', () => {
      const doc = minimalSchemeDoc({ '@context': ['https://unknown.example/ctx'] });
      const error = (() => {
        try {
          parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityUnsupportedSpecVersionError);
      expect((error as ConformityUnsupportedSpecVersionError).received).toBe('undetected');
      expect((error as ConformityUnsupportedSpecVersionError).pointer).toBe('/@context');
    });

    it('throws ConformityUnsupportedSpecVersionError for a known-but-unsupported version', () => {
      const error = (() => {
        try {
          parseConformityScheme(minimalSchemeDoc(), {
            sourceUrl: 'https://example.com/scheme',
            specVersion: '99.0.0',
          });
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityUnsupportedSpecVersionError);
      expect((error as ConformityUnsupportedSpecVersionError).received).toBe('99.0.0');
    });
  });

  describe('happy path', () => {
    it('parses a minimal scheme with no profiles', () => {
      const scheme = parseConformityScheme(minimalSchemeDoc(), { sourceUrl: 'https://example.com/scheme' });
      expect(scheme).toMatchObject({
        canonicalId: 'https://example.com/scheme',
        sourceUrl: 'https://example.com/scheme',
        specVersion: '0.7.0',
        name: 'Example Scheme',
        profiles: [],
      });
    });

    it('parses a scheme with one profile and one criterion', () => {
      const doc = minimalSchemeDoc({ includedProfile: [profile({ criterion: [criterion()] })] });
      const scheme = parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
      expect(scheme.profiles).toHaveLength(1);
      expect(scheme.profiles[0].criteria[0].canonicalId).toBe('https://example.com/criterion/forced-labour/1.0.0');
    });

    it('parses inlined topic objects', () => {
      const doc = minimalSchemeDoc({
        includedProfile: [
          profile({
            criterion: [
              criterion({
                conformityTopic: [
                  {
                    type: ['ConformityTopic'],
                    id: 'https://vocabulary.uncefact.org/conformity-topics/forced-labor-elimination',
                    name: 'Forced Labor Elimination',
                    definition: 'A definition.',
                  },
                ],
              }),
            ],
          }),
        ],
      });
      const scheme = parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
      expect(scheme.profiles[0].criteria[0].topics).toEqual([
        {
          canonicalId: 'https://vocabulary.uncefact.org/conformity-topics/forced-labor-elimination',
          name: 'Forced Labor Elimination',
          definition: 'A definition.',
        },
      ]);
    });

    it('parses a bare-string topic URI as a compact reference', () => {
      const doc = minimalSchemeDoc({
        includedProfile: [profile({ criterion: [criterion({ conformityTopic: ['https://example.com/topics/foo'] })] })],
      });
      const scheme = parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
      expect(scheme.profiles[0].criteria[0].topics).toEqual([{ canonicalId: 'https://example.com/topics/foo' }]);
    });

    it('parses tags as a string array', () => {
      const doc = minimalSchemeDoc({
        includedProfile: [profile({ criterion: [criterion({ tag: ['forced-labor', 'human-rights'] })] })],
      });
      const scheme = parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
      expect(scheme.profiles[0].criteria[0].tags).toEqual(['forced-labor', 'human-rights']);
    });

    it('parses a single string tag as a one-element array', () => {
      const doc = minimalSchemeDoc({
        includedProfile: [profile({ criterion: [criterion({ tag: 'forced-labor' })] })],
      });
      const scheme = parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
      expect(scheme.profiles[0].criteria[0].tags).toEqual(['forced-labor']);
    });

    it('captures the owner reference when present', () => {
      const doc = minimalSchemeDoc({
        owner: { type: ['Party'], id: 'https://example.com/owner', name: 'Example Owner' },
      });
      const scheme = parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
      expect(scheme.owner).toEqual({ canonicalId: 'https://example.com/owner', name: 'Example Owner' });
    });

    it('parses owner as a bare URI string (compact form)', () => {
      const doc = minimalSchemeDoc({ owner: 'https://example.com/owner' });
      const scheme = parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
      expect(scheme.owner).toEqual({ canonicalId: 'https://example.com/owner' });
    });

    it('returns undefined owner when input is an array', () => {
      const doc = minimalSchemeDoc({ owner: ['not', 'a', 'party'] });
      const scheme = parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
      expect(scheme.owner).toBeUndefined();
    });
  });

  describe('parse failures (accumulating)', () => {
    it('throws ConformitySchemeParseError with an invalid-shape failure when the document is not an object', () => {
      const error = (() => {
        try {
          parseConformityScheme(null, { sourceUrl: 'x', specVersion: '0.7.0' });
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformitySchemeParseError);
      expect((error as ConformitySchemeParseError).failures).toEqual([
        expect.objectContaining({
          code: 'conformity-scheme.invalid-shape',
          received: 'null',
          expected: 'object',
        }),
      ]);
    });

    it.each([
      ['scheme.id', { id: undefined }, '/id'],
      ['scheme.name', { name: undefined }, '/name'],
    ])('throws with a missing-required-field failure when %s is missing', (_, override, pointer) => {
      const error = (() => {
        try {
          parseConformityScheme(minimalSchemeDoc(override), { sourceUrl: 'https://example.com/scheme' });
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformitySchemeParseError);
      expect((error as ConformitySchemeParseError).failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'conformity-scheme.missing-required-field', pointer }),
        ]),
      );
    });

    it('accumulates multiple failures in a single parse pass', () => {
      const error = (() => {
        try {
          parseConformityScheme(minimalSchemeDoc({ id: undefined, name: undefined }), {
            sourceUrl: 'https://example.com/scheme',
          });
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformitySchemeParseError);
      const failures = (error as ConformitySchemeParseError).failures;
      expect(failures).toHaveLength(2);
      expect(failures.map((f) => f.pointer)).toEqual(expect.arrayContaining(['/id', '/name']));
    });

    it.each([
      ['profile.id', { id: undefined }, '/includedProfile/0/id'],
      ['profile.name', { name: undefined }, '/includedProfile/0/name'],
      ['profile.version', { version: undefined }, '/includedProfile/0/version'],
      ['profile.status', { status: undefined }, '/includedProfile/0/status'],
    ])('throws with a missing-required-field failure when %s is missing', (_, override, pointer) => {
      const doc = minimalSchemeDoc({ includedProfile: [profile(override)] });
      const error = (() => {
        try {
          parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformitySchemeParseError);
      expect((error as ConformitySchemeParseError).failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'conformity-scheme.missing-required-field', pointer }),
        ]),
      );
    });

    it.each([
      ['criterion.id', { id: undefined }, '/includedProfile/0/criterion/0/id'],
      ['criterion.name', { name: undefined }, '/includedProfile/0/criterion/0/name'],
      ['criterion.version', { version: undefined }, '/includedProfile/0/criterion/0/version'],
      ['criterion.status', { status: undefined }, '/includedProfile/0/criterion/0/status'],
    ])('throws with a missing-required-field failure when %s is missing', (_, override, pointer) => {
      const doc = minimalSchemeDoc({ includedProfile: [profile({ criterion: [criterion(override)] })] });
      const error = (() => {
        try {
          parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformitySchemeParseError);
      expect((error as ConformitySchemeParseError).failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'conformity-scheme.missing-required-field', pointer }),
        ]),
      );
    });

    it('throws with an invalid-shape failure when includedProfile is not an array', () => {
      const doc = minimalSchemeDoc({ includedProfile: 'not-an-array' });
      const error = (() => {
        try {
          parseConformityScheme(doc, { sourceUrl: 'https://example.com/scheme' });
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformitySchemeParseError);
      expect((error as ConformitySchemeParseError).failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'conformity-scheme.invalid-shape', pointer: '/includedProfile' }),
        ]),
      );
    });
  });

  describe('hierarchy', () => {
    it('every concrete error extends ConformitySchemeError', () => {
      // unsupported version
      expect(() => parseConformityScheme(minimalSchemeDoc(), { sourceUrl: 'x', specVersion: '99.0.0' })).toThrow(
        ConformitySchemeError,
      );
      // parse failure
      expect(() => parseConformityScheme(null, { sourceUrl: 'x', specVersion: '0.7.0' })).toThrow(
        ConformitySchemeError,
      );
    });
  });
});
