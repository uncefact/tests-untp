import { getApiDocs } from './swagger';
import { oneLine } from './published-document';

type Operation = {
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
    expect(operation?.requestBody?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/RegisterExternalCredentialRequest',
    });
    expect(oneLine(operation?.description)).toContain('cannot contain a NUL character');
  });

  it('publishes the PATCH operation with the shared NUL rule', async () => {
    const spec = (await getApiDocs()) as Spec;
    const patch = spec.paths?.['/library/{id}']?.patch;

    expect(patch).toBeDefined();
    expect(oneLine(patch?.description)).toContain('cannot contain a NUL character because the value cannot be stored');
  });
});
