import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { SchemaLoader } from '../schema-loaders/schema-loader.js';
import type { ValidationFailure } from '../structured-error.js';
import { SchemaCompilationFailedError, SchemaFetchFailedError, SchemaPayloadError } from './errors.js';

function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: false, allErrors: true, verbose: true });
  addFormats(ajv);
  return ajv;
}

/**
 * A schema reference. A string is treated as a URL and loaded via the
 * supplied {@link SchemaLoader}; an object is used directly as the JSON
 * Schema document. The two forms may be mixed in one call.
 */
export type SchemaReference = string | object;

/**
 * Validates a payload against one or more JSON Schemas. Ajv runs with
 * `allErrors: true` so a single payload surfaces every validation failure
 * per schema, and payload failures accumulate across all schemas.
 *
 * Fetch and compile failures are fail-fast: the first schema that cannot
 * be loaded or compiled aborts the run. Only payload-invalid failures
 * accumulate.
 *
 * @throws {SchemaFetchFailedError} if a schema URL cannot be loaded.
 * @throws {SchemaCompilationFailedError} if Ajv refuses a schema.
 * @throws {SchemaPayloadError} carrying every Ajv `allErrors` failure in
 *   `failures[]` if any payload validation failed.
 */
export async function validateAgainstSchemas(
  payload: unknown,
  schemas: SchemaReference[],
  loader: SchemaLoader,
): Promise<void> {
  const failures: ValidationFailure[] = [];
  const ajv = buildAjv();

  for (const ref of schemas) {
    let schemaDoc: object;
    let identifier: string;

    if (typeof ref === 'string') {
      identifier = ref;
      try {
        schemaDoc = await loader.load(ref);
      } catch (cause) {
        throw new SchemaFetchFailedError(ref, cause);
      }
    } else {
      identifier = '<inline schema>';
      schemaDoc = ref;
    }

    let validate: ReturnType<typeof ajv.compile>;
    try {
      validate = ajv.compile(schemaDoc);
    } catch (cause) {
      throw new SchemaCompilationFailedError(identifier, cause);
    }

    if (!validate(payload) && validate.errors) {
      for (const ajvError of validate.errors) {
        failures.push({
          code: 'schema.payload-invalid',
          message: ajvError.message ?? 'Schema validation failed.',
          pointer: ajvError.instancePath || '',
          received: ajvError.data,
          expected: ajvError.params,
        });
      }
    }
  }

  if (failures.length > 0) {
    throw new SchemaPayloadError(failures);
  }
}
