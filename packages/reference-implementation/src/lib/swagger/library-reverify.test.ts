import { getApiDocs } from './swagger';
import { oneLine } from './published-document';
import { credentialRecordSchema } from '@/lib/library/credential-record-projection';
import { verifyLibraryRecordRequestSchema } from '@/lib/api/request-schemas/library';
import {
  DECRYPTION_REQUIRED_MESSAGE,
  SOURCE_ENCRYPTION_NOT_ALLOWED_MESSAGE,
  STORED_COPY_KEY_MISMATCH_MESSAGE,
  storedCopyReadFailedMessage,
  VERIFICATION_IN_PROGRESS_MESSAGE,
  VERIFICATION_RACE_LOST_MESSAGE,
} from '@/lib/library/reverify-messages';

type Response = {
  $ref?: string;
  description?: string;
  headers?: Record<string, unknown>;
  content?: Record<string, { schema?: { $ref?: string }; examples?: Record<string, { value: unknown }> }>;
};
type Operation = {
  operationId?: string;
  description?: string;
  requestBody?: { required?: boolean; content?: Record<string, { schema?: SchemaNode }> };
  parameters?: Array<{ $ref?: string }>;
  responses?: Record<string, Response>;
};
type SchemaNode = {
  $ref?: string;
  description?: string;
  required?: string[];
  pattern?: string;
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

  it('publishes the optional key-bearing request contract', () => {
    // Fails if the body is made mandatory for ordinary re-verification, or if
    // the late-key schema drifts from the schema enforced at the route.
    expect(operation.requestBody?.required).toBe(false);
    expect(operation.requestBody?.content?.['application/json']?.schema?.$ref).toBe(
      '#/components/schemas/VerifyLibraryRecordRequest',
    );
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
        'recoveredWithoutDurableCopy',
        'recoveredDuplicateContent',
        'recoveredRejectedReplacement',
        'lateKeyOpenedTheStoredCopy',
        'lateKeyDidNotOpenTheCopy',
        'lateDecryptRevealsDuplicate',
        'storedCopyCouldNotBeRead',
      ]),
    );
  });

  it('publishes every 202 example as a complete record the CredentialRecord schema accepts', () => {
    // Fails if a published recovery example regresses
    // to a fragment the schema would refuse.
    const examples = operation.responses?.['202']?.content?.['application/json']?.examples ?? {};
    const entries = Object.entries(examples);
    expect(entries.length).toBeGreaterThan(0);

    for (const [name, example] of entries) {
      const parsed = credentialRecordSchema.safeParse(example.value);
      expect(
        parsed.success ? [] : parsed.error.issues.map((issue) => `${name}: ${issue.path.join('.')} ${issue.message}`),
      ).toEqual([]);
    }
  });

  it('publishes both 400 bodies with the codes a client branches on', () => {
    // Fails if the key-bearing validation or the unopened-copy refusal is
    // missing from the operation's examples.
    const examples = operation.responses?.['400']?.content?.['application/json']?.examples ?? {};
    const bodies = Object.values(examples).map((example) => example.value as { error: string; code?: string });

    // Produced by running the schema the route actually validates against,
    // not by writing out a plausible zod issue string. A hand-written copy
    // would let a zod upgrade that rewords `Required` break the published
    // contract with nothing failing near the change.
    // Parsed from the body the example is about: one that names the wrapper
    // and leaves the key out, which is the more informative of the two
    // shapes a caller gets wrong.
    const parsed = verifyLibraryRecordRequestSchema.safeParse({ sourceEncryption: {} });
    const issue = parsed.success ? undefined : parsed.error.issues[0];
    expect(issue).toBeDefined();
    expect(bodies).toContainEqual({
      error: `${issue?.path.join('.')}: ${issue?.message}`,
      code: 'VALIDATION_FAILED',
    });

    // The other two quote the constants the code throws, so a reworded
    // refusal fails here rather than shipping a contract nothing produces.
    expect(bodies).toContainEqual({ error: DECRYPTION_REQUIRED_MESSAGE, code: 'DECRYPTION_REQUIRED' });
    expect(bodies).toContainEqual({
      error: SOURCE_ENCRYPTION_NOT_ALLOWED_MESSAGE,
      code: 'SOURCE_ENCRYPTION_NOT_ALLOWED',
    });
  });

  it('requires both nested fields on the generated request component', () => {
    // `zod-to-json-schema` has looked straight through a wrapper before and
    // dropped the rule inside it (#803). Asserting only the `$ref` would let
    // the component ship with `sourceEncryption` or `decryptionKey` optional,
    // documenting an empty body as acceptable while the route answers 400.
    const component = schemas.VerifyLibraryRecordRequest;
    expect(component?.required).toEqual(['sourceEncryption']);
    const nested = component?.properties?.sourceEncryption;
    expect(nested?.required).toEqual(['decryptionKey']);
    expect(nested?.properties?.decryptionKey).toBeDefined();
  });

  it('publishes the 409 and the Location header a key-bearing caller polls', () => {
    // The route emits the header at runtime and a route test pins that. This
    // pins the document, so the response or its header cannot be deleted from
    // the annotation without a failure.
    //
    // E3. One status and one code carry two states with different remedies:
    // wait for a settlement, or send the key again now. An integrator
    // branching on the code alone cannot tell them apart, so both bodies are
    // published, and both are compared with the constants the route throws
    // rather than with a copy of their wording.
    const conflict = operation.responses?.['409'];
    expect(conflict?.description).toContain('in progress');
    expect(conflict?.headers?.Location).toBeDefined();
    const examples = conflict?.content?.['application/json']?.examples ?? {};
    const bodies = Object.values(examples).map((example) => example.value as { error: string; code?: string });
    expect(bodies).toContainEqual({ error: VERIFICATION_IN_PROGRESS_MESSAGE, code: 'VERIFICATION_IN_PROGRESS' });
    expect(bodies).toContainEqual({ error: VERIFICATION_RACE_LOST_MESSAGE, code: 'VERIFICATION_IN_PROGRESS' });
    // Named, so neither example can be dropped by renaming the other onto it.
    expect(Object.keys(examples)).toEqual(expect.arrayContaining(['verificationInProgress', 'verificationRaceLost']));
  });

  it('describes the 500 as covering both acquisition modes and names the settled code', () => {
    // A description scoped to "a no-copy
    // recovery" tells an integrator a key-bearing recovery cannot produce
    // this response, which is false: both modes reach the same preflight.
    const description = oneLine(operation.responses?.['500']?.description);
    expect(description).toContain('STORAGE_FAILED');
    expect(description).toContain('CREDENTIALS_ENCRYPTION_UNAVAILABLE');
    expect(description).toContain("record's own durable copy");
    expect(description).not.toMatch(/failure while (fetching|acquiring) or finalising a no-copy recovery/);

    // `classifyRecoveryFailure` settles STORAGE_FAILED for the storage
    // and encryption classes only; a twice-collided content identity and any
    // unexpected throw settle VERIFICATION_UNAVAILABLE, and both of those
    // answer this same 500. A description that names one code for "every
    // other failure" tells an integrator to branch on a code the next
    // `GET /library/{id}` will not carry.
    expect(description).toContain('VERIFICATION_UNAVAILABLE');
    expect(description).not.toMatch(/settles that reservation `FAILED`\s+`STORAGE_FAILED` too/);
  });

  it('publishes the key pattern the route actually enforces, in both cases', () => {
    // `zod-to-json-schema` drops the regex's `i` flag, so a
    // lowercase-only character class publishes `^[a-f0-9]{64}$` while the
    // runtime accepts uppercase. A generated client or a schema-validating
    // gateway would refuse a key this endpoint takes. Fails if the character
    // class narrows back to one case.
    const pattern = schemas.VerifyLibraryRecordRequest?.properties?.sourceEncryption?.properties?.decryptionKey
      ?.pattern as string | undefined;
    expect(pattern).toBeDefined();
    const published = new RegExp(pattern as string);
    const uppercase = 'A1B2C3D4'.repeat(8);
    expect(uppercase).toHaveLength(64);
    expect(published.test(uppercase)).toBe(true);
    // The runtime and the document agree, which is the point.
    expect(verifyLibraryRecordRequestSchema.safeParse({ sourceEncryption: { decryptionKey: uppercase } }).success).toBe(
      true,
    );
    expect(published.test('g'.repeat(64))).toBe(false);
  });

  it('publishes a late-decrypt duplicate example, the one key-bearing outcome that had none', () => {
    // A stored copy the supplied key opens whose
    // content already belongs to another record keeps this record and carries
    // an advisory DUPLICATE_CONTENT warning naming the holder. The existing
    // duplicate example covers the mode A re-fetch only, whose checks differ.
    const examples = operation.responses?.['202']?.content?.['application/json']?.examples ?? {};
    const example = examples.lateDecryptRevealsDuplicate?.value as {
      verification?: { checks?: Record<string, string> };
      warnings?: Array<{ code: string; relatedRecordId?: string }>;
    };
    expect(example).toBeDefined();
    expect(example.verification?.checks).toMatchObject({ retrieval: 'pass', digest: 'pass', decryption: 'pass' });
    const duplicate = example.warnings?.find((warning) => warning.code === 'DUPLICATE_CONTENT');
    expect(duplicate).toBeDefined();
    expect(duplicate?.relatedRecordId).toEqual(expect.any(String));
  });

  it('names bodylessness as the condition that decides the 400 DECRYPTION_REQUIRED', () => {
    // The operation narrative says so; the 400 block is what a client
    // integrator reads when branching on codes, and it said only that the
    // record holds an unopened copy, which is true of the key-bearing form too.
    const description = oneLine(operation.responses?.['400']?.description);
    expect(description).toContain('bodyless');
  });

  it('publishes an example for every key-bearing 202 outcome the release can produce', () => {
    // Acceptance criterion 3 and the owner's ruling on which checks a
    // wrong-key generation reports. Without these the document shows seven
    // #957 outcomes and nothing this ticket adds.
    const examples = operation.responses?.['202']?.content?.['application/json']?.examples ?? {};
    const envelopes = Object.entries(examples).map(([name, example]) => [
      name,
      (example.value as { verification?: Record<string, unknown> }).verification ?? {},
    ]) as Array<[string, Record<string, unknown>]>;

    const wrongKey = envelopes.find(([name]) => name === 'lateKeyDidNotOpenTheCopy')?.[1];
    expect(wrongKey).toBeDefined();
    expect(wrongKey?.checks).toMatchObject({
      retrieval: 'pass',
      digest: 'pass',
      decryption: 'fail',
    });
    expect((wrongKey?.failure as { code: string }).code).toBe('DECRYPTION_FAILED');
    // Anchored to the constant the failure is actually built from, not
    // re-typed here: a hand-written example drifts silently from the sentence
    // callers receive. The literal beside it is the retry guidance, which is
    // the part of the sentence a client acts on, so a rewording that dropped
    // it would fail here rather than in a reader's expectations.
    expect(oneLine((wrongKey?.failure as { message: string }).message)).toBe(STORED_COPY_KEY_MISMATCH_MESSAGE);
    expect((wrongKey?.failure as { message: string }).message).toContain(
      'Retry with the correct sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.',
    );

    const failedRead = envelopes.find(([name]) => name === 'storedCopyCouldNotBeRead')?.[1];
    expect(failedRead).toBeDefined();
    expect(failedRead?.checks).toMatchObject({
      retrieval: 'not_run',
      digest: 'not_run',
      decryption: 'not_run',
    });
    const failure = failedRead?.failure as { code: string; message: string; retryable: boolean };
    expect(failure.code).toBe('STORED_COPY_UNAVAILABLE');
    // Quoted from the function the settlement calls, not copied. The example
    // is the non-retryable one, so it must carry the terminal sentence: a
    // hand-written copy could publish the transient "re-verify once storage is
    // reachable" beside `retryable: false` and nothing would notice.
    expect(failure.retryable).toBe(false);
    expect(failure.message).toBe(
      // The terminal branch ignores custody, so any shape composes the same
      // sentence; passing the example's own (an unopened copy, which is the
      // custody mode B is chosen for) keeps the call honest anyway.
      storedCopyReadFailedMessage('storage returned HTTP 404', 'terminal', {
        storageUri: 'https://storage.example/objects/copy',
        decryptionKeyPresent: false,
        encrypted: true,
      }),
    );
  });

  it('describes the superseded outcome and how the detail poll reports an unlockable key', () => {
    // Both are states a caller reaches and cannot otherwise account for: a
    // request that did no work, and a settled generation whose held key cannot
    // be returned, which the detail poll now names on the record itself rather
    // than answering with a server error.
    const description = oneLine(operation.description);
    expect(description).toContain('changed while it was being prepared');
    expect(description).toContain('DECRYPTION_KEY_UNAVAILABLE');
    expect(description).not.toContain('sanitised `500`');
    expect(description).not.toContain('issues/769');
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
