import { credentialRecordDetailSchema } from '@/lib/library/credential-record-projection';
import { getApiDocs } from './swagger';

type Response = {
  $ref?: string;
  description?: string;
  headers?: Record<string, { schema?: { type?: string; enum?: string[] } }>;
  content?: Record<string, { schema?: { $ref?: string }; examples?: Record<string, { value: unknown }> }>;
};
type Operation = {
  operationId?: string;
  description?: string;
  parameters?: Array<{ name?: string; in?: string; $ref?: string }>;
  responses?: Record<string, Response>;
};
type Schema = { description?: string; properties?: Record<string, { description?: string }> };
type Spec = { paths?: Record<string, Record<string, Operation>>; components?: { schemas?: Record<string, Schema> } };

/**
 * The sentence the panel ruled belongs on the two record components and the
 * operation, and never on the shared envelope, because the register route
 * returns that same envelope for a generation 1 that really ran.
 */
const ISSUANCE_ASSERTION = 'generation 1 is an issuance assertion rather than an executed run';

/** The operation description is a wrapped block, so its sentences carry line breaks. */
function oneLine(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ');
}

describe('published GET /library/{id} contract (#964)', () => {
  let operation: Operation;
  let schemas: Record<string, Schema>;

  beforeAll(async () => {
    const spec = (await getApiDocs()) as Spec;
    operation = spec.paths?.['/library/{id}']?.get as Operation;
    schemas = spec.components?.schemas ?? {};
  });

  it('documents the operation id and opaque LibraryRecordId path parameter', () => {
    expect(operation.operationId).toBe('getLibraryRecord');
    expect(operation.parameters).toEqual(expect.arrayContaining([{ $ref: '#/components/parameters/LibraryRecordId' }]));
  });

  it('documents the detail component and no-store response header', () => {
    const response = operation.responses?.['200'];
    expect(response?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/CredentialRecordDetail');
    expect(response?.headers?.['Cache-Control']?.schema).toEqual({ type: 'string', enum: ['no-store'] });
  });

  it('publishes examples for native and external custody states', () => {
    const examples = operation.responses?.['200']?.content?.['application/json']?.examples;
    expect(Object.keys(examples ?? {})).toEqual(
      expect.arrayContaining([
        'nativeEncrypted',
        'nativeUnencrypted',
        'externalProtected',
        'externalUnopened',
        'externalNoCopy',
      ]),
    );
  });

  it('publishes every 200 example as a complete record the detail schema accepts', () => {
    const examples = operation.responses?.['200']?.content?.['application/json']?.examples ?? {};
    const entries = Object.entries(examples);
    expect(entries.length).toBeGreaterThan(0);

    const keySets = entries.map(([name, example]) => {
      const parsed = credentialRecordDetailSchema.safeParse(example.value);
      expect(
        parsed.success ? [] : parsed.error.issues.map((issue) => `${name}: ${issue.path.join('.')} ${issue.message}`),
      ).toEqual([]);
      return Object.keys(example.value as Record<string, unknown>).sort();
    });
    keySets.forEach((keys) => expect(keys).toEqual(keySets[0]));
  });

  /**
   * The values a registration that could not open the ciphertext actually
   * writes: `settleUnopened` sets retrieval PASS and decryption FAIL and
   * leaves the other five NOT_RUN, and the message is the `encrypted-no-key`
   * literal from `decryptionFailureOf`, both in
   * `src/lib/library/register-external-credential.ts`. The literals are not
   * exported, so they are inlined here; an example that drifts from the
   * writer publishes a row the service never produces.
   */
  it('pins the externalUnopened example to the row the writer settles', () => {
    const examples = operation.responses?.['200']?.content?.['application/json']?.examples;
    const value = examples?.externalUnopened?.value as { verification?: Record<string, unknown> };

    expect(value.verification?.checks).toEqual({
      retrieval: 'pass',
      decryption: 'fail',
      digest: 'not_run',
      proof: 'not_run',
      status: 'not_run',
      temporal: 'not_run',
      schemaConformance: 'not_run',
    });
    expect(value.verification?.failure).toEqual({
      code: 'DECRYPTION_REQUIRED',
      message:
        'The fetched credential is encrypted and no decryption key was supplied; re-verify with a key to open it.',
      retryable: true,
    });
  });

  /**
   * The full literal `retrievalFailure` composes for a retryable refusal: the
   * refusal sentence from `retrievalRefusal` followed by the retry sentence,
   * in the same writer module.
   */
  it('pins the externalNoCopy failure message to the writer full literal', () => {
    const examples = operation.responses?.['200']?.content?.['application/json']?.examples;
    const value = examples?.externalNoCopy?.value as { verification?: { failure?: { message?: string } } };

    expect(value.verification?.failure?.message).toBe(
      'The source could not be reached. Retry via re-verify once the source is reachable.',
    );
  });

  it('qualifies a native generation 1 on both record components and the operation, never on the shared envelope', () => {
    expect(oneLine(operation.description)).toContain(ISSUANCE_ASSERTION);
    expect(oneLine(schemas.CredentialRecord?.properties?.verification?.description)).toContain(ISSUANCE_ASSERTION);
    expect(oneLine(schemas.CredentialRecordDetail?.properties?.verification?.description)).toContain(
      ISSUANCE_ASSERTION,
    );
    // The register route returns this component for a generation 1 that ran,
    // so the qualification would be wrong there.
    expect(oneLine(schemas.VerificationEnvelope?.description)).not.toContain(ISSUANCE_ASSERTION);
  });

  it('documents that a key is only ever returned with a durable-copy location', () => {
    expect(schemas.CredentialRecordDetail?.properties?.decryptionKey?.description).toContain(
      'A non-null key always comes with a non-null storageUri.',
    );
  });

  it('publishes the exact coded not-found example', () => {
    const examples = operation.responses?.['404']?.content?.['application/json']?.examples;
    expect(examples?.notFound?.value).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });
  });
});
