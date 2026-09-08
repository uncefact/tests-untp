import { credentialRecordSchema } from '@/lib/library/credential-record-projection';
import { getApiDocs } from './swagger';

type Example = { value: { data?: unknown[] } };
type Operation = {
  operationId?: string;
  parameters?: Array<{
    name?: string;
    in?: string;
    style?: string;
    explode?: boolean;
    description?: string;
    schema?: { default?: unknown; [key: string]: unknown };
  }>;
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { examples?: Record<string, Example> }> }
  >;
};
type Spec = {
  paths?: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, unknown> };
};

// These literals pin the discovery package's published GET /library operation.
describe('published GET /library contract (#962)', () => {
  let operation: Operation;
  let spec: Spec;

  beforeAll(async () => {
    spec = (await getApiDocs()) as Spec;
    operation = spec.paths?.['/library']?.get as Operation;
  });

  it('publishes the operation id, all fourteen query parameters, and repeatable type encoding', () => {
    expect(operation.operationId).toBe('listLibrary');
    const parameters = operation.parameters ?? [];
    const queryParameterNames = parameters
      .filter((parameter) => parameter.in === 'query')
      .map((parameter) => parameter.name)
      .sort();
    expect(queryParameterNames).toEqual(
      [
        'type',
        'origin',
        'organisationId',
        'facilityId',
        'productId',
        'issuer',
        'encrypted',
        'status',
        'issuedFrom',
        'issuedTo',
        'sort',
        'q',
        'limit',
        'offset',
      ].sort(),
    );
    const type = parameters.find((parameter) => parameter.name === 'type');
    expect(type).toMatchObject({ in: 'query', style: 'form', explode: true });
    expect(type?.description).toContain(
      'A native record with no recorded core type matches no value until an extraction records one; a record whose types name no core kind never matches a `type` value.',
    );
    const limit = parameters.find((parameter) => parameter.name === 'limit');
    expect(limit?.description).toContain('smaller of 20 and the configured deployment maximum');
    expect(limit?.schema?.default).toBeUndefined();
  });

  it('publishes the named reusable filter components and deferred-error contract', () => {
    expect(spec.components?.schemas).toEqual(
      expect.objectContaining({
        CredentialType: expect.anything(),
        Origin: expect.anything(),
        VerificationSummary: expect.anything(),
      }),
    );
    const description = operation.responses?.['400']?.description ?? '';
    expect(description).toContain('PAGE_LIMIT_EXCEEDED');
    expect(description).toContain('FREE_TEXT_SEARCH_DEFERRED');
  });

  it('publishes a mixed example whose rows pass the strict keyless record schema', () => {
    const examples = operation.responses?.['200']?.content?.['application/json']?.examples ?? {};
    const mixed = examples.mixedPage?.value;
    expect(mixed?.data).toHaveLength(2);
    for (const row of mixed?.data ?? []) {
      const parsed = credentialRecordSchema.safeParse(row);
      expect(parsed.success).toBe(true);
      expect(row).not.toHaveProperty('decryptionKey');
      expect(row).not.toHaveProperty('storageUri');
      expect(row).not.toHaveProperty('digestMultibase');
    }
  });
});
