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

  const jsonld = await import('jsonld');

  try {
    // Expands the document and converts it to RDF.
    // See https://opensource.unicc.org/un/unece/uncefact/spec-untp/-/issues/369#issuecomment-2878856840
    // eslint-disable-next-line @typescript-eslint/await-thenable
    await jsonld.toRDF(document as JsonLdDocument, { safe: true } as Parameters<typeof jsonld.toRDF>[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JsonLdValidationError(`JSON-LD validation failed: ${message}`);
  }
}
