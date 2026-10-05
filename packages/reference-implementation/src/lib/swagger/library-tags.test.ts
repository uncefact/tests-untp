import { getApiDocs } from './swagger';
import { credentialRecordSchema } from '@/lib/library/credential-record-projection';
import { replaceLibraryTagsRequestSchema } from '@/lib/api/request-schemas/library';

type Response = {
  $ref?: string;
  description?: string;
  content?: Record<string, { schema?: { $ref?: string }; examples?: Record<string, { value?: unknown }> }>;
};
type Parameter = { $ref?: string; in?: string; name?: string; required?: boolean; schema?: unknown };
type Operation = {
  operationId?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: { $ref?: string } }> };
  responses?: Record<string, Response>;
};
type Spec = { paths?: Record<string, Record<string, Operation>> };

describe('published PUT /library/{id}/tags contract', () => {
  let operation: Operation;
  let patch: Operation;

  beforeAll(async () => {
    const spec = (await getApiDocs()) as Spec;
    operation = spec.paths?.['/library/{id}/tags']?.put as Operation;
    patch = spec.paths?.['/library/{id}']?.patch as Operation;
  });

  it('publishes the operation id, tag, path parameter and the If-Version header as PATCH documents it', () => {
    expect(operation.operationId).toBe('replaceLibraryRecordTags');
    expect(operation.tags).toEqual(['Library']);
    expect(operation.parameters?.[0]).toEqual({ $ref: '#/components/parameters/LibraryRecordId' });
    const header = operation.parameters?.find((parameter) => parameter.in === 'header');
    const patchHeader = patch.parameters?.find((parameter) => parameter.in === 'header');
    expect(header).toMatchObject({ name: 'If-Version', required: true });
    expect(header?.schema).toEqual(patchHeader?.schema);
  });

  it('takes the published request component as a required body', () => {
    expect(operation.requestBody?.required).toBe(true);
    expect(operation.requestBody?.content?.['application/json']?.schema?.$ref).toBe(
      '#/components/schemas/ReplaceLibraryTagsRequest',
    );
  });

  it('publishes every settled response status', () => {
    expect(Object.keys(operation.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
      '413',
      '500',
    ]);
    expect(operation.responses?.['401']?.$ref).toBe('#/components/responses/UnauthorisedResponse');
    expect(operation.responses?.['403']?.$ref).toBe('#/components/responses/TenantAssignmentForbiddenResponse');
    expect(operation.responses?.['413']?.$ref).toBe('#/components/responses/PayloadTooLargeResponse');
  });

  it('answers 200 with the keyless record, never the detail component', () => {
    expect(operation.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(
      '#/components/schemas/CredentialRecord',
    );
  });

  it('publishes a 200 example for each origin that the strict record schema accepts', () => {
    const examples = operation.responses?.['200']?.content?.['application/json']?.examples ?? {};
    const values = Object.values(examples).map((example) => example.value as Record<string, unknown>);
    expect(values.map((value) => value.origin).sort()).toEqual(['external', 'native']);

    for (const [name, example] of Object.entries(examples)) {
      const parsed = credentialRecordSchema.safeParse(example.value);
      expect(
        parsed.success ? [] : parsed.error.issues.map((issue) => `${name}: ${issue.path.join('.')} ${issue.message}`),
      ).toEqual([]);
      const value = example.value as { tags: unknown; tagVersion: unknown; capabilities: { taggable: unknown } };
      expect(Array.isArray(value.tags)).toBe(true);
      expect(typeof value.tagVersion).toBe('number');
      expect(value.capabilities.taggable).toBe(true);
    }
  });

  it('publishes both 400 codes, with body messages the request schema actually produces', () => {
    const examples = operation.responses?.['400']?.content?.['application/json']?.examples ?? {};
    const bodies = Object.values(examples).map((example) => example.value as { error: string; code?: string });

    expect(bodies).toContainEqual({ error: 'If-Version header is required.', code: 'INVALID_IF_VERSION' });
    expect(bodies).toContainEqual({
      error: 'If-Version must be an integer between 1 and 2147483647.',
      code: 'INVALID_IF_VERSION',
    });
    // The examples are hand-written in the route's annotation. Each expected
    // message is derived from the schema the route validates against, so a
    // reworded zod message fails here rather than leaving a published example
    // quoting a sentence the route no longer returns.
    for (const input of [{}, { tags: ['Bad'] }, { tags: ['a', 'b', 'a'] }]) {
      const parsed = replaceLibraryTagsRequestSchema.safeParse(input);
      const issue = parsed.success ? undefined : parsed.error.issues[0];
      expect(issue).toBeDefined();
      expect(bodies).toContainEqual({
        error: `${issue?.path.join('.')}: ${issue?.message}`,
        code: 'VALIDATION_FAILED',
      });
    }
  });
});
