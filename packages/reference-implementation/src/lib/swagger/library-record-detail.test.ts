import {
  credentialRecordDetailSchema,
  DECRYPTION_KEY_UNAVAILABLE_MESSAGE,
} from '@/lib/library/credential-record-projection';
import { recordUnreadableMessage } from '@/lib/library/library-read-errors';
import { generateOpenAPISchemas } from './schemas';
import { getApiDocs } from './swagger';
import { collectEnums, oneLine } from './published-document';

type BodySchema = {
  $ref?: string;
  type?: string;
  required?: string[];
  enum?: string[];
  properties?: Record<string, BodySchema>;
  oneOf?: BodySchema[];
};
type Response = {
  $ref?: string;
  description?: string;
  headers?: Record<string, { $ref?: string; schema?: { type?: string; enum?: string[] } }>;
  content?: Record<string, { schema?: BodySchema; examples?: Record<string, { value: unknown }> }>;
};
type Operation = {
  operationId?: string;
  description?: string;
  parameters?: Array<{ name?: string; in?: string; $ref?: string }>;
  responses?: Record<string, Response>;
};
type Schema = {
  description?: string;
  type?: string;
  enum?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
};
type Spec = {
  paths?: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, Schema>; headers?: Record<string, { description?: string }> };
};

/**
 * The sentence the panel ruled belongs on the two record components and the
 * operation, and never on the shared envelope, because the register route
 * returns that same envelope for a generation 1 that really ran.
 */
const ISSUANCE_ASSERTION = 'generation 1 is an issuance assertion rather than an executed run';

describe('published GET /library/{id} contract (#964)', () => {
  let operation: Operation;
  let schemas: Record<string, Schema>;
  let spec: Spec;

  beforeAll(async () => {
    spec = (await getApiDocs()) as Spec;
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
        'externalKeyUnavailable',
        'externalUnopened',
        'externalNoCopy',
      ]),
    );
  });

  it('publishes the key-unavailable example with the runtime warning message', () => {
    // Anchored to the constant the projection writes rather than to a copy of
    // its wording, so rewording the warning cannot leave the API document
    // showing a sentence no response ever carries.
    const examples = operation.responses?.['200']?.content?.['application/json']?.examples ?? {};
    const record = examples.externalKeyUnavailable?.value as
      | { warnings?: { code: string; message: string }[] }
      | undefined;
    expect(record?.warnings).toEqual([
      { code: 'DECRYPTION_KEY_UNAVAILABLE', message: DECRYPTION_KEY_UNAVAILABLE_MESSAGE },
    ]);
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
        'The fetched credential is encrypted and this service holds no key that opens it. The copy is kept as fetched. Retry with sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.',
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

  it('assembles the three warning components into the spec exactly as generated', () => {
    // The split itself is pinned against the generator in `schemas.test.ts`.
    // The only claim this document can make that the generator's cannot is
    // that assembly carries those components through unaltered, so that is
    // all this asserts; repeating the five split assertions here would be a
    // copy that cannot fail on its own.
    const generated = generateOpenAPISchemas() as unknown as Record<string, Schema>;
    for (const name of ['CredentialRecord', 'CredentialRecordDetail', 'CredentialRecordWarning']) {
      expect(schemas[name]).toEqual(generated[name]);
    }
    expect(collectEnums(schemas.CredentialRecordDetail?.properties?.warnings?.items)).toContain(
      'DECRYPTION_KEY_UNAVAILABLE',
    );
  });

  it('publishes exactly the keyless warning codes plus the key-unavailable one', () => {
    // The detail union is composed from the keyless one rather than restated,
    // so a code added to the record contract reaches the detail contract with
    // it. A hand-rebuilt detail union would drift here first.
    const detailCodes = collectEnums(schemas.CredentialRecordDetail?.properties?.warnings?.items);
    const keylessCodes = collectEnums(schemas.CredentialRecord?.properties?.warnings?.items);

    expect(keylessCodes.length).toBeGreaterThan(0);
    expect([...new Set(detailCodes)].sort()).toEqual(
      [...new Set([...keylessCodes, 'DECRYPTION_KEY_UNAVAILABLE'])].sort(),
    );
  });

  it('publishes the exact coded not-found example', () => {
    const examples = operation.responses?.['404']?.content?.['application/json']?.examples;
    expect(examples?.notFound?.value).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });
  });

  it('publishes both 500 body shapes, not only the coded one', () => {
    // Two of the three documented 500 categories answer the shared sanitised
    // body, which carries neither `code` nor `id`. A single inline object
    // requiring all three would tell a generated client that both are always
    // present and break it on every database fault.
    const response = operation.responses?.['500'];
    const members = response?.content?.['application/json']?.schema?.oneOf ?? [];
    expect(members).toHaveLength(2);

    const coded = members.find((member) => member.properties?.code?.enum?.includes('RECORD_UNREADABLE'));
    expect(coded?.required).toEqual(expect.arrayContaining(['error', 'code', 'id']));
    expect(members.some((member) => member.$ref === '#/components/schemas/ErrorResponse')).toBe(true);

    const examples = response?.content?.['application/json']?.examples ?? {};
    const unreadable = examples.recordUnreadable?.value as { error: string; code: string; id: string };
    expect(unreadable.code).toBe('RECORD_UNREADABLE');
    // The example's message is the runtime constant, not a hand-copied twin
    // that a later wording change would leave behind.
    expect(unreadable.error).toBe(recordUnreadableMessage(unreadable.id));
    expect(examples.unexpected?.value).toEqual({ error: expect.stringContaining('correlation id') });
  });

  it('declares the correlation header the 500 message tells the caller to quote', () => {
    for (const status of ['200', '500']) {
      expect(operation.responses?.[status]?.headers?.['x-correlation-id']).toEqual({
        $ref: '#/components/headers/CorrelationId',
      });
    }
    // The middleware validates an inbound id and replaces one it does not
    // trust, so a description promising an echo would tell a caller its own
    // value comes back and leave it correlating on an id the service never
    // used.
    const description = spec.components?.headers?.CorrelationId?.description ?? '';
    expect(description).toContain('correlation id');
    expect(description).not.toContain('echoed');
    expect(description).toContain('replaced');
  });
});
