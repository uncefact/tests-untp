import { getApiDocs } from './swagger';
import { oneLine } from './published-document';

type Operation = {
  operationId?: string;
  description?: string;
  requestBody?: {
    content?: Record<string, { schema?: { $ref?: string } }>;
  };
};

type Spec = {
  paths?: Record<string, Record<string, Operation>>;
};

describe('published library register and annotation operation text', () => {
  it('publishes the register operation with its request schema reference', async () => {
    const spec = (await getApiDocs()) as Spec;
    const operation = spec.paths?.['/library']?.post;

    expect(operation).toBeDefined();
    expect(operation?.operationId).toBe('registerExternalCredential');
    expect(operation?.requestBody?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/RegisterExternalCredentialRequest',
    });
    expect(oneLine(operation?.description)).toContain('cannot contain a NUL character');
  });

  it('names every library operation so generated clients never invent one', async () => {
    const spec = (await getApiDocs()) as Spec;
    const libraryOperations = Object.entries(spec.paths ?? {})
      .filter(([path]) => path === '/library' || path.startsWith('/library/'))
      .flatMap(([path, methods]) =>
        Object.entries(methods).map(([method, operation]) => [
          `${method.toUpperCase()} ${path}`,
          operation.operationId,
        ]),
      );

    expect(libraryOperations.length).toBeGreaterThanOrEqual(7);
    for (const [route, operationId] of libraryOperations) {
      expect(`${route}: ${operationId ?? 'null'}`).not.toMatch(/: null$/);
    }
    expect(libraryOperations).toContainEqual(['POST /library', 'registerExternalCredential']);
  });

  it('publishes the PATCH operation with the shared NUL rule', async () => {
    const spec = (await getApiDocs()) as Spec;
    const patch = spec.paths?.['/library/{id}']?.patch;

    expect(patch).toBeDefined();
    expect(oneLine(patch?.description)).toContain('cannot contain a NUL character because the value cannot be stored');
  });
});
