import { StructuredError } from '../structured-error.js';

/**
 * Base for every diagnostic from `@uncefact/untp-utils/schema-loaders`.
 * Catch to handle any schema-loader failure generically; catch a concrete
 * subclass for specific handling.
 */
export class SchemaLoaderError extends StructuredError {}

/** The network request to the schema URL rejected (DNS failure, connection refused, etc.). */
export class SchemaLoaderNetworkError extends SchemaLoaderError {
  constructor(url: string, cause: unknown) {
    super({
      code: 'schema-loader.network-error',
      message: `Could not reach ${url}.`,
      received: cause instanceof Error ? cause.message : String(cause),
      expected: `a 2xx response from ${url}`,
      cause,
    });
  }
}

/** The schema URL responded with a non-2xx HTTP status. */
export class SchemaLoaderHttpError extends SchemaLoaderError {
  readonly status: number;
  constructor(url: string, status: number) {
    super({
      code: 'schema-loader.http-error',
      message: `${url} returned status ${status}.`,
      received: status,
      expected: '2xx',
    });
    this.status = status;
  }
}

/** The schema URL responded with a body that is not parseable as JSON. */
export class SchemaLoaderInvalidJsonError extends SchemaLoaderError {
  constructor(url: string, cause: unknown) {
    super({
      code: 'schema-loader.invalid-json',
      message: `${url} returned a body that is not valid JSON.`,
      received: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
}
