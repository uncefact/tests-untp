import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { fetchSchema } from '../schema-loaders/schema-cache.js';
import type { ValidationError, ValidationOutcome } from '../validation-outcome.js';
import { SchemaValidationCode } from './codes.js';

// ---------------------------------------------------------------------------
// Singleton Ajv instance
// ---------------------------------------------------------------------------

let ajvInstance: Ajv2020 | undefined;

function getAjv(): Ajv2020 {
  if (!ajvInstance) {
    ajvInstance = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajvInstance);
  }
  return ajvInstance;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * A schema reference accepted by {@link validateAgainstSchemas}.
 *
 * - A **string** is treated as a URL; the schema is fetched (and cached) via
 *   {@link fetchSchema} before compilation. Fetch failures surface as
 *   `schema.fetch-failed` errors.
 * - An **object** is treated as the JSON Schema document itself and is used
 *   directly without any network IO. Consumers with bundled schemas (test
 *   fixtures, in-memory constants, schemas loaded from disk) pass them this
 *   way to skip the fetch.
 *
 * The two forms can be mixed in a single call.
 */
export type SchemaReference = string | object;

/**
 * Validates a payload against one or more JSON Schemas. Schemas may be
 * supplied as URL strings (fetched via {@link fetchSchema}) or as inline
 * schema objects (used directly). Each schema is compiled and the payload
 * is validated against it. Ajv runs with `allErrors: true`, so a single
 * payload can surface multiple errors per schema.
 *
 * Per ADR-034, this function does not throw for input-related failures.
 * Schema-fetch failures, schema-compile failures, and payload-invalid
 * errors all surface as entries in `errors[]`. Each Ajv error becomes a
 * structured `ValidationError` with `pointer` set to the Ajv
 * `instancePath` (RFC 6901), `received` to the failing data, `expected` to
 * Ajv's `params`, and `raw` to the original Ajv error.
 */
export async function validateAgainstSchemas(payload: unknown, schemas: SchemaReference[]): Promise<ValidationOutcome> {
  const errors: ValidationError[] = [];
  const ajv = getAjv();

  for (const ref of schemas) {
    let schemaDoc: object;
    let identifier: string;

    if (typeof ref === 'string') {
      identifier = ref;
      const fetchOutcome = await fetchSchema(ref);
      if (fetchOutcome.errors.length > 0 || !fetchOutcome.value) {
        errors.push({
          code: SchemaValidationCode.SchemaFetchFailed,
          message: `Could not load schema from ${ref}.`,
          expected: 'a fetchable JSON Schema',
          raw: fetchOutcome.errors,
        });
        continue;
      }
      schemaDoc = fetchOutcome.value;
    } else {
      identifier = '<inline schema>';
      schemaDoc = ref;
    }

    let validate: ReturnType<typeof ajv.compile>;
    try {
      validate = ajv.compile(schemaDoc);
    } catch (error) {
      errors.push({
        code: SchemaValidationCode.SchemaCompilationFailed,
        message: `Could not compile schema from ${identifier}.`,
        received: error instanceof Error ? error.message : String(error),
        raw: error,
      });
      continue;
    }
    const valid = validate(payload);

    if (!valid && validate.errors) {
      for (const ajvError of validate.errors) {
        errors.push({
          code: SchemaValidationCode.PayloadInvalid,
          message: ajvError.message ?? 'Schema validation failed.',
          pointer: ajvError.instancePath || '',
          received: ajvError.data,
          expected: ajvError.params,
          raw: ajvError,
        });
      }
    }
  }

  return { errors, warnings: [] };
}
