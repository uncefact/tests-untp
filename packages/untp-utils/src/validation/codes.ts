/**
 * Validation error codes for `@uncefact/untp-utils/validation`.
 *
 * Thing-oriented and namespaced per ADR-034: the namespace identifies what
 * the code is *about* (a JSON-LD document, a JSON Schema reference, the
 * payload being validated), not the activity that detected it. Stable;
 * consumers may branch on them with exhaustive switches.
 */

/**
 * Codes for errors produced by {@link validateJsonLd}.
 */
export const JsonLdValidationCode = {
  /** Document is not a non-null object. */
  InvalidShape: 'jsonld.invalid-shape',
  /** `jsonld.toRDF(safe: true)` rejected the document. */
  ExpansionFailed: 'jsonld.expansion-failed',
} as const;

export type JsonLdValidationCode = (typeof JsonLdValidationCode)[keyof typeof JsonLdValidationCode];

/**
 * Codes for errors produced by {@link validateAgainstSchemas}.
 */
export const SchemaValidationCode = {
  /** The schema URL could not be fetched (network failure, non-200, non-JSON). */
  SchemaFetchFailed: 'schema.fetch-failed',
  /** The fetched schema document could not be compiled by Ajv (malformed schema, duplicate `$id`, etc.). */
  SchemaCompilationFailed: 'schema.compilation-failed',
  /** The payload failed Ajv validation against one of the supplied schemas. */
  PayloadInvalid: 'schema.payload-invalid',
} as const;

export type SchemaValidationCode = (typeof SchemaValidationCode)[keyof typeof SchemaValidationCode];

/**
 * Codes for errors produced by `@uncefact/untp-utils/schema-loaders`.
 */
export const SchemaLoaderCode = {
  /** Network request to the schema URL failed. */
  NetworkError: 'schema-loader.network-error',
  /** Schema URL returned a non-2xx HTTP status. */
  HttpError: 'schema-loader.http-error',
  /** Response body could not be parsed as JSON. */
  InvalidJson: 'schema-loader.invalid-json',
} as const;

export type SchemaLoaderCode = (typeof SchemaLoaderCode)[keyof typeof SchemaLoaderCode];
