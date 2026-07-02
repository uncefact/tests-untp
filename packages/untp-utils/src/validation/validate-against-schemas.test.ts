import { jest } from '@jest/globals';
import { ResolverHttpError, ResolverInvalidJsonError } from '../resolvers/errors.js';

const resolveJsonDocument = jest.fn();

// The real schema loader fetches through the guarded resolver; mock that
// boundary (keeping the real error classes) so this suite exercises the real
// loader + cache + Ajv without touching the network.
jest.unstable_mockModule('../resolvers/index.js', () => ({
  resolveJsonDocument,
  ResolverHttpError,
  ResolverInvalidJsonError,
}));

const { createInMemoryTtlCache } = await import('../cache/in-memory-ttl-cache.js');
const { createSchemaLoader } = await import('../loaders/schema-loader.js');
const { SchemaCompilationFailedError, SchemaFetchFailedError, SchemaPayloadError, SchemaValidationError } =
  await import('./errors.js');
const { validateAgainstSchemas } = await import('./validate-against-schemas.js');

type SchemaLoader = Awaited<ReturnType<typeof createSchemaLoader>>;

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

describe('validateAgainstSchemas', () => {
  let loader: SchemaLoader;

  beforeEach(() => {
    resolveJsonDocument.mockReset();
    loader = createSchemaLoader(createInMemoryTtlCache<object>({ ttlMs: 60_000 }));
  });

  function mockSchemaResponses(map: Record<string, object>): void {
    resolveJsonDocument.mockImplementation((async (url: string) => {
      const schema = map[url];
      if (!schema) {
        throw new ResolverHttpError(url, 404);
      }
      return { json: schema, finalUrl: url };
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
        expect((e as InstanceType<typeof SchemaPayloadError>).failures.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('populates pointer from Ajv instancePath', async () => {
      mockSchemaResponses({ [SCHEMA_URL_AGE]: AGE_SCHEMA });

      try {
        await validateAgainstSchemas({ age: -1 }, [SCHEMA_URL_AGE], loader);
        throw new Error('expected validateAgainstSchemas to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(SchemaPayloadError);
        expect((e as InstanceType<typeof SchemaPayloadError>).failures[0].pointer).toBe('/age');
      }
    });

    it('populates received from Ajv data and expected from Ajv params', async () => {
      mockSchemaResponses({ [SCHEMA_URL_AGE]: AGE_SCHEMA });

      try {
        await validateAgainstSchemas({ age: -1 }, [SCHEMA_URL_AGE], loader);
        throw new Error('expected validateAgainstSchemas to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(SchemaPayloadError);
        const failure = (e as InstanceType<typeof SchemaPayloadError>).failures[0];
        expect(failure.received).toBe(-1);
        expect(failure.expected).toEqual(expect.objectContaining({ comparison: '>=', limit: 0 }));
      }
    });
  });

  describe('fetch failures (fail-fast)', () => {
    it('throws SchemaFetchFailedError when a schema cannot be loaded', async () => {
      resolveJsonDocument.mockRejectedValue(new ResolverHttpError(SCHEMA_URL_NAME, 404) as never);

      await expect(validateAgainstSchemas({}, [SCHEMA_URL_NAME], loader)).rejects.toBeInstanceOf(
        SchemaFetchFailedError,
      );
    });

    it('aborts on the first fetch failure without checking subsequent schemas', async () => {
      mockSchemaResponses({ [SCHEMA_URL_AGE]: AGE_SCHEMA });

      await expect(
        validateAgainstSchemas({ age: 30 }, [SCHEMA_URL_NAME, SCHEMA_URL_AGE], loader),
      ).rejects.toMatchObject({
        name: 'SchemaFetchFailedError',
        received: SCHEMA_URL_NAME,
      });
      const fetchedUrls = resolveJsonDocument.mock.calls.map((args) => args[0]);
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
      expect((error as InstanceType<typeof SchemaFetchFailedError>).cause).toBeInstanceOf(Error);
    });

    it('passes URLs to the supplied loader and validates the returned schema', async () => {
      const load = jest.fn(async (): Promise<object> => NAME_SCHEMA);
      const customLoader: SchemaLoader = { load: load as SchemaLoader['load'] };

      await expect(validateAgainstSchemas({ name: 'Alice' }, [SCHEMA_URL_NAME], customLoader)).resolves.toBeUndefined();
      expect(load).toHaveBeenCalledWith(SCHEMA_URL_NAME);
      expect(resolveJsonDocument).not.toHaveBeenCalled();
    });
  });

  describe('compilation failures (fail-fast)', () => {
    it('throws SchemaCompilationFailedError when the fetched schema is invalid', async () => {
      mockSchemaResponses({ [SCHEMA_URL_NAME]: { type: 'not-a-real-type' } });

      await expect(validateAgainstSchemas({}, [SCHEMA_URL_NAME], loader)).rejects.toBeInstanceOf(
        SchemaCompilationFailedError,
      );
    });

    it('throws SchemaCompilationFailedError for an inline schema that does not compile', async () => {
      const badSchema = { type: 'not-a-real-type' };

      await expect(validateAgainstSchemas({}, [badSchema], loader)).rejects.toBeInstanceOf(
        SchemaCompilationFailedError,
      );
      expect(resolveJsonDocument).not.toHaveBeenCalled();
    });

    it('attributes inline-schema compilation failure to <inline schema>', async () => {
      mockSchemaResponses({ [SCHEMA_URL_NAME]: NAME_SCHEMA });
      const badInline = { type: 'not-a-real-type' };

      const error = (await validateAgainstSchemas({ name: 'Alice' }, [SCHEMA_URL_NAME, badInline], loader).catch(
        (e: unknown) => e,
      )) as InstanceType<typeof SchemaCompilationFailedError>;
      expect(error).toBeInstanceOf(SchemaCompilationFailedError);
      expect(error.received).toMatch(/.+/);
      expect(error.message).toContain('<inline schema>');
    });
  });

  describe('inline schema references', () => {
    it('validates against an inline schema without invoking the loader', async () => {
      await expect(validateAgainstSchemas({ name: 'Alice' }, [NAME_SCHEMA], loader)).resolves.toBeUndefined();
      expect(resolveJsonDocument).not.toHaveBeenCalled();
    });

    it('throws SchemaPayloadError from an inline schema when the payload fails', async () => {
      await expect(validateAgainstSchemas({}, [NAME_SCHEMA], loader)).rejects.toBeInstanceOf(SchemaPayloadError);
      expect(resolveJsonDocument).not.toHaveBeenCalled();
    });

    it('mixes URL and inline schema references in a single call', async () => {
      mockSchemaResponses({ [SCHEMA_URL_NAME]: NAME_SCHEMA });

      await expect(
        validateAgainstSchemas({ name: 'Alice', age: 30 }, [SCHEMA_URL_NAME, AGE_SCHEMA], loader),
      ).resolves.toBeUndefined();
      expect(resolveJsonDocument).toHaveBeenCalledTimes(1);
    });
  });

  describe('hierarchy', () => {
    it('every concrete error extends SchemaValidationError', async () => {
      resolveJsonDocument.mockRejectedValue(new ResolverHttpError(SCHEMA_URL_NAME, 404) as never);
      await expect(validateAgainstSchemas({}, [SCHEMA_URL_NAME], loader)).rejects.toBeInstanceOf(SchemaValidationError);

      await expect(validateAgainstSchemas({}, [{ type: 'not-a-real-type' }], loader)).rejects.toBeInstanceOf(
        SchemaValidationError,
      );

      await expect(validateAgainstSchemas({}, [NAME_SCHEMA], loader)).rejects.toBeInstanceOf(SchemaValidationError);
    });
  });
});
