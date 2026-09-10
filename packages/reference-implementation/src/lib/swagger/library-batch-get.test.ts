import { credentialRecordSchema } from '@/lib/library/credential-record-projection';
import { NOT_FOUND_LIBRARY_READ_MESSAGE, recordUnreadableMessage } from '@/lib/library/library-read-errors';
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
      headers?: Record<string, { $ref?: string }>;
      content?: Record<string, { schema?: JsonSchema; examples?: Record<string, Example> }>;
    }
  >;
};
type Spec = {
  paths?: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, JsonSchema>; headers?: Record<string, { description?: string }> };
};

describe('published POST /library/batch-get contract (#963)', () => {
  let operation: Operation;
  let schemas: Record<string, JsonSchema>;
  let spec: Spec;

  beforeAll(async () => {
    spec = (await getApiDocs()) as Spec;
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

  it('publishes the 200 body with required data and failures arrays', () => {
    const schema = operation.responses?.['200']?.content?.['application/json']?.schema;

    expect(schema?.required).toEqual(expect.arrayContaining(['data', 'failures']));
    expect(schema?.properties?.data?.type).toBe('array');
    expect(schema?.properties?.data?.items?.$ref).toBe('#/components/schemas/CredentialRecord');
    expect(schema?.properties?.failures).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/LibraryReadFailure' },
    });
  });

  it('documents validation-first submitted-count rejection and the attached 413 response', () => {
    const description = oneLine(operation.responses?.['400']?.description);
    expect(description).toContain('BATCH_GET_LIMIT_EXCEEDED');
    expect(description).toContain('counted as submitted before duplicate removal');
    expect(description).toContain('Validation is checked before the limit');
    expect(operation.responses?.['413']).toEqual({ $ref: '#/components/responses/PayloadTooLargeResponse' });
  });

  it('publishes a mixed-outcome example whose rows pass the strict keyless record schema in request order', () => {
    // Both arrays are populated on purpose: an example with an empty
    // `failures` shows a client only the shape it already expects, and this
    // response puts returned rows and unreturnable ids side by side (ADR-057
    // decision 1).
    const examples = operation.responses?.['200']?.content?.['application/json']?.examples ?? {};
    const mixed = examples.mixedOutcome?.value as
      | { data?: Record<string, unknown>[]; failures?: { id: string; code: string; message: string }[] }
      | undefined;
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
    const failures = mixed?.failures ?? [];
    expect(failures).toHaveLength(1);
    expect(failures[0].code).toBe('RECORD_UNREADABLE');
    expect(failures[0].message).toBe(recordUnreadableMessage(failures[0].id));
  });

  it('publishes an all-failed example that accounts for unreadable and missing ids', () => {
    const examples = operation.responses?.['200']?.content?.['application/json']?.examples ?? {};
    expect(examples.allFailed?.value).toMatchObject({
      data: [],
      failures: [
        { id: 'damaged-record-1', code: 'RECORD_UNREADABLE' },
        { id: 'missing-record-1', code: 'NOT_FOUND' },
      ],
    });

    // Both example messages are the runtime constants rather than hand-copied
    // twins, so a wording change cannot leave two wrong examples published.
    const failures = (examples.allFailed?.value as { failures: { id: string; message: string }[] }).failures;
    expect(failures[0].message).toBe(recordUnreadableMessage(failures[0].id));
    expect(failures[1].message).toBe(NOT_FOUND_LIBRARY_READ_MESSAGE);
  });

  it('publishes the first-appearance order of failures, not only of data', () => {
    // ADR-057 decision 9 promises it and the walk delivers it, but a caller
    // pairing its request list against `failures` by index can only read that
    // guarantee here.
    expect(oneLine(operation.description)).toContain('`failures` keeps the same first-appearance order as `data`');
  });

  it('declares the correlation header the failure messages tell the caller to quote', () => {
    for (const status of ['200', '500']) {
      expect(operation.responses?.[status]?.headers?.['x-correlation-id']).toEqual({
        $ref: '#/components/headers/CorrelationId',
      });
    }
    expect(spec.components?.headers?.CorrelationId).toBeDefined();

    // The middleware validates an inbound id and replaces one it does not
    // trust, so a description promising an echo would tell a caller its own
    // value comes back and leave it correlating on an id the service never
    // used.
    const description = spec.components?.headers?.CorrelationId?.description ?? '';
    expect(description).not.toContain('echoed');
    expect(description).toContain('replaced');
  });
});
