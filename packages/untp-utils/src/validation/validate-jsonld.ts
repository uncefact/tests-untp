import type { JsonLdDocument } from 'jsonld';
import { JsonLdExpansionFailedError, JsonLdInvalidShapeError } from './errors.js';

export interface ValidateJsonLdOptions {
  /** Whether to use safe mode for JSON-LD expansion. Defaults to true. */
  safe?: boolean;
}

/**
 * Catches malformed contexts, undefined terms, and structurally invalid
 * linked data by expanding to RDF in safe mode (unless explicitly disabled).
 *
 * @see https://www.w3.org/TR/json-ld11-api/#dfn-safe-mode JSON-LD safe mode.
 * @throws {JsonLdInvalidShapeError} if `document` is not a non-null object.
 * @throws {JsonLdExpansionFailedError} if `jsonld.toRDF` rejects.
 */
export async function validateJsonLd(document: unknown, options?: ValidateJsonLdOptions): Promise<void> {
  if (typeof document !== 'object' || document === null) {
    throw new JsonLdInvalidShapeError(document);
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
  } catch (cause) {
    throw new JsonLdExpansionFailedError(cause);
  }
}
