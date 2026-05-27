import { ConformityVocabularyError, ConformityCatalogueParseError } from './errors.js';
import { parseConformityCatalogue } from './parse-conformity-catalogue.js';

const REGISTER_CONTEXT = ['https://example.com/context/register'];

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '@type': ['ConformityVocabularyCatalogueEntry', 'ConformityScheme'],
    id: 'https://example.com/registry/example',
    name: 'Example Scheme',
    vocabularyURL: 'https://vocab.example.com/scheme',
    ...overrides,
  };
}

function registerDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '@context': REGISTER_CONTEXT,
    '@type': ['ConformityVocabularyCatalogueRegister', 'Register'],
    id: 'https://example.com/registry',
    name: 'Test Register',
    entries: [],
    ...overrides,
  };
}

describe('parseConformityCatalogue', () => {
  describe('happy path', () => {
    it('returns an empty entries array when the register has no entries', () => {
      expect(parseConformityCatalogue(registerDoc())).toEqual({ entries: [] });
    });

    it('returns one entry per register entry with the three required fields', () => {
      const doc = registerDoc({
        entries: [
          entry({
            id: 'https://example.com/registry/scheme-a',
            name: 'Scheme A',
            vocabularyURL: 'https://vocab.example.com/scheme-a',
          }),
          entry({
            id: 'https://example.com/registry/scheme-b',
            name: 'Scheme B',
            vocabularyURL: 'https://vocab.example.org/scheme-b',
          }),
        ],
      });

      expect(parseConformityCatalogue(doc).entries).toEqual([
        {
          canonicalId: 'https://example.com/registry/scheme-a',
          vocabularyUrl: 'https://vocab.example.com/scheme-a',
          name: 'Scheme A',
        },
        {
          canonicalId: 'https://example.com/registry/scheme-b',
          vocabularyUrl: 'https://vocab.example.org/scheme-b',
          name: 'Scheme B',
        },
      ]);
    });

    it('ignores extra metadata fields on each entry', () => {
      const doc = registerDoc({
        entries: [
          entry({
            owner: { id: 'did:web:example.com', name: 'Example Org', website: 'https://example.com' },
            shortName: 'EX',
            statement: 'A statement.',
            industrySector: { id: 'foo' },
            geographicScope: { id: 'bar' },
            endorsementLevel: 'Self',
            licenseType: 'ProprietaryDocument',
            profiles: [{ id: 'https://example.com/profile/1' }],
          }),
        ],
      });

      const { entries } = parseConformityCatalogue(doc);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({
        canonicalId: 'https://example.com/registry/example',
        vocabularyUrl: 'https://vocab.example.com/scheme',
        name: 'Example Scheme',
      });
    });
  });

  describe('parse failures (accumulating)', () => {
    it('throws ConformityCatalogueParseError with an invalid-shape failure when the document is not an object', () => {
      const error = (() => {
        try {
          parseConformityCatalogue(null);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      expect((error as ConformityCatalogueParseError).failures).toEqual([
        expect.objectContaining({
          code: 'conformity-catalogue.invalid-shape',
          received: 'null',
        }),
      ]);
    });

    it('throws when entries is missing', () => {
      const doc = registerDoc({ entries: undefined });
      const error = (() => {
        try {
          parseConformityCatalogue(doc);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      expect((error as ConformityCatalogueParseError).failures).toEqual([
        expect.objectContaining({
          code: 'conformity-catalogue.missing-required-field',
          pointer: '/entries',
          received: 'undefined',
        }),
      ]);
    });

    it('throws when entries is null (reports `null`, not `undefined`)', () => {
      const doc = registerDoc({ entries: null });
      const error = (() => {
        try {
          parseConformityCatalogue(doc);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      expect((error as ConformityCatalogueParseError).failures).toEqual([
        expect.objectContaining({
          code: 'conformity-catalogue.missing-required-field',
          pointer: '/entries',
          received: 'null',
        }),
      ]);
    });

    it('throws when entries is not an array', () => {
      const doc = registerDoc({ entries: 'not-an-array' });
      const error = (() => {
        try {
          parseConformityCatalogue(doc);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      expect((error as ConformityCatalogueParseError).failures).toEqual([
        expect.objectContaining({
          code: 'conformity-catalogue.invalid-shape',
          pointer: '/entries',
        }),
      ]);
    });

    it.each([
      ['entry.id', { id: undefined }, '/entries/0/id'],
      ['entry.name', { name: undefined }, '/entries/0/name'],
      ['entry.vocabularyURL', { vocabularyURL: undefined }, '/entries/0/vocabularyURL'],
    ])('throws with a missing-required-field failure when %s is missing', (_label, override, pointer) => {
      const doc = registerDoc({ entries: [entry(override)] });
      const error = (() => {
        try {
          parseConformityCatalogue(doc);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      expect((error as ConformityCatalogueParseError).failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'conformity-catalogue.missing-required-field', pointer }),
        ]),
      );
    });

    it('accumulates failures from every malformed entry in one pass', () => {
      const doc = registerDoc({
        entries: [entry(), entry({ id: undefined }), entry({ vocabularyURL: undefined }), entry({ name: undefined })],
      });
      const error = (() => {
        try {
          parseConformityCatalogue(doc);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      const failures = (error as ConformityCatalogueParseError).failures;
      expect(failures).toHaveLength(3);
      expect(failures.map((f) => f.pointer).sort()).toEqual([
        '/entries/1/id',
        '/entries/2/vocabularyURL',
        '/entries/3/name',
      ]);
    });

    it('accumulates all three field failures when a single entry is missing every required field (no intra-entry short-circuit)', () => {
      const doc = registerDoc({
        entries: [entry({ id: undefined, vocabularyURL: undefined, name: undefined })],
      });
      const error = (() => {
        try {
          parseConformityCatalogue(doc);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      const failures = (error as ConformityCatalogueParseError).failures;
      expect(failures).toHaveLength(3);
      expect(failures.map((f) => f.pointer).sort()).toEqual([
        '/entries/0/id',
        '/entries/0/name',
        '/entries/0/vocabularyURL',
      ]);
      expect(failures.every((f) => f.code === 'conformity-catalogue.missing-required-field')).toBe(true);
    });

    it('throws when an entry is not an object', () => {
      const doc = registerDoc({ entries: [entry(), 'not-an-object', null] });
      const error = (() => {
        try {
          parseConformityCatalogue(doc);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      const failures = (error as ConformityCatalogueParseError).failures;
      expect(failures.map((f) => f.pointer).sort()).toEqual(['/entries/1', '/entries/2']);
    });

    it('accumulates invalid-shape and missing-required-field failures across entries in one pass', () => {
      const doc = registerDoc({
        entries: [entry(), 'not-an-object', entry({ id: undefined })],
      });
      const error = (() => {
        try {
          parseConformityCatalogue(doc);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      const failures = (error as ConformityCatalogueParseError).failures;
      const codes = failures.map((f) => f.code).sort();
      expect(codes).toEqual(['conformity-catalogue.invalid-shape', 'conformity-catalogue.missing-required-field']);
    });

    it('throws when vocabularyURL is not a parseable URL', () => {
      const doc = registerDoc({ entries: [entry({ vocabularyURL: 'not a url' })] });
      const error = (() => {
        try {
          parseConformityCatalogue(doc);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      expect((error as ConformityCatalogueParseError).failures).toEqual([
        expect.objectContaining({
          code: 'conformity-catalogue.invalid-shape',
          pointer: '/entries/0/vocabularyURL',
          received: 'not a url',
        }),
      ]);
    });
  });

  describe('status', () => {
    it('extracts entry.status when present', () => {
      const doc = registerDoc({ entries: [entry({ status: 'active' })] });
      const { entries } = parseConformityCatalogue(doc);
      expect(entries[0].status).toBe('active');
    });

    it('omits status when entry.status is absent', () => {
      const { entries } = parseConformityCatalogue(registerDoc({ entries: [entry()] }));
      expect(entries[0].status).toBeUndefined();
    });

    it('omits status when entry.status is the empty string', () => {
      const { entries } = parseConformityCatalogue(registerDoc({ entries: [entry({ status: '' })] }));
      expect(entries[0].status).toBeUndefined();
    });
  });

  describe('options.sourceUrl', () => {
    it('attaches sourceUrl to the thrown error when supplied', () => {
      const error = (() => {
        try {
          parseConformityCatalogue(null, { sourceUrl: 'https://example.com/registry.json' });
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      expect((error as ConformityCatalogueParseError).sourceUrl).toBe('https://example.com/registry.json');
      expect((error as Error).message).toContain('https://example.com/registry.json');
    });

    it('leaves sourceUrl undefined when not supplied', () => {
      const error = (() => {
        try {
          parseConformityCatalogue(null);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ConformityCatalogueParseError);
      expect((error as ConformityCatalogueParseError).sourceUrl).toBeUndefined();
    });
  });

  describe('hierarchy', () => {
    it('extends ConformityVocabularyError (the sub-entry umbrella)', () => {
      expect(() => parseConformityCatalogue(null)).toThrow(ConformityVocabularyError);
    });
  });
});
