import { jest } from '@jest/globals';
import { makeInMemoryTtlCache } from '../cache/in-memory-ttl-cache.js';
import { makeSchemaLoader, type SchemaLoader } from '../schema-loaders/schema-loader.js';
import {
  SchemaCompilationFailedError,
  SchemaFetchFailedError,
  SchemaPayloadError,
  SchemaValidationError,
} from './errors.js';
import { validateAgainstSchemas } from './validate-against-schemas.js';

const SCHEMA_URL_NAME = 'https://example.com/name-schema.json';
const SCHEMA_URL_AGE = 'https://example.com/age-schema.json';

const NAME_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
};

const AGE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { age: { type: 'integer', minimum: 0 } },
  required: ['age'],
};

type FetchFn = typeof globalThis.fetch;

describe('validateAgainstSchemas', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;
  let loader: SchemaLoader;

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as FetchFn;
    loader = makeSchemaLoader(makeInMemoryTtlCache<object>({ ttlMs: 60_000 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockSchemaResponses(map: Record<string, object>): void {
    fetchMock.mockImplementation((async (url: string) => {
      const schema = map[url];
      if (!schema) {
        return { ok: false, status: 404 } as Response;
      }
      return { ok: true, status: 200, json: async () => schema } as unknown as Response;
    }) as never);
  }

  it('returns void when the payload passes every schema', async () => {
    mockSchemaResponses({ [SCHEMA_URL_NAME]: NAME_SCHEMA, [SCHEMA_URL_AGE]: AGE_SCHEMA });

    await expect(
      validateAgainstSchemas({ name: 'Alice', age: 30 }, [SCHEMA_URL_NAME, SCHEMA_URL_AGE], loader),
    ).resolves.toBeUndefined();
  });

  describe('payload-invalid failures (accumulating)', () => {
    it('throws SchemaPayloadError with a failure per Ajv failure', async () => {
      mockSchemaResponses({ [SCHEMA_URL_NAME]: NAME_SCHEMA });

      const promise = validateAgainstSchemas({ age: 30 }, [SCHEMA_URL_NAME], loader);
      await expect(promise).rejects.toBeInstanceOf(SchemaPayloadError);
      await expect(promise).rejects.toMatchObject({
        failures: expect.arrayContaining([expect.objectContaining({ code: 'schema.payload-invalid' })]),
      });
    });

    it('accumulates failures across multiple schemas with allErrors', async () => {
      mockSchemaResponses({ [SCHEMA_URL_NAME]: NAME_SCHEMA, [SCHEMA_URL_AGE]: AGE_SCHEMA });

      try {
        await validateAgainstSchemas({}, [SCHEMA_URL_NAME, SCHEMA_URL_AGE], loader);
        throw new Error('expected validateAgainstSchemas to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(SchemaPayloadError);
        expect((e as SchemaPayloadError).failures.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('populates pointer from Ajv instancePath', async () => {
      mockSchemaResponses({ [SCHEMA_URL_AGE]: AGE_SCHEMA });

      try {
        await validateAgainstSchemas({ age: -1 }, [SCHEMA_URL_AGE], loader);
        throw new Error('expected validateAgainstSchemas to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(SchemaPayloadError);
        expect((e as SchemaPayloadError).failures[0].pointer).toBe('/age');
      }
    });

    it('populates received from Ajv data and expected from Ajv params', async () => {
      mockSchemaResponses({ [SCHEMA_URL_AGE]: AGE_SCHEMA });

      try {
        await validateAgainstSchemas({ age: -1 }, [SCHEMA_URL_AGE], loader);
        throw new Error('expected validateAgainstSchemas to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(SchemaPayloadError);
        const failure = (e as SchemaPayloadError).failures[0];
        expect(failure.received).toBe(-1);
        expect(failure.expected).toEqual(expect.objectContaining({ comparison: '>=', limit: 0 }));
      }
    });
  });

  describe('fetch failures (fail-fast)', () => {
    it('throws SchemaFetchFailedError when a schema cannot be loaded', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 } as never);

      await expect(validateAgainstSchemas({}, [SCHEMA_URL_NAME], loader)).rejects.toBeInstanceOf(
        SchemaFetchFailedError,
      );
    });

    it('aborts on the first fetch failure without checking subsequent schemas', async () => {
      fetchMock.mockImplementation((async (url: string) => {
        if (url === SCHEMA_URL_NAME) {
          return { ok: false, status: 404 } as Response;
        }
        return { ok: true, status: 200, json: async () => AGE_SCHEMA } as unknown as Response;
      }) as never);

      await expect(
        validateAgainstSchemas({ age: 30 }, [SCHEMA_URL_NAME, SCHEMA_URL_AGE], loader),
      ).rejects.toMatchObject({
        name: 'SchemaFetchFailedError',
        received: SCHEMA_URL_NAME,
      });
      const fetchedUrls = fetchMock.mock.calls.map((args) => args[0]);
      expect(fetchedUrls).toContain(SCHEMA_URL_NAME);
      expect(fetchedUrls).not.toContain(SCHEMA_URL_AGE);
    });

    it("wraps a custom loader's error as SchemaFetchFailedError", async () => {
      const failingLoad = jest.fn(async (): Promise<object> => {
        throw new Error('loader exploded');
      });
      const customLoader: SchemaLoader = { load: failingLoad as SchemaLoader['load'] };

      const error = await validateAgainstSchemas({}, [SCHEMA_URL_NAME], customLoader).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SchemaFetchFailedError);
      expect((error as SchemaFetchFailedError).cause).toBeInstanceOf(Error);
    });

    it('passes URLs to the supplied loader and validates the returned schema', async () => {
      const load = jest.fn(async (): Promise<object> => NAME_SCHEMA);
      const customLoader: SchemaLoader = { load: load as SchemaLoader['load'] };

      await expect(validateAgainstSchemas({ name: 'Alice' }, [SCHEMA_URL_NAME], customLoader)).resolves.toBeUndefined();
      expect(load).toHaveBeenCalledWith(SCHEMA_URL_NAME);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('compilation failures (fail-fast)', () => {
    it('throws SchemaCompilationFailedError when the fetched schema is invalid', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ type: 'not-a-real-type' }),
      } as never);

      await expect(validateAgainstSchemas({}, [SCHEMA_URL_NAME], loader)).rejects.toBeInstanceOf(
        SchemaCompilationFailedError,
      );
    });

    it('throws SchemaCompilationFailedError for an inline schema that does not compile', async () => {
      const badSchema = { type: 'not-a-real-type' };

      await expect(validateAgainstSchemas({}, [badSchema], loader)).rejects.toBeInstanceOf(
        SchemaCompilationFailedError,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('attributes inline-schema compilation failure to <inline schema>', async () => {
      mockSchemaResponses({ [SCHEMA_URL_NAME]: NAME_SCHEMA });
      const badInline = { type: 'not-a-real-type' };

      const error = (await validateAgainstSchemas({ name: 'Alice' }, [SCHEMA_URL_NAME, badInline], loader).catch(
        (e: unknown) => e,
      )) as SchemaCompilationFailedError;
      expect(error).toBeInstanceOf(SchemaCompilationFailedError);
      expect(error.received).toMatch(/.+/);
      expect(error.message).toContain('<inline schema>');
    });
  });

  describe('inline schema references', () => {
    it('validates against an inline schema without invoking the loader', async () => {
      await expect(validateAgainstSchemas({ name: 'Alice' }, [NAME_SCHEMA], loader)).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws SchemaPayloadError from an inline schema when the payload fails', async () => {
      await expect(validateAgainstSchemas({}, [NAME_SCHEMA], loader)).rejects.toBeInstanceOf(SchemaPayloadError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('mixes URL and inline schema references in a single call', async () => {
      mockSchemaResponses({ [SCHEMA_URL_NAME]: NAME_SCHEMA });

      await expect(
        validateAgainstSchemas({ name: 'Alice', age: 30 }, [SCHEMA_URL_NAME, AGE_SCHEMA], loader),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('hierarchy', () => {
    it('every concrete error extends SchemaValidationError', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 } as never);
      await expect(validateAgainstSchemas({}, [SCHEMA_URL_NAME], loader)).rejects.toBeInstanceOf(SchemaValidationError);

      await expect(validateAgainstSchemas({}, [{ type: 'not-a-real-type' }], loader)).rejects.toBeInstanceOf(
        SchemaValidationError,
      );

      await expect(validateAgainstSchemas({}, [NAME_SCHEMA], loader)).rejects.toBeInstanceOf(SchemaValidationError);
    });
  });
});
