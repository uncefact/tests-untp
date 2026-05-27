import { StructuredError, type ValidationFailure } from '../structured-error.js';

/**
 * Base for every JSON-LD validation diagnostic. Catch to handle any
 * JSON-LD failure generically; catch a concrete subclass for specific handling.
 */
export class JsonLdValidationError extends StructuredError {}

/** The input was not a non-null object. */
export class JsonLdInvalidShapeError extends JsonLdValidationError {
  constructor(document: unknown) {
    super({
      code: 'jsonld.invalid-shape',
      message: 'JSON-LD document must be a non-null object.',
      received: document === null ? 'null' : typeof document,
      expected: 'object',
    });
  }
}

/** `jsonld.toRDF` rejected the document (malformed context, undefined terms, etc.). */
export class JsonLdExpansionFailedError extends JsonLdValidationError {
  constructor(cause: unknown) {
    super({
      code: 'jsonld.expansion-failed',
      message: 'JSON-LD expansion failed.',
      received: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
}

/**
 * Base for every JSON Schema validation diagnostic. Catch to handle any
 * schema-validation failure generically; catch a concrete subclass for
 * specific handling.
 */
export class SchemaValidationError extends StructuredError {}

/** A schema URL could not be loaded. */
export class SchemaFetchFailedError extends SchemaValidationError {
  constructor(url: string, cause: unknown) {
    super({
      code: 'schema.fetch-failed',
      message: `Could not load schema from ${url}.`,
      received: url,
      cause,
    });
  }
}

/** Ajv refused to compile the schema (malformed schema, duplicate `$id`, etc.). */
export class SchemaCompilationFailedError extends SchemaValidationError {
  constructor(identifier: string, cause: unknown) {
    super({
      code: 'schema.compilation-failed',
      message: `Could not compile schema from ${identifier}.`,
      received: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
}

/**
 * The payload failed schema validation. Carries every Ajv `allErrors`
 * failure across every schema in {@link failures}, each with `code`
 * `'schema.payload-invalid'` plus the Ajv-derived `pointer`, `received`,
 * and `expected`.
 */
export class SchemaPayloadError extends SchemaValidationError {
  readonly failures: readonly ValidationFailure[];
  constructor(failures: readonly ValidationFailure[]) {
    super({
      code: 'schema.payload-invalid',
      message: `Payload failed validation against ${failures.length} rule(s).`,
    });
    this.failures = failures;
  }
}
