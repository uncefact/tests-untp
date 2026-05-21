import { jest } from '@jest/globals';
import { clearSchemaCache } from '../schema-loaders/schema-cache.js';
import { SchemaValidationCode } from './codes.js';
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

  beforeEach(() => {
    clearSchemaCache();
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as FetchFn;
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

  it('returns an empty outcome when the payload passes every schema', async () => {
    mockSchemaResponses({ [SCHEMA_URL_NAME]: NAME_SCHEMA, [SCHEMA_URL_AGE]: AGE_SCHEMA });

    const outcome = await validateAgainstSchemas({ name: 'Alice', age: 30 }, [SCHEMA_URL_NAME, SCHEMA_URL_AGE]);

    expect(outcome).toEqual({ errors: [], warnings: [] });
  });

  it('emits a payload-invalid error per Ajv failure', async () => {
    mockSchemaResponses({ [SCHEMA_URL_NAME]: NAME_SCHEMA });

    const outcome = await validateAgainstSchemas({ age: 30 }, [SCHEMA_URL_NAME]);

    expect(outcome.errors.length).toBeGreaterThan(0);
    expect(outcome.errors[0]).toEqual(
      expect.objectContaining({
        code: SchemaValidationCode.PayloadInvalid,
      }),
    );
  });

  it('accumulates errors across multiple schemas with allErrors', async () => {
    mockSchemaResponses({ [SCHEMA_URL_NAME]: NAME_SCHEMA, [SCHEMA_URL_AGE]: AGE_SCHEMA });

    const outcome = await validateAgainstSchemas({}, [SCHEMA_URL_NAME, SCHEMA_URL_AGE]);

    const codes = outcome.errors.map((e) => e.code);
    expect(codes.filter((c) => c === SchemaValidationCode.PayloadInvalid).length).toBeGreaterThanOrEqual(2);
  });

  it('populates pointer from Ajv instancePath', async () => {
    mockSchemaResponses({ [SCHEMA_URL_AGE]: AGE_SCHEMA });

    const outcome = await validateAgainstSchemas({ age: -1 }, [SCHEMA_URL_AGE]);

    expect(outcome.errors[0].pointer).toBe('/age');
  });

  it('emits a schema-fetch-failed error when a schema cannot be loaded', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as never);

    const outcome = await validateAgainstSchemas({}, [SCHEMA_URL_NAME]);

    expect(outcome.errors).toEqual([
      expect.objectContaining({
        code: SchemaValidationCode.SchemaFetchFailed,
      }),
    ]);
  });

  it('continues to the next schema after a fetch failure on one', async () => {
    fetchMock.mockImplementation((async (url: string) => {
      if (url === SCHEMA_URL_NAME) {
        return { ok: false, status: 404 } as Response;
      }
      return { ok: true, status: 200, json: async () => AGE_SCHEMA } as unknown as Response;
    }) as never);

    const outcome = await validateAgainstSchemas({ age: 30 }, [SCHEMA_URL_NAME, SCHEMA_URL_AGE]);

    expect(outcome.errors.some((e) => e.code === SchemaValidationCode.SchemaFetchFailed)).toBe(true);
    expect(outcome.errors.some((e) => e.code === SchemaValidationCode.PayloadInvalid)).toBe(false);
  });
});
