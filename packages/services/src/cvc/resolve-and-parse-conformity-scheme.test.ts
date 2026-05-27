import { TextEncoder } from 'node:util';

const mockResolveDocumentIfChanged = jest.fn();
const mockValidateJsonLd = jest.fn();
const mockValidateAgainstSchemas = jest.fn();
const mockParseConformityScheme = jest.fn();

jest.mock('@uncefact/untp-utils/resolvers', () => ({
  resolveDocumentIfChanged: (...args: unknown[]) => mockResolveDocumentIfChanged(...args),
}));
jest.mock('@uncefact/untp-utils/validation', () => ({
  validateJsonLd: (...args: unknown[]) => mockValidateJsonLd(...args),
  validateAgainstSchemas: (...args: unknown[]) => mockValidateAgainstSchemas(...args),
}));
jest.mock('@uncefact/untp-utils/conformity-vocabulary', () => ({
  parseConformityScheme: (...args: unknown[]) => mockParseConformityScheme(...args),
}));

import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { ConformitySchemeResolveError } from './errors';
import { resolveAndParseConformityScheme } from './resolve-and-parse-conformity-scheme';
import { RESOLVE_FAILURE_STATUS, type ResolveAndParseConformitySchemeInput } from './types';

const SOURCE_URL = 'https://example.com/scheme';
const SCHEMA_URL = 'https://example.com/cvc/ConformityScheme.json';

const fakeLoader = { load: jest.fn() } as unknown as ResolveAndParseConformitySchemeInput['schemaLoader'];

function baseInput(
  overrides: Partial<ResolveAndParseConformitySchemeInput> = {},
): ResolveAndParseConformitySchemeInput {
  return {
    sourceUrl: SOURCE_URL,
    source: 'UNTP',
    tenantId: 'tenant-1',
    conformitySchemaUrl: SCHEMA_URL,
    schemaLoader: fakeLoader,
    ...overrides,
  };
}

function fakeScheme(overrides: Record<string, unknown> = {}) {
  return {
    canonicalId: SOURCE_URL,
    sourceUrl: SOURCE_URL,
    specVersion: '0.7.0',
    name: 'Example Scheme',
    profiles: [],
    ...overrides,
  };
}

function loadedResponse(body: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'loaded' as const,
    result: {
      body: new TextEncoder().encode(body),
      finalUrl: SOURCE_URL,
      status: 200,
      bodyDigest: { toString: () => 'zFAKEDIGEST' },
      ...overrides,
    },
  };
}

beforeEach(() => {
  mockResolveDocumentIfChanged.mockReset();
  mockValidateJsonLd.mockReset();
  mockValidateAgainstSchemas.mockReset();
  mockParseConformityScheme.mockReset();
});

