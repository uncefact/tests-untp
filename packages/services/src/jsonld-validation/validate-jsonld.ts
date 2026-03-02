import type { JsonLdDocument } from 'jsonld';

export class JsonLdValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonLdValidationError';
  }
}

export async function validateJsonLd(document: unknown): Promise<void> {
  if (typeof document !== 'object' || document === null) {
    throw new JsonLdValidationError('JSON-LD document must be an object');
  }

  // Dynamic import: jsonld pulls in undici/TextDecoder which aren't
  // available in jsdom, so we load it lazily to allow test mocking.
  const jsonldModule = await import('jsonld');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonld = ('default' in jsonldModule ? (jsonldModule as any).default : jsonldModule) as typeof import('jsonld');

  try {
    // Expands the document and converts it to RDF.
    // See https://opensource.unicc.org/un/unece/uncefact/spec-untp/-/issues/369#issuecomment-2878856840
    await jsonld.toRDF(document as JsonLdDocument, { safe: true } as Parameters<typeof jsonld.toRDF>[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JsonLdValidationError(`JSON-LD validation failed: ${message}`);
  }
}
