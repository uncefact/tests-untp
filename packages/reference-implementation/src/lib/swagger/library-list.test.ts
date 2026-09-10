import { credentialRecordSchema } from '@/lib/library/credential-record-projection';
import { recordUnreadableMessage } from '@/lib/library/library-read-errors';
import { getApiDocs } from './swagger';
import { oneLine } from './published-document';

type JsonSchema = {
  $ref?: string;
  type?: string;
  required?: string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
};
type Example = { value: { data?: unknown[]; failures?: unknown[]; pagination?: Record<string, unknown> } };
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
    {
      description?: string;
      headers?: Record<string, { $ref?: string }>;
      content?: Record<string, { schema?: JsonSchema; examples?: Record<string, Example> }>;
    }
  >;
};
type Spec = {
  paths?: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, unknown>; headers?: Record<string, { description?: string }> };
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

  it('publishes a mixed-outcome example whose rows pass the strict keyless record schema', () => {
    // Both arrays are populated on purpose. An example whose `failures` is
    // empty shows a client only the shape it already expects, and the page
    // this route now returns puts readable rows and unreadable ids side by
    // side (ADR-057 decision 1).
    const examples = operation.responses?.['200']?.content?.['application/json']?.examples ?? {};
    const mixed = examples.mixedOutcomePage?.value;
    expect(mixed?.data).toHaveLength(2);
    for (const row of mixed?.data ?? []) {
      const parsed = credentialRecordSchema.safeParse(row);
      expect(parsed.success).toBe(true);
      expect(row).not.toHaveProperty('decryptionKey');
      expect(row).not.toHaveProperty('storageUri');
      expect(row).not.toHaveProperty('digestMultibase');
    }

    const failures = (mixed?.failures ?? []) as { id: string; code: string; message: string }[];
    expect(failures).toHaveLength(1);
    expect(failures[0].code).toBe('RECORD_UNREADABLE');
    expect(failures[0].message).toBe(recordUnreadableMessage(failures[0].id));

    // The page is exhausted, so `total` counts every row it consumed across
    // both arrays and `hasMore` is false. An example that showed `total` as
    // the readable rows alone would teach a client the count it must not use.
    expect(mixed?.pagination).toEqual({
      total: (mixed?.data?.length ?? 0) + failures.length,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
  });

  it('requires failures and publishes a final mixed page and a non-final all-failed page', () => {
    const response = operation.responses?.['200']?.content?.['application/json'];
    expect(response?.schema?.required).toEqual(expect.arrayContaining(['data', 'pagination', 'failures']));
    expect(response?.schema?.properties?.failures).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/LibraryReadFailure' },
    });

    const examples = response?.examples ?? {};
    expect(examples.allFailedPage?.value.data).toEqual([]);
    expect(examples.allFailedPage?.value.failures).toHaveLength(1);
    expect(examples.allFailedPage?.value.pagination).toMatchObject({ hasMore: true });

    // The example message is the runtime constant rather than a hand-copied
    // twin, so a wording change cannot leave a wrong example published.
    const [failure] = (examples.allFailedPage?.value.failures ?? []) as { id: string; message: string }[];
    expect(failure.message).toBe(recordUnreadableMessage(failure.id));
  });

  it('publishes the advance-by-limit rule, not only an example of the state it prevents', () => {
    // A client generated from this document alone never sees library.md or the
    // migration guide. Without the rule here it can write `offset +=
    // data.length` and re-request an all-failed page for ever.
    const description = oneLine(operation.responses?.['200']?.description);
    expect(description).toContain('Advance by `limit`');
    expect(description).toContain('`data` and `failures` together');
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