describe('resolveAndParseConformityScheme', () => {
  describe('happy path (fetched)', () => {
    it('returns kind: success with the parsed scheme + cache headers + body digest', async () => {
      mockResolveDocumentIfChanged.mockResolvedValue(
        loadedResponse('{"@context":[],"id":"x","name":"x","includedProfile":[]}', {
          etag: '"abc"',
          lastModified: 'Wed, 21 May 2026 12:00:00 GMT',
        }),
      );
      mockValidateJsonLd.mockResolvedValue(undefined);
      mockValidateAgainstSchemas.mockResolvedValue(undefined);
      mockParseConformityScheme.mockReturnValue(fakeScheme());

      const result = await resolveAndParseConformityScheme(baseInput());

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error('unreachable');
      expect(result.scheme).toEqual(fakeScheme());
      expect(result.raw).toEqual({ '@context': [], id: 'x', name: 'x', includedProfile: [] });
      expect(result.etag).toBe('"abc"');
      expect(result.lastModifiedHeader).toBe('Wed, 21 May 2026 12:00:00 GMT');
      expect(result.bodyDigest).toBeDefined();
    });

    it('passes the cached resource to resolveDocumentIfChanged', async () => {
      const cached = { etag: '"prev"', lastModifiedHeader: 'Tue, 20 May 2026 11:00:00 GMT' };
      mockResolveDocumentIfChanged.mockResolvedValue(loadedResponse('{"id":"x"}'));
      mockValidateJsonLd.mockResolvedValue(undefined);
      mockValidateAgainstSchemas.mockResolvedValue(undefined);
      mockParseConformityScheme.mockReturnValue(fakeScheme());

      await resolveAndParseConformityScheme(baseInput({ cached }));
      expect(mockResolveDocumentIfChanged).toHaveBeenCalledWith(SOURCE_URL, cached);
    });

    it('passes an empty object to resolveDocumentIfChanged when no cached resource is supplied', async () => {
      mockResolveDocumentIfChanged.mockResolvedValue(loadedResponse('{"id":"x"}'));
      mockValidateJsonLd.mockResolvedValue(undefined);
      mockValidateAgainstSchemas.mockResolvedValue(undefined);
      mockParseConformityScheme.mockReturnValue(fakeScheme());

      await resolveAndParseConformityScheme(baseInput());
      expect(mockResolveDocumentIfChanged).toHaveBeenCalledWith(SOURCE_URL, {});
    });
  });

  describe('happy path (prefetched)', () => {
    it('skips resolveDocumentIfChanged and processes the supplied bytes', async () => {
      mockValidateJsonLd.mockResolvedValue(undefined);
      mockValidateAgainstSchemas.mockResolvedValue(undefined);
      mockParseConformityScheme.mockReturnValue(fakeScheme());

      const result = await resolveAndParseConformityScheme(
        baseInput({
          source: 'SYSTEM_SEED',
          prefetched: {
            body: new TextEncoder().encode('{"id":"seed"}'),
            etag: '"seed-etag"',
            lastModifiedHeader: 'Mon, 19 May 2026 10:00:00 GMT',
          },
        }),
      );

      expect(mockResolveDocumentIfChanged).not.toHaveBeenCalled();
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error('unreachable');
      expect(result.raw).toEqual({ id: 'seed' });
      expect(result.etag).toBe('"seed-etag"');
    });
  });

  describe('unchanged (skip chain)', () => {
    it('returns kind: unchanged when resolveDocumentIfChanged reports unchanged', async () => {
      mockResolveDocumentIfChanged.mockResolvedValue({ kind: 'unchanged' });

      const result = await resolveAndParseConformityScheme(baseInput());

      expect(result.kind).toBe('unchanged');
      expect(mockValidateJsonLd).not.toHaveBeenCalled();
      expect(mockValidateAgainstSchemas).not.toHaveBeenCalled();
      expect(mockParseConformityScheme).not.toHaveBeenCalled();
    });
  });

  describe('failure: FETCH_FAILED', () => {
    it('wraps a resolveDocumentIfChanged rejection', async () => {
      const cause = new Error('upstream gone');
      mockResolveDocumentIfChanged.mockRejectedValue(cause);

      const result = await resolveAndParseConformityScheme(baseInput());
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('unreachable');
      expect(result.error).toBeInstanceOf(ConformitySchemeResolveError);
      expect(result.error.status).toBe(RESOLVE_FAILURE_STATUS.FetchFailed);
      expect(result.error.cause).toBe(cause);
    });
  });

  describe('failure: INVALID_JSON', () => {
    it('wraps a JSON.parse failure when the body is not valid JSON', async () => {
      mockResolveDocumentIfChanged.mockResolvedValue(loadedResponse('not-json'));

      const result = await resolveAndParseConformityScheme(baseInput());
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('unreachable');
      expect(result.error.status).toBe(RESOLVE_FAILURE_STATUS.InvalidJson);
      expect(result.error.cause).toBeInstanceOf(SyntaxError);
      expect(mockValidateAgainstSchemas).not.toHaveBeenCalled();
    });

    it('wraps an empty-body JSON.parse failure under INVALID_JSON', async () => {
      mockResolveDocumentIfChanged.mockResolvedValue(loadedResponse(''));

      const result = await resolveAndParseConformityScheme(baseInput());
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('unreachable');
      expect(result.error.status).toBe(RESOLVE_FAILURE_STATUS.InvalidJson);
    });
  });

  describe('failure: SCHEMA_INVALID', () => {
    it('wraps a validateAgainstSchemas throw and skips downstream gates', async () => {
      mockResolveDocumentIfChanged.mockResolvedValue(loadedResponse('{"id":"x"}'));
      const cause = new Error('schema validation failed');
      cause.name = 'SchemaPayloadError';
      mockValidateAgainstSchemas.mockRejectedValue(cause);

      const result = await resolveAndParseConformityScheme(baseInput());
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('unreachable');
      expect(result.error.status).toBe(RESOLVE_FAILURE_STATUS.SchemaInvalid);
      expect(result.error.cause).toBe(cause);
      expect(mockValidateJsonLd).not.toHaveBeenCalled();
      expect(mockParseConformityScheme).not.toHaveBeenCalled();
    });
  });

  describe('failure: JSONLD_EXPANSION_FAILED', () => {
    it('wraps a validateJsonLd throw and skips parsing', async () => {
      mockResolveDocumentIfChanged.mockResolvedValue(loadedResponse('{"id":"x"}'));
      mockValidateAgainstSchemas.mockResolvedValue(undefined);
      const cause = new Error('bad context');
      cause.name = 'JsonLdExpansionFailedError';
      mockValidateJsonLd.mockRejectedValue(cause);

      const result = await resolveAndParseConformityScheme(baseInput());
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('unreachable');
      expect(result.error.status).toBe(RESOLVE_FAILURE_STATUS.JsonLdExpansionFailed);
      expect(result.error.cause).toBe(cause);
      expect(mockParseConformityScheme).not.toHaveBeenCalled();
    });
  });

  describe('failure: PARSE_FAILED', () => {
    it('wraps a parseConformityScheme throw', async () => {
      mockResolveDocumentIfChanged.mockResolvedValue(loadedResponse('{"id":"x"}'));
      mockValidateJsonLd.mockResolvedValue(undefined);
      mockValidateAgainstSchemas.mockResolvedValue(undefined);
      const cause = new Error('parse failed');
      cause.name = 'ConformitySchemeParseError';
      mockParseConformityScheme.mockImplementation(() => {
        throw cause;
      });

      const result = await resolveAndParseConformityScheme(baseInput());
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('unreachable');
      expect(result.error.status).toBe(RESOLVE_FAILURE_STATUS.ParseFailed);
      expect(result.error.cause).toBe(cause);
    });
  });

  describe('failure: DIGEST_FAILED', () => {
    it('wraps a MultibaseDigest.fromData throw rather than propagating', async () => {
      mockResolveDocumentIfChanged.mockResolvedValue(loadedResponse('{"id":"x"}'));
      mockValidateJsonLd.mockResolvedValue(undefined);
      mockValidateAgainstSchemas.mockResolvedValue(undefined);
      mockParseConformityScheme.mockReturnValue(fakeScheme());
      const cause = new Error('crypto.subtle missing');
      const spy = jest.spyOn(MultibaseDigest, 'fromData').mockRejectedValueOnce(cause);

      try {
        const result = await resolveAndParseConformityScheme(baseInput());
        expect(result.kind).toBe('failure');
        if (result.kind !== 'failure') throw new Error('unreachable');
        expect(result.error.status).toBe(RESOLVE_FAILURE_STATUS.DigestFailed);
        expect(result.error.cause).toBe(cause);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('error metadata', () => {
    it('attaches sourceUrl, code, message, and cause on the resolve error', async () => {
      mockResolveDocumentIfChanged.mockRejectedValue(new Error('boom'));

      const result = await resolveAndParseConformityScheme(
        baseInput({ sourceUrl: 'https://example.com/specific-scheme' }),
      );
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('unreachable');
      expect(result.error.sourceUrl).toBe('https://example.com/specific-scheme');
      expect(result.error.code).toBe('conformity-scheme.resolve-failed.fetch-failed');
      expect(result.error.message).toContain('https://example.com/specific-scheme');
      expect(result.error.message).toContain('FETCH_FAILED');
    });

    it.each([
      [RESOLVE_FAILURE_STATUS.InvalidJson, 'conformity-scheme.resolve-failed.invalid-json'],
      [RESOLVE_FAILURE_STATUS.SchemaInvalid, 'conformity-scheme.resolve-failed.schema-invalid'],
      [RESOLVE_FAILURE_STATUS.JsonLdExpansionFailed, 'conformity-scheme.resolve-failed.jsonld-expansion-failed'],
      [RESOLVE_FAILURE_STATUS.ParseFailed, 'conformity-scheme.resolve-failed.parse-failed'],
      [RESOLVE_FAILURE_STATUS.DigestFailed, 'conformity-scheme.resolve-failed.digest-failed'],
    ])('kebab-cases %s into the error code (%s)', (status, expectedCode) => {
      const error = new ConformitySchemeResolveError({ status, sourceUrl: SOURCE_URL, cause: new Error('x') });
      expect(error.code).toBe(expectedCode);
    });
  });

  describe('cvcSpecVersion override', () => {
    it('forwards the override to parseConformityScheme', async () => {
      mockResolveDocumentIfChanged.mockResolvedValue(loadedResponse('{"id":"x"}'));
      mockValidateJsonLd.mockResolvedValue(undefined);
      mockValidateAgainstSchemas.mockResolvedValue(undefined);
      mockParseConformityScheme.mockReturnValue(fakeScheme());

      await resolveAndParseConformityScheme(baseInput({ cvcSpecVersion: '0.7.0' }));
      expect(mockParseConformityScheme).toHaveBeenCalledWith(expect.anything(), {
        sourceUrl: SOURCE_URL,
        specVersion: '0.7.0',
      });
    });
  });
});
