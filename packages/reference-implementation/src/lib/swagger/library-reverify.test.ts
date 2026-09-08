import { getApiDocs } from './swagger';
import { oneLine } from './published-document';
import { BODY_MUST_BE_EMPTY_MESSAGE } from '@/lib/library/reverify-messages';

type Response = {
  $ref?: string;
  description?: string;
  content?: Record<string, { schema?: { $ref?: string }; examples?: Record<string, { value: unknown }> }>;
};
type Operation = {
  operationId?: string;
  description?: string;
  requestBody?: { required?: boolean; content?: Record<string, { schema?: { maxLength?: number } }> };
  parameters?: Array<{ $ref?: string }>;
  responses?: Record<string, Response>;
};
type SchemaNode = {
  $ref?: string;
  description?: string;
  properties?: Record<string, SchemaNode>;
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
};
type Spec = {
  paths?: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, SchemaNode> };
};

/** Every variant of the envelope union, however the generator nested it. */
function envelopeVariants(schemas: Record<string, SchemaNode>): SchemaNode[] {
  const envelope = schemas.CredentialRecord?.properties?.verification;
  const variants = envelope?.anyOf ?? envelope?.oneOf ?? [];
  return variants.length > 0 ? variants : envelope === undefined ? [] : [envelope];
}

describe('published POST /library/{id}/verify contract', () => {
  let operation: Operation;
  let schemas: Record<string, SchemaNode>;

  beforeAll(async () => {
    const spec = (await getApiDocs()) as Spec;
    operation = spec.paths?.['/library/{id}/verify']?.post as Operation;
    schemas = spec.components?.schemas ?? {};
  });

  it('documents the operation id and the opaque LibraryRecordId path parameter', () => {
    expect(operation.operationId).toBe('reverifyLibraryRecord');
    expect(operation.parameters).toEqual(expect.arrayContaining([{ $ref: '#/components/parameters/LibraryRecordId' }]));
  });

  it('publishes the empty-body request contract', () => {
    // Fails if the operation starts advertising a body, which is the
    // key-bearing form this release does not offer.
    expect(operation.requestBody?.required).toBe(false);
    expect(operation.requestBody?.content?.['application/octet-stream']?.schema?.maxLength).toBe(0);
  });

  it('answers 202 with the keyless CredentialRecord, never the detail component', () => {
    // The detail component carries the decryption key. Fails if this response
    // is ever pointed at it.
    const response = operation.responses?.['202'];
    expect(response?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/CredentialRecord');
  });

  it('publishes examples for the outcomes this release can produce', () => {
    const examples = operation.responses?.['202']?.content?.['application/json']?.examples;
    expect(Object.keys(examples ?? {})).toEqual(
      expect.arrayContaining([
        'externalGenerationCreated',
        'joinedPendingGeneration',
        'nativeSecondGeneration',
        'settledWithUnchangedSource',
      ]),
    );
  });

  it('publishes both 400 bodies with the codes a client branches on', () => {
    // The shared 400 examples describe field validation and malformed JSON,
    // neither of which this operation can return. Fails if it falls back to
    // them, so the one actionable error a caller must handle is unpublished.
    const examples = operation.responses?.['400']?.content?.['application/json']?.examples ?? {};
    const bodies = Object.values(examples).map((example) => example.value as { error: string; code?: string });

    expect(bodies).toContainEqual({
      error: BODY_MUST_BE_EMPTY_MESSAGE,
      code: 'VALIDATION_FAILED',
    });
    expect(bodies).toContainEqual({
      error:
        "This service holds no usable key for the record's durable copy. Re-verification with a caller-supplied key is not supported yet.",
      code: 'DECRYPTION_REQUIRED',
    });
  });

  it('describes the superseded outcome and the unobservable unwrap failure', () => {
    // Both are states a caller reaches and cannot otherwise account for: a
    // request that did no work, and a settled generation the detail poll
    // answers with a server error.
    const description = oneLine(operation.description);
    expect(description).toContain('changed while it was being prepared');
    expect(description).toContain('uncefact/tests-untp/issues/769');
  });

  it('carries the freshness pair into the published record component', () => {
    // The projection emits these on a settled external generation. Fails if
    // they are declared in the Zod schema and never reach the document, where
    // an integrator would read them.
    const withFreshness = envelopeVariants(schemas).filter(
      (variant) => variant.properties?.sourceChanged !== undefined,
    );

    expect(withFreshness.length).toBeGreaterThan(0);
    for (const variant of withFreshness) {
      expect(variant.properties?.lastSourceCheckAt).toBeDefined();
    }
  });
});
