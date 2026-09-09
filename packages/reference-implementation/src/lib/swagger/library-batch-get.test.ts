import { credentialRecordSchema } from '@/lib/library/credential-record-projection';
import { getApiDocs } from './swagger';
import { collectAdditionalProperties, oneLine } from './published-document';

type JsonSchema = {
  $ref?: string;
  type?: string;
  required?: string[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  description?: string;
  additionalProperties?: unknown;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
};

type Example = { value: unknown };
type Operation = {
  operationId?: string;
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: { $ref?: string } }>;
  };
  description?: string;
  responses?: Record<
    string,
    {
      $ref?: string;
      description?: string;
      content?: Record<string, { schema?: JsonSchema; examples?: Record<string, Example> }>;
    }
  >;
};
type Spec = {
  paths?: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, JsonSchema> };
};

describe('published POST /library/batch-get contract (#963)', () => {
  let operation: Operation;
  let schemas: Record<string, JsonSchema>;

  beforeAll(async () => {
    const spec = (await getApiDocs()) as Spec;
    operation = spec.paths?.['/library/batch-get']?.post as Operation;
    schemas = spec.components?.schemas ?? {};
  });

  it('publishes the operation id and reusable request component', () => {
    expect(operation.operationId).toBe('batchGetLibraryRecords');
    expect(operation.requestBody).toMatchObject({
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/BatchGetLibraryRequest' } } },
    });
  });

  it('publishes the required non-empty id array without a deployment-specific item cap', () => {
    const request = schemas.BatchGetLibraryRequest;
    const ids = request.properties?.ids;
    const item = ids?.items;

    expect(request.required).toContain('ids');
    expect(ids).toMatchObject({ type: 'array', minItems: 1 });
    expect(ids?.description).toBe(
      "Bounded by the deployment's configured maximum (default 500); see the operation description",
    );
    expect(item).toMatchObject({ type: 'string', minLength: 1 });
    expect(ids?.maxItems).toBeUndefined();
    expect(ids?.uniqueItems).toBeUndefined();
  });

  it('does not document unknown request keys as rejected at any generated object level', () => {
    expect(collectAdditionalProperties(schemas.BatchGetLibraryRequest)).not.toContain(false);
  });

  it('publishes the 200 body as a required data array of the shared CredentialRecord component', () => {
    const schema = operation.responses?.['200']?.content?.['application/json']?.schema;

    expect(schema?.required).toContain('data');
    expect(schema?.properties?.data?.type).toBe('array');
    expect(schema?.properties?.data?.items?.$ref).toBe('#/components/schemas/CredentialRecord');
  });

  it('documents validation-first submitted-count rejection and the attached 413 response', () => {
    const description = oneLine(operation.responses?.['400']?.description);
    expect(description).toContain('BATCH_GET_LIMIT_EXCEEDED');
    expect(description).toContain('counted as submitted before duplicate removal');
    expect(description).toContain('Validation is checked before the limit');
    expect(operation.responses?.['413']).toEqual({ $ref: '#/components/responses/PayloadTooLargeResponse' });
  });

  it('publishes a mixed example whose rows pass the strict keyless record schema in request order', () => {
    const examples = operation.responses?.['200']?.content?.['application/json']?.examples ?? {};
    const mixed = examples.mixedRecords?.value as { data?: Record<string, unknown>[] } | undefined;
    expect(mixed?.data).toHaveLength(2);

    const ids = mixed?.data?.map((row) => row.id);
    expect(ids).toEqual(['record-external-1', 'record-native-1']);
    for (const row of mixed?.data ?? []) {
      expect(credentialRecordSchema.safeParse(row).success).toBe(true);
      expect(row).not.toHaveProperty('tenantId');
      expect(row).not.toHaveProperty('storageUri');
      expect(row).not.toHaveProperty('digestMultibase');
      expect(row).not.toHaveProperty('decryptionKey');
    }
  });
});
