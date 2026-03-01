export class JsonLdValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonLdValidationError';
  }
}

export async function validateJsonLd(document: unknown): Promise<void> {
  const jsonld = await import('jsonld');

  try {
    // eslint-disable-next-line @typescript-eslint/await-thenable, @typescript-eslint/no-explicit-any
    await jsonld.toRDF(document as any, { safe: true } as Parameters<typeof jsonld.toRDF>[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JsonLdValidationError(`JSON-LD validation failed: ${message}`);
  }
}
