import type { JsonLdDocument } from 'jsonld';
import type { ValidationError, ValidationOutcome } from '../validation-outcome.js';
import { JsonLdValidationCode } from './codes.js';

/**
 * Options for {@link validateJsonLd}.
 */
export interface ValidateJsonLdOptions {
  /** Whether to use safe mode for JSON-LD expansion. Defaults to true. */
  safe?: boolean;
}

/**
 * Validates a JSON-LD document by attempting to expand it to RDF in safe
 * mode (or non-safe mode if explicitly requested). Catches malformed
 * contexts, undefined terms, and structurally invalid linked data.
 *
 * Returns a {@link ValidationOutcome}. Per ADR-034, this function does not
 * throw for input-related failures: input shape problems and expansion
 * failures both surface as entries in `errors[]`.
 *
 * @param document - The JSON-LD document to validate.
 * @param options - {@link ValidateJsonLdOptions}.
 */
export async function validateJsonLd(document: unknown, options?: ValidateJsonLdOptions): Promise<ValidationOutcome> {
  const errors: ValidationError[] = [];

  if (typeof document !== 'object' || document === null) {
    errors.push({
      code: JsonLdValidationCode.InvalidShape,
      message: 'JSON-LD document must be a non-null object.',
      received: document === null ? 'null' : typeof document,
      expected: 'object',
    });
    return { errors, warnings: [] };
  }

  // Dynamic import: jsonld pulls in undici/TextDecoder which aren't
  // available in jsdom, so we load it lazily to allow test mocking.
  const jsonldModule = await import('jsonld');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonld = ('default' in jsonldModule ? (jsonldModule as any).default : jsonldModule) as typeof import('jsonld');

  try {
    await jsonld.toRDF(
      document as JsonLdDocument,
      { safe: options?.safe ?? true } as Parameters<typeof jsonld.toRDF>[1],
    );
  } catch (error) {
    errors.push({
      code: JsonLdValidationCode.ExpansionFailed,
      message: 'JSON-LD expansion failed.',
      received: error instanceof Error ? error.message : String(error),
      raw: error,
    });
  }

  return { errors, warnings: [] };
}
