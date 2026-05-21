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
 * Validates a payload against one or more JSON Schemas fetched from URLs.
 *
 * Schemas are fetched (and cached) via {@link fetchSchema}. Each schema is
 * compiled and the payload is validated against it. Ajv runs with
 * `allErrors: true`, so a single payload can surface multiple errors per
 * schema.
 *
 * Per ADR-034, this function does not throw for input-related failures.
 * Schema-fetch failures and payload-invalid errors all surface as entries
 * in `errors[]`. Each Ajv error becomes a structured `ValidationError`
 * with `pointer` set to the Ajv `instancePath` (RFC 6901), `received` to
 * the failing data, and `raw` to the original Ajv error.
 */
export async function validateAgainstSchemas(payload: unknown, schemaUrls: string[]): Promise<ValidationOutcome> {
  const errors: ValidationError[] = [];
  const ajv = getAjv();

  for (const url of schemaUrls) {
    const fetchOutcome = await fetchSchema(url);
    if (fetchOutcome.errors.length > 0 || !fetchOutcome.value) {
      errors.push({
        code: SchemaValidationCode.SchemaFetchFailed,
        message: `Could not load schema from ${url}.`,
        expected: 'a fetchable JSON Schema',
        raw: fetchOutcome.errors,
      });
      continue;
    }

    const validate = ajv.compile(fetchOutcome.value);
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
