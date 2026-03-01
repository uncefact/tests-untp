import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { fetchSchema } from './schema-cache.service.js';

// ── Error ────────────────────────────────────────────────────────────────────

export class SchemaValidationError extends Error {
  public readonly errors: Ajv2020['errors'];

  constructor(message: string, errors?: Ajv2020['errors']) {
    super(message);
    this.name = 'SchemaValidationError';
    this.errors = errors ?? null;
  }
}

// ── Singleton Ajv instance ───────────────────────────────────────────────────

let ajvInstance: Ajv2020 | undefined;

function getAjv(): Ajv2020 {
  if (!ajvInstance) {
    ajvInstance = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajvInstance);
  }
  return ajvInstance;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validates a payload against one or more JSON Schemas fetched from URLs.
 *
 * Schemas are fetched (and cached) via {@link fetchSchema}. Each schema
 * is compiled and the payload is validated against it. If any schema
 * validation fails, a {@link SchemaValidationError} is thrown with the
 * first set of errors.
 *
 * @param payload   - The object to validate.
 * @param schemaUrls - One or more schema URLs to validate against.
 * @throws {SchemaValidationError} If the payload fails validation against any schema.
 */
export async function validateAgainstSchemas(payload: unknown, schemaUrls: string[]): Promise<void> {
  const ajv = getAjv();

  for (const url of schemaUrls) {
    const schema = await fetchSchema(url);
    const validate = ajv.compile(schema);
    const valid = validate(payload);

    if (!valid && validate.errors && validate.errors.length > 0) {
      const summary = validate.errors.map((e) => `${e.instancePath || '/'} ${e.message ?? 'unknown error'}`).join('; ');
      throw new SchemaValidationError(`Schema validation failed (${url}): ${summary}`, validate.errors);
    }
  }
}
