export {
  JsonLdValidationError,
  JsonLdInvalidShapeError,
  JsonLdExpansionFailedError,
  SchemaValidationError,
  SchemaFetchFailedError,
  SchemaCompilationFailedError,
  SchemaPayloadError,
} from './errors.js';
export { validateJsonLd, type ValidateJsonLdOptions } from './validate-jsonld.js';
export { validateAgainstSchemas, type SchemaReference } from './validate-against-schemas.js';
export { describeJsonLdFailure, type JsonLdFailureDescription } from './describe-jsonld-failure.js';
