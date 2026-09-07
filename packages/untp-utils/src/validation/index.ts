export {
  JsonLdValidationError,
  JsonLdInvalidShapeError,
  JsonLdExpansionFailedError,
  SchemaValidationError,
  SchemaFetchFailedError,
  SchemaCompilationFailedError,
  SchemaPayloadError,
} from './errors.js';
export {
  expandJsonLd,
  validateJsonLd,
  type JsonLdDocumentLoader,
  type ValidateJsonLdOptions,
} from './validate-jsonld.js';
export { validateAgainstSchemas, type SchemaReference } from './validate-against-schemas.js';
export {
  describeJsonLdFailure,
  SAFE_EVENT_FIELDS,
  type JsonLdContextFailure,
  type JsonLdDocumentFailure,
  type JsonLdFailureDescription,
  type SafeJsonLdFields,
} from './describe-jsonld-failure.js';
export type { BundledFallbackEvent, BundledFallbackOptions } from '../bundle/fallback.js';
