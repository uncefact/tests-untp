import { AesGcmEncryptionAdapter, EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import { StoragePayloadError, StorageStoreError, type StorageRecord } from '@uncefact/untp-ri-services';
import { createHash } from 'node:crypto';
import { decodeJwt } from 'jose';
import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsError,
  CredentialDetailsStatus,
  ExternalContentKind,
} from '@/lib/prisma/generated';
import { CredentialDocumentFetchError, type DocumentFetchFailure } from '@/lib/credentials/fetch-credential-document';
import type { CreateExternalCredentialInput } from '@/lib/prisma/repositories/external-credential.repository';
import {
  EncryptionUnavailableError,
  registerExternalCredential,
  settleInRequest,
  SourceRejectedError,
  StorageKeyMissingError,
  StoreAttemptFailedError,
  type RegisterExternalCredentialDependencies,
  type RegisterExternalCredentialInput,
} from './register-external-credential';

jest.mock('@/lib/api/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return { apiLogger: logger };
});

// The resolver package ships as ESM the unit runtime cannot load; the fetch
// helper is injected anyway, so only its error classes are needed here.
jest.mock('@uncefact/untp-utils/resolvers', () => ({
  ...jest.requireActual('@uncefact/untp-utils/resolvers/errors'),
  resolveDocument: jest.fn(),
}));

// Same constraint for the digest package: a deterministic stand-in whose
// output the test recomputes, so the assertion is on which bytes were
// digested, which is the pipeline's rule (raw bytes, before any decrypt).
jest.mock('@uncefact/untp-utils/multibase-digest', () => {
  const { createHash } = jest.requireActual('node:crypto') as typeof import('node:crypto');
  const fromData = async (data: Uint8Array) => ({
    toString: () => `z${createHash('sha256').update(data).digest('hex')}`,
  });
  return {
    MultibaseDigest: {
      fromData,
      // The pipeline digests the raw bytes through `fromData` and the signed
      // JWT through `fromText`. Both stand-ins hash the same way, so the test
      // can recompute either.
      fromText: async (text: string) => fromData(new TextEncoder().encode(text)),
    },
  };
});

jest.mock('@/lib/credentials/decryption-key-protection', () => ({
  protectDecryptionKey: (key: string | undefined) => (key === undefined ? undefined : `protected(${key})`),
}));

// The unit runtime maps jose to a stub; give decodeJwt the real behaviour the
// credential reader depends on (payload decoding, no signature check).
beforeAll(() => {
  (decodeJwt as jest.Mock).mockImplementation((jwt: string) =>
    JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()),
  );
});

const SUPPLIER_KEY = 'a'.repeat(64);
const WRONG_KEY = 'b'.repeat(64);
const quietLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quietLogger,
};
const encryptor = new AesGcmEncryptionAdapter(SUPPLIER_KEY, quietLogger as never);

/** An enveloped credential whose JWT decodes (no signature is checked at this layer). */
function envelopedCredential(payload: object): Record<string, unknown> {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${b64({ alg: 'ES256', typ: 'vc+jwt' })}.${b64(payload)}.sig`;
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: `data:application/vc+jwt,${jwt}`,
  };
}

const DPP_PAYLOAD = {
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/'],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
  name: 'Battery pack passport',
  issuer: { id: 'did:web:supplier.example', name: 'Supplier Ltd' },
  validFrom: '2026-07-22T10:00:00Z',
  credentialSubject: { id: 'https://supplier.example/products/1', name: 'Battery pack' },
};

const PLAINTEXT = JSON.stringify(envelopedCredential(DPP_PAYLOAD));
const ENCRYPTED = JSON.stringify(encryptor.encrypt(PLAINTEXT, EncryptionAlgorithm.AES_256_GCM));

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function fetchFailure(failure: DocumentFetchFailure): () => Promise<never> {
  return async () => {
    throw new CredentialDocumentFetchError(failure);
  };
}

function deps(overrides: Partial<RegisterExternalCredentialDependencies> = {}) {
  const store = jest.fn(
    async (): Promise<StorageRecord> => ({
      uri: 'https://storage.example/private/copy',
      digestMultibase: 'zStoredDigest',
      decryptionKey: 'c'.repeat(64),
      externalId: 'copy-1',
      bucket: 'private',
      mimeType: 'application/json',
    }),
  );
  const storeBinary = jest.fn(
    async (
      _content: string | Uint8Array,
      _filename: string,
      _contentType: string,
      encrypt?: boolean,
    ): Promise<StorageRecord> => ({
      uri: 'https://storage.example/public/raw',
      digestMultibase: 'zRawDigest',
      ...(encrypt ? { decryptionKey: 'd'.repeat(64) } : {}),
      externalId: 'raw-1',
      bucket: encrypt ? 'private' : 'public',
      mimeType: 'application/octet-stream',
    }),
  );
  const persist = jest.fn(async (input: CreateExternalCredentialInput) => input as never);
  const enqueueVerification = jest.fn(async () => undefined);
  const built: RegisterExternalCredentialDependencies = {
    fetchDocument: async () => ({
      bytes: bytes(PLAINTEXT),
      contentType: 'application/json',
      finalUrl: 'https://supplier.example/a',
    }),
    resolveStorage: async () => ({ service: { store, storeBinary, delete: jest.fn() }, instanceId: 'storage-1' }),
    assertEncryptionReady: () => undefined,
    enqueueVerification,
    persist,
    findExistingExternal: async () => null,
    ...overrides,
  };
  return { deps: built, store, storeBinary, persist, enqueueVerification };
}

function input(overrides: Partial<RegisterExternalCredentialInput> = {}): RegisterExternalCredentialInput {
  return {
    tenantId: 'tenant-1',
    sourceUrl: 'https://supplier.example/a',
    annotations: { displayName: 'Supplier DPP', declaredCredentialType: CoreCredentialType.DPP },
    idempotencyClaimId: 'claim-1',
    ...overrides,
  };
}

async function digestOf(text: string): Promise<string> {
  return `z${createHash('sha256').update(bytes(text)).digest('hex')}`;
}

async function signedContentDigestOf(text: string): Promise<string> {
  return digestOf(JSON.parse(text).id.split(',')[1]);
}

/** The create input the pipeline handed the repository, which the fake persist returns unchanged. */
async function persisted(
  overrides: Partial<RegisterExternalCredentialInput> = {},
  d = deps(),
): Promise<{ created: CreateExternalCredentialInput } & ReturnType<typeof deps>> {
  const created = (await registerExternalCredential(
    input(overrides),
    d.deps,
  )) as unknown as CreateExternalCredentialInput;
  return { created, ...d };
}

describe('registerExternalCredential', () => {
  it('registers a plaintext credential as pending with the copy stored encrypted, the fields extracted and the job enqueued', async () => {
    const { created, store, storeBinary, enqueueVerification } = await persisted();

    expect(store).toHaveBeenCalledWith(JSON.parse(PLAINTEXT), true);
    expect(storeBinary).not.toHaveBeenCalled();
    expect(created.tenantId).toBe('tenant-1');
    expect(created.idempotencyClaimId).toBe('claim-1');
    expect(created.sourceDigest).toBe(await digestOf(PLAINTEXT));
    expect(created.contentDigest).toBe(await signedContentDigestOf(PLAINTEXT));
    expect(created.encrypted).toBe(false);
    expect(created.contentKind).toBe(ExternalContentKind.CREDENTIAL);
    expect(created.decryptionKeyUnused).toBe(false);
    expect(created.storage).toEqual({
      uri: 'https://storage.example/private/copy',
      digestMultibase: 'zStoredDigest',
      serviceInstanceId: 'storage-1',
      externalId: 'copy-1',
      bucket: 'private',
      decryptionKey: `protected(${'c'.repeat(64)})`,
    });
    expect(created.details).toMatchObject({
      status: CredentialDetailsStatus.EXTRACTED,
      coreCredentialType: CoreCredentialType.DPP,
      credentialType: 'DigitalProductPassport',
      coreDataModelVersion: '0.6.0',
      fields: expect.objectContaining({ name: 'Battery pack passport', issuerDid: 'did:web:supplier.example' }),
    });
    expect(created.checkRun).toEqual({
      state: CheckRunState.PENDING,
      checks: { retrieval: CheckResult.PASS, decryption: CheckResult.NOT_RUN, digest: CheckResult.PASS },
      enqueue: enqueueVerification,
    });
  });

  it('opens an encrypted source with the supplied key, records decryption as passed and stores the plaintext', async () => {
    const d = deps({
      fetchDocument: async () => ({ bytes: bytes(ENCRYPTED), contentType: 'application/json', finalUrl: 'x' }),
    });
    const { created, store } = await persisted({ decryptionKey: SUPPLIER_KEY }, d);

    expect(store).toHaveBeenCalledWith(JSON.parse(PLAINTEXT), true);
    expect(created.encrypted).toBe(true);
    expect(created.sourceDigest).toBe(await digestOf(ENCRYPTED));
    expect(created.checkRun).toMatchObject({
      state: CheckRunState.PENDING,
      checks: { retrieval: CheckResult.PASS, decryption: CheckResult.PASS, digest: CheckResult.PASS },
    });
    expect(created.details).toMatchObject({ status: CredentialDetailsStatus.EXTRACTED });
  });

  it.each([
    ['an outage', () => new StorageStoreError(503, 'unavailable'), true],
    ['a refusal', () => new StoragePayloadError(400, 'rejected'), false],
  ])(
    // An opened-with-key credential's message must tell the caller how to
    // retry with the key-bearing re-verification form, so this differs from
    // the plaintext storage-failure message, which is left unchanged.
    'names the key-bearing retry guidance when storing an opened-with-key credential fails on %s',
    async (_label, error, retryable) => {
      const d = deps({
        fetchDocument: async () => ({ bytes: bytes(ENCRYPTED), contentType: 'application/json', finalUrl: 'x' }),
      });
      d.store.mockRejectedValueOnce(error());
      const { created } = await persisted({ decryptionKey: SUPPLIER_KEY }, d);

      expect(created.storage).toBeUndefined();
      expect(created.checkRun).toMatchObject({
        state: CheckRunState.FAILED,
        checks: { retrieval: CheckResult.PASS, decryption: CheckResult.PASS },
        failure: {
          code: CheckRunFailureCode.STORAGE_FAILED,
          retryable,
          message: expect.stringContaining(
            'Retry with sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify',
          ),
        },
      });
    },
  );

  it('leaves the plaintext storage-failure message unchanged', async () => {
    const d = deps();
    d.store.mockRejectedValueOnce(new StorageStoreError(503, 'unavailable'));
    const { created } = await persisted({}, d);

    expect(created.checkRun).toMatchObject({
      failure: {
        code: CheckRunFailureCode.STORAGE_FAILED,
        message: 'The durable copy could not be written to storage; retry via re-verify once storage recovers.',
      },
    });
  });

  it('records a key supplied against a plaintext source as unused and still registers', async () => {
    const { created } = await persisted({ decryptionKey: SUPPLIER_KEY });
    expect(created.decryptionKeyUnused).toBe(true);
    expect(created.checkRun.state).toBe(CheckRunState.PENDING);
  });

  it('rejects a duplicate after extraction and before encryption preflight or storage', async () => {
    // Fails if the duplicate check moves after the encryption preflight or
    // after the store, either of which would write a copy the request then
    // throws away.
    const assertEncryptionReady = jest.fn();
    const d = deps({
      assertEncryptionReady,
      findExistingExternal: async () => 'existing-record',
    });

    await expect(registerExternalCredential(input(), d.deps)).rejects.toMatchObject({
      name: 'DuplicateCredentialError',
      existingRecordId: 'existing-record',
    });
    expect(assertEncryptionReady).not.toHaveBeenCalled();
    expect(d.store).not.toHaveBeenCalled();
    expect(d.storeBinary).not.toHaveBeenCalled();
    expect(d.persist).not.toHaveBeenCalled();
  });

  it('refuses an encrypted duplicate without exposing the supplier key in log lines', async () => {
    // Fails if the duplicate breadcrumb carries the request key or if the
    // duplicate path continues into storage after opening the envelope.
    const d = deps({
      fetchDocument: async () => ({ bytes: bytes(ENCRYPTED), contentType: 'application/json', finalUrl: 'x' }),
      findExistingExternal: async () => 'existing-record',
    });

    await expect(registerExternalCredential(input({ decryptionKey: SUPPLIER_KEY }), d.deps)).rejects.toMatchObject({
      existingRecordId: 'existing-record',
    });
    const { apiLogger } = jest.requireMock('@/lib/api/logger') as { apiLogger: Record<string, jest.Mock> };
    expect(apiLogger.info).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', source: 'https://supplier.example', existingRecordId: 'existing-record' },
      'Credential content is already registered',
    );
    expect(JSON.stringify(apiLogger.info.mock.calls)).not.toContain(SUPPLIER_KEY);
    expect(d.store).not.toHaveBeenCalled();
    expect(d.storeBinary).not.toHaveBeenCalled();
  });

  it('keeps an encrypted source with no key as the unopened ciphertext and fails DECRYPTION_REQUIRED', async () => {
    const d = deps({
      fetchDocument: async () => ({ bytes: bytes(ENCRYPTED), contentType: 'application/json', finalUrl: 'x' }),
      assertEncryptionReady: () => {
        throw new Error('the preflight must not run on this branch');
      },
    });
    const { created, store, storeBinary } = await persisted({}, d);

    expect(store).not.toHaveBeenCalled();
    expect(storeBinary).toHaveBeenCalledWith(
      bytes(ENCRYPTED),
      expect.stringMatching(/\.json$/),
      'application/json',
      false,
    );
    expect(created.encrypted).toBe(true);
    expect(created.contentKind).toBe(ExternalContentKind.OPAQUE);
    expect(created.sourceDigest).toBe(await digestOf(ENCRYPTED));
    expect(created.storage).toEqual({
      uri: 'https://storage.example/public/raw',
      digestMultibase: 'zRawDigest',
      serviceInstanceId: 'storage-1',
      externalId: 'raw-1',
      bucket: 'public',
    });
    expect(created.details).toEqual({ status: CredentialDetailsStatus.EXTRACTION_PENDING });
    expect(created.checkRun).toEqual({
      state: CheckRunState.FAILED,
      checks: { retrieval: CheckResult.PASS, decryption: CheckResult.FAIL },
      failure: {
        code: CheckRunFailureCode.DECRYPTION_REQUIRED,
        message: expect.stringContaining('holds no key that opens it'),
        retryable: true,
      },
    });
  });

  it('fails DECRYPTION_FAILED, retryable, when the supplied key does not open the source', async () => {
    const d = deps({
      fetchDocument: async () => ({ bytes: bytes(ENCRYPTED), contentType: 'application/json', finalUrl: 'x' }),
    });
    const { created, storeBinary } = await persisted({ decryptionKey: WRONG_KEY }, d);

    expect(storeBinary).toHaveBeenCalledWith(bytes(ENCRYPTED), expect.any(String), 'application/json', false);
    expect(created.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failure: { code: CheckRunFailureCode.DECRYPTION_FAILED, retryable: true },
    });
  });

  it('fails DECRYPTION_FAILED, not retryable, when the envelope is corrupt', async () => {
    const corrupt = JSON.stringify({ ...JSON.parse(ENCRYPTED), iv: 'AAAA' });
    const d = deps({
      fetchDocument: async () => ({ bytes: bytes(corrupt), contentType: 'application/json', finalUrl: 'x' }),
    });
    const { created } = await persisted({ decryptionKey: SUPPLIER_KEY }, d);

    expect(created.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failure: {
        code: CheckRunFailureCode.DECRYPTION_FAILED,
        retryable: false,
        message: expect.stringContaining('corrupted'),
      },
    });
  });

  it.each<[string, DocumentFetchFailure, boolean, string]>([
    ['dns', { kind: 'failed', reason: 'dns', error: new Error('ENOTFOUND') }, true, 'could not be resolved'],
    ['timeout', { kind: 'failed', reason: 'timeout', error: new Error('t') }, true, 'timed out'],
    ['503', { kind: 'failed', reason: 'http', status: 503, error: new Error('503') }, true, 'HTTP 503'],
    ['404', { kind: 'failed', reason: 'http', status: 404, error: new Error('404') }, false, 'HTTP 404'],
    ['too-large', { kind: 'failed', reason: 'too-large', error: new Error('big') }, false, 'byte limit'],
    ['redirects', { kind: 'failed', reason: 'redirects', error: new Error('r') }, false, 'redirected'],
    ['network', { kind: 'failed', reason: 'network', error: new Error('n') }, true, 'could not be reached'],
    [
      'body-unreadable',
      { kind: 'failed', reason: 'body-unreadable', error: new Error('stream closed') },
      true,
      'could not be read',
    ],
  ])('records a %s retrieval failure with nothing observed', async (_name, failure, retryable, wording) => {
    const d = deps({ fetchDocument: fetchFailure(failure) });
    const { created, store, storeBinary } = await persisted({}, d);

    expect(store).not.toHaveBeenCalled();
    expect(storeBinary).not.toHaveBeenCalled();
    expect(created.encrypted).toBeNull();
    expect(created.sourceDigest).toBeUndefined();
    expect(created.storage).toBeUndefined();
    expect(created.details).toEqual({ status: CredentialDetailsStatus.EXTRACTION_PENDING });
    expect(created.checkRun).toEqual({
      state: CheckRunState.FAILED,
      checks: { retrieval: CheckResult.FAIL },
      failure: { code: CheckRunFailureCode.RETRIEVAL_FAILED, retryable, message: expect.stringContaining(wording) },
    });
    expect((created.checkRun as { failure: { message: string } }).failure.message).toContain(
      retryable ? 'Retry via re-verify' : 'unless the source changes',
    );
  });

  it('throws SourceRejectedError, and persists nothing, when the guard refuses the request', async () => {
    const failure: DocumentFetchFailure = {
      kind: 'rejected',
      reason: 'source-not-permitted',
      error: new Error('Hostname resolves to a private or reserved address'),
    };
    const d = deps({ fetchDocument: fetchFailure(failure) });

    await expect(registerExternalCredential(input(), d.deps)).rejects.toBeInstanceOf(SourceRejectedError);
    expect(d.persist).not.toHaveBeenCalled();
  });

  it('runs the encryption preflight after the fetch and before the store, creating nothing when it fails', async () => {
    // The preflight guards the store, not the fetch: it must not run before a
    // body has been read, or a retrieval failure would be reported as an
    // encryption one. Fails if the preflight moves to the top of the pipeline.
    const fetchDocument = jest.fn(async () => ({
      bytes: bytes(PLAINTEXT),
      contentType: 'application/json',
      finalUrl: 'https://supplier.example/a',
    }));
    const assertEncryptionReady = jest.fn(() => {
      throw new Error('Missing required DATA_ENCRYPTION_KEY');
    });
    const d = deps({ fetchDocument, assertEncryptionReady });

    await expect(registerExternalCredential(input(), d.deps)).rejects.toBeInstanceOf(EncryptionUnavailableError);
    expect(fetchDocument).toHaveBeenCalledTimes(1);
    expect(assertEncryptionReady).toHaveBeenCalledTimes(1);
    expect(fetchDocument.mock.invocationCallOrder[0]).toBeLessThan(assertEncryptionReady.mock.invocationCallOrder[0]);
    expect(d.store).not.toHaveBeenCalled();
    expect(d.persist).not.toHaveBeenCalled();
  });

  it('propagates a storage resolution failure rather than recording it as STORAGE_FAILED', async () => {
    // Resolving the tenant's storage instance is configuration, not a write:
    // a tenant with no usable instance is this service's own error, never a
    // "retry once storage recovers" row. Fails if resolveStorage moves back
    // inside the store try.
    const failure = new Error('No storage service instance is configured for this tenant');
    const d = deps({
      resolveStorage: async () => {
        throw failure;
      },
    });

    await expect(registerExternalCredential(input(), d.deps)).rejects.toBe(failure);
    expect(d.persist).not.toHaveBeenCalled();
  });

  it.each([
    ['no Content-Type at all', undefined, 'application/octet-stream', /\.bin$/],
    ['text/plain', 'text/plain; charset=utf-8', 'text/plain', /\.txt$/],
  ])('stores a non-credential body as %s with the matching extension', async (_name, contentType, sent, extension) => {
    // Fails if the fallback or the extension table drifts: a stored object
    // would then carry a name and type that misdescribe its bytes.
    const d = deps({
      fetchDocument: async () => ({ bytes: bytes('plain body'), contentType, finalUrl: 'x' }),
    });
    await persisted({}, d);

    expect(d.storeBinary).toHaveBeenCalledWith(bytes('plain body'), expect.stringMatching(extension), sent, true);
  });

  it.each([
    ['a storage 5xx', new StorageStoreError(503, 'unavailable'), true],
    ['a storage 4xx refusal', new StoragePayloadError(400, 'rejected'), false],
    ['a network error', new TypeError('fetch failed'), true],
  ])(
    'records STORAGE_FAILED with the digest kept and the fields extracted when %s stops the store',
    async (_name, error, retryable) => {
      const d = deps();
      d.store.mockRejectedValueOnce(error);
      const { created } = await persisted({}, d);

      expect(created.storage).toBeUndefined();
      expect(created.sourceDigest).toBe(await digestOf(PLAINTEXT));
      expect(created.contentDigest).toBe(await signedContentDigestOf(PLAINTEXT));
      expect(created.encrypted).toBe(false);
      expect(created.details).toMatchObject({ status: CredentialDetailsStatus.EXTRACTED });
      expect(created.checkRun).toEqual({
        state: CheckRunState.FAILED,
        checks: { retrieval: CheckResult.PASS, decryption: CheckResult.NOT_RUN },
        failure: {
          code: CheckRunFailureCode.STORAGE_FAILED,
          retryable,
          message: expect.stringContaining('storage'),
        },
      });
    },
  );

  it('reports STORAGE_FAILED, still naming the key problem, when the unopened ciphertext cannot be stored', async () => {
    const d = deps({
      fetchDocument: async () => ({ bytes: bytes(ENCRYPTED), contentType: 'application/json', finalUrl: 'x' }),
    });
    d.storeBinary.mockRejectedValueOnce(new StorageStoreError(500, 'down'));
    const { created } = await persisted({}, d);

    expect(created.storage).toBeUndefined();
    expect(created.checkRun).toEqual({
      state: CheckRunState.FAILED,
      checks: { retrieval: CheckResult.PASS, decryption: CheckResult.FAIL },
      failure: {
        code: CheckRunFailureCode.STORAGE_FAILED,
        retryable: true,
        message: expect.stringMatching(/storage[\s\S]*holds no key that opens it/),
      },
    });
  });

  it.each<[string, () => { bytes: Uint8Array; decryptionKey?: string }, string]>([
    [
      'a no-key reading',
      () => ({ bytes: bytes(ENCRYPTED) }),
      'This credential is also encrypted and this service holds no key that opens it.',
    ],
    [
      'a key-mismatch reading',
      () => ({ bytes: bytes(ENCRYPTED), decryptionKey: WRONG_KEY }),
      'The supplied decryption key also did not open this credential.',
    ],
    [
      'a corrupted-envelope reading',
      () => ({ bytes: bytes(JSON.stringify({ ...JSON.parse(ENCRYPTED), iv: 'AAAA' })), decryptionKey: SUPPLIER_KEY }),
      'This encrypted envelope is also corrupted, so no key will open it unless the source changes.',
    ],
  ])(
    // The fresh message composed for this branch must name the right key
    // cause and the right storage cause for every one of the six
    // combinations, not a fixed string that misdirects the caller for four
    // of them (a refused upload, a key mismatch, or a corrupted envelope).
    'names the right key cause for %s crossed with a storage outage',
    async (_label, reading, keyCause) => {
      const { bytes: body, decryptionKey } = reading();
      const d = deps({ fetchDocument: async () => ({ bytes: body, contentType: 'application/json', finalUrl: 'x' }) });
      d.storeBinary.mockRejectedValueOnce(new StorageStoreError(503, 'unavailable'));
      const { created } = await persisted(decryptionKey === undefined ? {} : { decryptionKey }, d);

      expect(created.checkRun).toMatchObject({
        failure: {
          code: CheckRunFailureCode.STORAGE_FAILED,
          retryable: true,
          message: expect.stringContaining('The durable copy could not be written to storage.'),
        },
      });
      expect((created.checkRun as { failure: { message: string } }).failure.message).toContain(keyCause);
      // The remedy text names the form that can actually finish the job for
      // this record: a bodyless re-verify would fetch and store the
      // ciphertext again without opening it, so the message points at the
      // key-bearing form instead. Fails if the message reverts to saying no
      // key can be supplied.
      expect((created.checkRun as { failure: { message: string } }).failure.message).toContain(
        'Once storage recovers, retry with sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify to fetch the source again and open it.',
      );
    },
  );

  it.each<[string, () => { bytes: Uint8Array; decryptionKey?: string }, string]>([
    [
      'a no-key reading',
      () => ({ bytes: bytes(ENCRYPTED) }),
      'This credential is also encrypted and this service holds no key that opens it.',
    ],
    [
      'a key-mismatch reading',
      () => ({ bytes: bytes(ENCRYPTED), decryptionKey: WRONG_KEY }),
      'The supplied decryption key also did not open this credential.',
    ],
    [
      'a corrupted-envelope reading',
      () => ({ bytes: bytes(JSON.stringify({ ...JSON.parse(ENCRYPTED), iv: 'AAAA' })), decryptionKey: SUPPLIER_KEY }),
      'This encrypted envelope is also corrupted, so no key will open it unless the source changes.',
    ],
  ])('names the right key cause for %s crossed with a storage refusal', async (_label, reading, keyCause) => {
    const { bytes: body, decryptionKey } = reading();
    const d = deps({ fetchDocument: async () => ({ bytes: body, contentType: 'application/json', finalUrl: 'x' }) });
    d.storeBinary.mockRejectedValueOnce(new StoragePayloadError(400, 'rejected'));
    const { created } = await persisted(decryptionKey === undefined ? {} : { decryptionKey }, d);

    expect(created.checkRun).toMatchObject({
      failure: {
        code: CheckRunFailureCode.STORAGE_FAILED,
        retryable: false,
        message: expect.stringContaining(
          'The storage service refused the durable copy (its upload rules do not accept this content), and an operator must allow it before any copy can be stored.',
        ),
      },
    });
    expect((created.checkRun as { failure: { message: string } }).failure.message).toContain(keyCause);
    expect((created.checkRun as { failure: { message: string } }).failure.message).toContain(
      'Once storage recovers, retry with sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify to fetch the source again and open it.',
    );
  });

  it('stores a fetched body that is not a credential as fetched, encrypted, with extraction failed and the run pending', async () => {
    const d = deps({
      fetchDocument: async () => ({
        bytes: bytes('<html>not a credential</html>'),
        contentType: 'text/html; charset=utf-8',
        finalUrl: 'x',
      }),
    });
    const { created, store, storeBinary } = await persisted({}, d);

    expect(store).not.toHaveBeenCalled();
    expect(storeBinary).toHaveBeenCalledWith(
      bytes('<html>not a credential</html>'),
      expect.stringMatching(/\.html$/),
      'text/html',
      true,
    );
    expect(created.contentKind).toBe(ExternalContentKind.OPAQUE);
    expect(created.encrypted).toBe(false);
    expect(created.storage).toMatchObject({ decryptionKey: `protected(${'d'.repeat(64)})` });
    expect(created.details).toEqual({
      status: CredentialDetailsStatus.EXTRACTION_FAILED,
      error: CredentialDetailsError.UNREADABLE_ENVELOPE,
    });
    // The digest check belongs to the signed form: an HTML body has none, so
    // the check did not apply. Fails if it goes back to a blanket PASS.
    expect(created.checkRun).toEqual({
      state: CheckRunState.PENDING,
      checks: { retrieval: CheckResult.PASS, decryption: CheckResult.NOT_RUN, digest: CheckResult.NOT_RUN },
      enqueue: expect.any(Function),
    });
  });

  it('records a bridge failure as EXTRACTION_FAILED while still storing and pending the credential', async () => {
    const noCore = JSON.stringify(
      envelopedCredential({ ...DPP_PAYLOAD, type: ['VerifiableCredential', 'SomethingElse'] }),
    );
    const d = deps({
      fetchDocument: async () => ({ bytes: bytes(noCore), contentType: 'application/json', finalUrl: 'x' }),
    });
    const { created } = await persisted({}, d);

    expect(created.contentKind).toBe(ExternalContentKind.CREDENTIAL);
    expect(created.details).toEqual({
      status: CredentialDetailsStatus.EXTRACTION_FAILED,
      error: CredentialDetailsError.BRIDGE_ERROR,
    });
    expect(created.contentDigest).toBe(await signedContentDigestOf(noCore));
    expect(created.checkRun.state).toBe(CheckRunState.PENDING);
  });

  it('fails loudly when an encrypting store returns no key', async () => {
    const d = deps();
    d.store.mockResolvedValueOnce({
      uri: 'https://storage.example/private/copy',
      digestMultibase: 'z',
      externalId: 'copy-2',
      mimeType: 'application/json',
    });

    await expect(registerExternalCredential(input(), d.deps)).rejects.toBeInstanceOf(StorageKeyMissingError);
    expect(d.persist).not.toHaveBeenCalled();
  });

  it('never hands the supplier key to storage, the repository or the log', async () => {
    const d = deps({
      fetchDocument: async () => ({ bytes: bytes(ENCRYPTED), contentType: 'application/json', finalUrl: 'x' }),
    });
    await registerExternalCredential(input({ decryptionKey: SUPPLIER_KEY }), d.deps);
    const { apiLogger } = jest.requireMock('@/lib/api/logger') as { apiLogger: Record<string, jest.Mock> };
    const everything = JSON.stringify([
      d.persist.mock.calls,
      d.store.mock.calls,
      d.storeBinary.mock.calls,
      apiLogger.info.mock.calls,
      apiLogger.warn.mock.calls,
      apiLogger.error.mock.calls,
    ]);
    expect(everything).not.toContain(SUPPLIER_KEY);
  });
});

describe('registerExternalCredential byte fidelity and orphaned copies', () => {
  it('hands storage the fetched bytes verbatim, byte-order mark included', async () => {
    // A BOM is dropped by any decode-to-text step, so this fails the moment
    // the pipeline stores decoded text instead of the bytes it fetched.
    const fetched = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ENCRYPTED, 'utf8')]);
    const d = deps({
      fetchDocument: async () => ({ bytes: fetched, contentType: 'application/json', finalUrl: 'x' }),
    });

    await persisted({}, d);

    expect(d.storeBinary).toHaveBeenCalledTimes(1);
    const [content] = d.storeBinary.mock.calls[0];
    expect(content).toEqual(fetched);
    expect(Buffer.from(content as Uint8Array).equals(fetched)).toBe(true);
  });

  it('hands storage an invalid UTF-8 body unchanged rather than a replacement character', async () => {
    // Decoding 0x80 yields U+FFFD, which re-encodes to three other bytes.
    // Fails if the stored copy is ever a re-encoding of decoded text.
    const fetched = Buffer.concat([Buffer.from('binary '), Buffer.from([0x80, 0xff]), Buffer.from(' tail')]);
    const d = deps({
      fetchDocument: async () => ({ bytes: fetched, contentType: 'application/octet-stream', finalUrl: 'x' }),
    });

    await persisted({}, d);

    const [content] = d.storeBinary.mock.calls[0];
    expect(Buffer.from(content as Uint8Array).equals(fetched)).toBe(true);
  });

  it('logs the orphaned copy coordinates and rethrows when the rows fail after the copy was stored', async () => {
    // The rows rolled back but the object is already in storage, and nothing
    // else knows where it is. Fails if the log line or the rethrow is
    // removed, or if the storage coordinates stop being carried into it.
    const d = deps();
    const failure = new Error('transaction rolled back');
    d.persist.mockRejectedValueOnce(failure);

    await expect(registerExternalCredential(input(), d.deps)).rejects.toBe(failure);

    const { apiLogger } = jest.requireMock('@/lib/api/logger') as { apiLogger: Record<string, jest.Mock> };
    expect(apiLogger.error).toHaveBeenCalledWith(
      {
        error: { name: 'Error', message: 'transaction rolled back' },
        tenantId: 'tenant-1',
        storageUri: 'https://storage.example/private/copy',
        storageExternalId: 'copy-1',
        storageBucket: 'private',
      },
      'Registration failed after the durable copy was stored; the copy is orphaned',
    );
  });

  it('rethrows without an orphan line when nothing was stored', async () => {
    // The guard refuses before any store, so there is no copy to report.
    // Fails if the orphan line is logged unconditionally, which would send an
    // operator hunting for an object that does not exist.
    const d = deps({
      fetchDocument: fetchFailure({ kind: 'failed', reason: 'network', error: new Error('n') }),
    });
    const failure = new Error('transaction rolled back');
    d.persist.mockRejectedValueOnce(failure);
    const { apiLogger } = jest.requireMock('@/lib/api/logger') as { apiLogger: Record<string, jest.Mock> };
    apiLogger.error.mockClear();

    await expect(registerExternalCredential(input(), d.deps)).rejects.toBe(failure);

    const orphanLines = apiLogger.error.mock.calls.filter(([, message]) =>
      String(message).includes('the copy is orphaned'),
    );
    expect(orphanLines).toHaveLength(0);
  });
});

describe('settleInRequest in recover mode', () => {
  /**
   * Mode B: the pipeline over bytes the caller has already read from the
   * record's own durable copy. `storedCopy` is what a reservation hands it
   * after the read and the integrity check have both passed.
   */
  function storedCopy(
    body: string | Uint8Array,
    overrides: { checks?: Record<string, CheckResult>; holdsIdentity?: boolean } = {},
  ) {
    return {
      mode: 'recover' as const,
      currentRecordId: 'record-1',
      holdsIdentity: overrides.holdsIdentity ?? false,
      acquisition: {
        from: 'stored-copy' as const,
        document: {
          bytes: typeof body === 'string' ? bytes(body) : body,
          contentType: 'application/json',
          finalUrl: 'https://storage.example/private/copy',
        },
        checks: overrides.checks ?? { retrieval: CheckResult.PASS, digest: CheckResult.PASS },
        storageUri: 'https://storage.example/private/copy',
      },
    };
  }

  it('opens a stored copy with the right key, storing the plaintext and never fetching the source', async () => {
    // The whole ticket. Fails if mode B fetches the supplier, if it does not
    // store the opened plaintext under a receiver key, or if the checks the
    // read earned are dropped from the pending generation.
    const fetchDocument = jest.fn(async () => {
      throw new Error('mode B must never fetch the supplier');
    });
    const d = deps({ fetchDocument });

    const outcome = await settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, storedCopy(ENCRYPTED));

    expect(fetchDocument).not.toHaveBeenCalled();
    expect(d.store).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({
      acquisition: { mode: 'stored-copy' },
      encrypted: true,
      contentKind: ExternalContentKind.CREDENTIAL,
      decryptionKeyUnused: false,
      checkRun: {
        state: CheckRunState.PENDING,
        checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS, decryption: CheckResult.PASS },
      },
    });
    // No source provenance was observed, so none is claimed.
    expect(outcome.acquisition).toEqual({ mode: 'stored-copy' });
  });

  it('names the duplicate record when a stored copy opens content another record already holds', async () => {
    // Acceptance criterion 2. Recovery cannot reject a duplicate the way
    // registration does, because the record already exists, so the pointer is
    // advisory. Fails if the duplicate lookup is skipped on this path.
    const d = deps({ findExistingExternal: jest.fn(async () => 'other-record') });

    const outcome = await settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, storedCopy(ENCRYPTED));

    expect(outcome).toMatchObject({
      duplicateOfRecordId: 'other-record',
      observedContentDigest: expect.any(String),
    });
    expect(outcome.contentDigest).toBeUndefined();
    expect(d.deps.findExistingExternal).toHaveBeenCalledWith('tenant-1', expect.any(String), 'record-1');
  });

  it('carries the checks the stored read earned onto a store failure', async () => {
    // The custody-integrity result is real work this attempt did; a
    // storage outage afterwards must not publish it as never run.
    const d = deps();
    d.store.mockRejectedValueOnce(new StorageStoreError(503, 'unavailable'));

    const outcome = await settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, storedCopy(ENCRYPTED));

    expect(outcome.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS, decryption: CheckResult.PASS },
      failure: { code: CheckRunFailureCode.STORAGE_FAILED, retryable: true },
    });
  });

  it('carries them onto the D10 preflight failure too, on a typed carrier', async () => {
    // The same rule through the throw path, and the carrier the settlement
    // narrows on.
    const d = deps({
      assertEncryptionReady: () => {
        throw new Error('kms unreachable');
      },
    });

    await expect(
      settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, storedCopy(ENCRYPTED)),
    ).rejects.toBeInstanceOf(EncryptionUnavailableError);
    await settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, storedCopy(ENCRYPTED)).catch(
      (error: EncryptionUnavailableError) => {
        expect(error.checks).toEqual({
          retrieval: CheckResult.PASS,
          digest: CheckResult.PASS,
          decryption: CheckResult.PASS,
        });
      },
    );
  });

  it('wraps a thrown store failure in the typed carrier, keeping the original as the cause', async () => {
    // Y-F6. The checks travel on a class the settlement narrows with
    // `instanceof`, and the original throw stays reachable so classification
    // by error class is unchanged.
    const d = deps({
      resolveStorage: async () => {
        throw new Error('no storage instance for this tenant');
      },
    });

    await expect(
      settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, storedCopy(ENCRYPTED)),
    ).rejects.toBeInstanceOf(StoreAttemptFailedError);
    let error: StoreAttemptFailedError | undefined;
    try {
      await settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, storedCopy(ENCRYPTED));
    } catch (thrown) {
      error = thrown as StoreAttemptFailedError;
    }
    expect(error?.checks).toMatchObject({ retrieval: CheckResult.PASS, digest: CheckResult.PASS });
    expect((error?.cause as Error).message).toBe('no storage instance for this tenant');
  });

  it('names the record own copy, not a source, when a stored copy will not open', async () => {
    // T-S8 and S-6. Mode B never reads the supplier, so a message telling the
    // caller a source change would help sends them to the wrong system.
    const d = deps();

    const outcome = await settleInRequest(input({ decryptionKey: WRONG_KEY }), d.deps, storedCopy(ENCRYPTED));

    const message = (outcome.checkRun as { failure: { message: string } }).failure.message;
    expect(message).toContain("this record's durable copy");
    // The remedy names the request field, which is the only place the word
    // may appear: nothing here may describe a supplier fetch that did not
    // happen, or invite the caller to change one.
    expect(message).not.toContain('fetched');
    expect(message).not.toMatch(/\bthe source\b/);
    expect(message).toContain('sourceEncryption.decryptionKey');
  });

  it('says a corrupted stored envelope needs an operator, not a source change', async () => {
    const corrupt = JSON.stringify({ ...JSON.parse(ENCRYPTED), iv: 'AAAA' });
    const d = deps();

    const outcome = await settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, storedCopy(corrupt));

    expect(outcome.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failure: { code: CheckRunFailureCode.DECRYPTION_FAILED, retryable: false },
    });
    const message = (outcome.checkRun as { failure: { message: string } }).failure.message;
    expect(message).toContain('operator');
    expect(message).not.toContain('unless the source changes');
  });

  /**
   * A corrupt envelope fetched from a source has two possible futures, and
   * the store outcome is what decides between them. The guidance used to be
   * chosen before the store ran, so a request whose corrupt ciphertext WAS
   * successfully retained told the caller to go back to the supplier, when
   * every later attempt on that record reads the retained copy and touches no
   * supplier at all. The other two outcomes keep the source sentence: with no
   * durable copy of these bytes, there is nothing for an operator to inspect
   * and the supplier is genuinely the only way forward.
   */
  describe('corrupt-envelope guidance after a source fetch', () => {
    const CORRUPT = JSON.stringify({ ...JSON.parse(ENCRYPTED), iv: 'AAAA' });
    const RETAINED_COPY_MESSAGE =
      "The encrypted envelope in this record's durable copy is corrupted and cannot be decrypted; no key will open it, and the copy needs an operator to inspect it.";
    const SOURCE_MESSAGE =
      'The fetched encrypted envelope is corrupted and cannot be decrypted; re-supplying the key will not help unless the source changes.';

    function corruptFetch() {
      return async () => ({ bytes: bytes(CORRUPT), contentType: 'application/json', finalUrl: 'x' });
    }

    function failureMessage(outcome: { checkRun: unknown }): string {
      return (outcome.checkRun as { failure: { message: string } }).failure.message;
    }

    it('sends the caller to an operator once the corrupt copy is retained', async () => {
      const d = deps({ fetchDocument: corruptFetch() });

      const outcome = await settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, {
        mode: 'recover',
        currentRecordId: 'record-1',
        holdsIdentity: false,
        acquisition: { from: 'source' },
      });

      expect(outcome.storage).toBeDefined();
      expect(failureMessage(outcome)).toBe(RETAINED_COPY_MESSAGE);
    });

    it('keeps the source sentence when storing the copy failed', async () => {
      const d = deps({ fetchDocument: corruptFetch() });
      d.storeBinary.mockRejectedValue(new StorageStoreError(503, 'storage unavailable'));

      const outcome = await settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, {
        mode: 'recover',
        currentRecordId: 'record-1',
        holdsIdentity: false,
        acquisition: { from: 'source' },
      });

      expect(outcome.storage).toBeUndefined();
      // This branch composes its own sentence from the storage and key
      // halves rather than reading the shared one, so the assertion is on the
      // key half it must keep naming.
      expect(failureMessage(outcome)).toContain(
        'This encrypted envelope is also corrupted, so no key will open it unless the source changes.',
      );
      expect(failureMessage(outcome)).not.toContain('needs an operator to inspect it');
    });

    it('keeps the source sentence when the store was skipped for an identity the row holds', async () => {
      const d = deps({ fetchDocument: corruptFetch() });

      const outcome = await settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, {
        mode: 'recover',
        currentRecordId: 'record-1',
        holdsIdentity: true,
        acquisition: { from: 'source' },
      });

      expect(d.storeBinary).not.toHaveBeenCalled();
      expect(outcome.storage).toBeUndefined();
      expect(failureMessage(outcome)).toBe(SOURCE_MESSAGE);
    });

    it('keeps the source sentence on a registration, which has no copy to point at yet', async () => {
      const d = deps({ fetchDocument: corruptFetch() });
      d.storeBinary.mockRejectedValue(new StorageStoreError(503, 'storage unavailable'));

      const outcome = await settleInRequest(input({ decryptionKey: SUPPLIER_KEY }), d.deps, { mode: 'register' });

      expect(failureMessage(outcome)).toContain('unless the source changes');
    });
  });

  it('blames the record own copy, not a re-fetched source, when it opens to a non-credential on an identity-holding row', async () => {
    // S-6. Narrow to reach, and the caller's only account of the outcome.
    const d = deps();
    const plainNonCredential = JSON.stringify(
      encryptor.encrypt(JSON.stringify({ not: 'a credential' }), EncryptionAlgorithm.AES_256_GCM),
    );

    const outcome = await settleInRequest(
      input({ decryptionKey: SUPPLIER_KEY }),
      d.deps,
      storedCopy(plainNonCredential, { holdsIdentity: true }),
    );

    const message = (outcome.checkRun as { failure: { message: string } }).failure.message;
    expect(message).toContain("record's durable copy");
    expect(message).not.toContain('re-fetched source');
  });

  it('does not upload a stored copy when its supplied key does not open it', async () => {
    // A stored copy is already durable, so a failed decrypt must settle the
    // generation without creating a second ciphertext object. Fails if the
    // stored-copy path is accidentally treated as a fresh source fetch.
    const d = deps();

    const outcome = await settleInRequest(input({ decryptionKey: WRONG_KEY }), d.deps, {
      mode: 'recover',
      currentRecordId: 'record-1',
      holdsIdentity: false,
      acquisition: {
        from: 'stored-copy',
        document: {
          bytes: bytes(ENCRYPTED),
          contentType: 'application/json',
          finalUrl: 'https://storage.example/private/copy',
        },
        checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS },
        storageUri: 'https://storage.example/private/copy',
      },
    });

    expect(d.store).not.toHaveBeenCalled();
    expect(d.storeBinary).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      encrypted: true,
      acquisition: { mode: 'stored-copy' },
      checkRun: {
        state: CheckRunState.FAILED,
        checks: { retrieval: CheckResult.PASS, digest: CheckResult.PASS, decryption: CheckResult.FAIL },
        failure: { code: CheckRunFailureCode.DECRYPTION_FAILED, retryable: true },
      },
    });
  });

  it('returns a refused source as a failed retrieval run instead of throwing', async () => {
    // Register answers a guard refusal with a 400 and creates nothing. A
    // record already exists here, so the refusal is something to record on
    // it. Fails if the recover branch starts throwing SourceRejectedError.
    const failure: DocumentFetchFailure = {
      kind: 'rejected',
      reason: 'source-not-permitted',
      error: new Error('Hostname resolves to a private or reserved address'),
    };
    const d = deps({ fetchDocument: fetchFailure(failure) });

    const outcome = await settleInRequest(input(), d.deps, {
      mode: 'recover',
      currentRecordId: 'record-1',
      holdsIdentity: false,
      acquisition: { from: 'source' },
    });

    expect(outcome).toEqual({
      // A source fetch that returned nothing: the supplier was reached for,
      // and no digest exists, so the acquisition says so rather than leaving
      // the mode to be inferred from an absent digest.
      acquisition: { mode: 'source-failed' },
      encrypted: null,
      details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
      checkRun: {
        state: CheckRunState.FAILED,
        checks: { retrieval: CheckResult.FAIL },
        failure: {
          code: CheckRunFailureCode.RETRIEVAL_FAILED,
          message: 'Hostname resolves to a private or reserved address',
          retryable: false,
        },
      },
    });
    const { apiLogger } = jest.requireMock('@/lib/api/logger') as { apiLogger: Record<string, jest.Mock> };
    expect(apiLogger.warn).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', source: 'https://supplier.example', reason: 'source-not-permitted' },
      'The stored source was refused by the guard on re-verification',
    );
  });

  it('stores the copy and records a run when the content belongs to another record', async () => {
    // The record being recovered still needs its copy and its generation.
    // What it gives up is the identity. Fails if the duplicate returns early
    // again, which would leave the record as broken as it was.
    const d = deps({ findExistingExternal: async () => 'existing-record' });

    const outcome = await settleInRequest(input(), d.deps, {
      mode: 'recover',
      currentRecordId: 'record-1',
      holdsIdentity: false,
      acquisition: { from: 'source' },
    });

    expect(outcome.duplicateOfRecordId).toBe('existing-record');
    expect(outcome.observedContentDigest).toBe(await signedContentDigestOf(PLAINTEXT));
    expect(outcome.contentDigest).toBeUndefined();
    expect(outcome.contentKind).toBe(ExternalContentKind.CREDENTIAL);
    expect(outcome.storage).toMatchObject({ uri: 'https://storage.example/private/copy' });
    expect(outcome.checkRun).toMatchObject({ state: CheckRunState.PENDING });
    expect(d.store).toHaveBeenCalledWith(JSON.parse(PLAINTEXT), true);
  });

  it('still reports the pointer and the observed identity when the store fails', async () => {
    // The digest the caller revalidates against has to survive the branch
    // that writes no copy, or a recovery whose store failed would have no way
    // to check the pointer it is about to write.
    const d = deps({ findExistingExternal: async () => 'existing-record' });
    d.store.mockRejectedValueOnce(new StorageStoreError(503, 'unavailable'));

    const outcome = await settleInRequest(input(), d.deps, {
      mode: 'recover',
      currentRecordId: 'record-1',
      holdsIdentity: false,
      acquisition: { from: 'source' },
    });

    expect(outcome.duplicateOfRecordId).toBe('existing-record');
    expect(outcome.observedContentDigest).toBe(await signedContentDigestOf(PLAINTEXT));
    expect(outcome.contentDigest).toBeUndefined();
    expect(outcome.storage).toBeUndefined();
    expect(outcome.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failure: { code: CheckRunFailureCode.STORAGE_FAILED },
    });
  });

  it('excludes the record being recovered so its own content is not its own duplicate', async () => {
    const findExistingExternal = jest.fn(async () => null);
    const d = deps({ findExistingExternal });

    const outcome = await settleInRequest(input(), d.deps, {
      mode: 'recover',
      currentRecordId: 'record-1',
      holdsIdentity: false,
      acquisition: { from: 'source' },
    });

    expect(findExistingExternal).toHaveBeenCalledWith('tenant-1', await signedContentDigestOf(PLAINTEXT), 'record-1');
    expect(outcome.contentDigest).toBe(await signedContentDigestOf(PLAINTEXT));
    expect(outcome.duplicateOfRecordId).toBeUndefined();
    expect(outcome.observedContentDigest).toBeUndefined();
  });

  it('skips storing a non-credential body when the reservation snapshot already holds an identity', async () => {
    // The finaliser refuses this response regardless of what is stored (the
    // fetched-content rule never lets a non-credential body replace an
    // existing identity), so storing it here would only be discarded and
    // orphan-logged. The no-identity case below shows the row still stores.
    const d = deps({
      fetchDocument: async () => ({
        bytes: bytes('<html>not a credential</html>'),
        contentType: 'text/html; charset=utf-8',
        finalUrl: 'x',
      }),
    });

    const outcome = await settleInRequest(input(), d.deps, {
      mode: 'recover',
      currentRecordId: 'record-1',
      holdsIdentity: true,
      acquisition: { from: 'source' },
    });

    expect(d.store).not.toHaveBeenCalled();
    expect(d.storeBinary).not.toHaveBeenCalled();
    expect(outcome.storage).toBeUndefined();
    expect(outcome.contentKind).toBe(ExternalContentKind.OPAQUE);
    expect(outcome.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      checks: { retrieval: CheckResult.PASS },
    });
  });

  it('still stores a non-credential body when the reservation snapshot holds no identity', async () => {
    const d = deps({
      fetchDocument: async () => ({
        bytes: bytes('<html>not a credential</html>'),
        contentType: 'text/html; charset=utf-8',
        finalUrl: 'x',
      }),
    });

    const outcome = await settleInRequest(input(), d.deps, {
      mode: 'recover',
      currentRecordId: 'record-1',
      holdsIdentity: false,
      acquisition: { from: 'source' },
    });

    expect(d.storeBinary).toHaveBeenCalled();
    expect(outcome.storage).toBeDefined();
  });

  it('skips storing unopened ciphertext when the reservation snapshot already holds an identity', async () => {
    const d = deps({
      fetchDocument: async () => ({
        bytes: bytes(ENCRYPTED),
        contentType: 'application/json',
        finalUrl: 'x',
      }),
    });

    const outcome = await settleInRequest(input(), d.deps, {
      mode: 'recover',
      currentRecordId: 'record-1',
      holdsIdentity: true,
      acquisition: { from: 'source' },
    });

    expect(d.storeBinary).not.toHaveBeenCalled();
    expect(outcome.storage).toBeUndefined();
    expect(outcome.checkRun).toMatchObject({ state: CheckRunState.FAILED });
  });

  it('does not let register mode pass a record id, or recover mode leave one out', () => {
    // The lookup excludes whatever id it is given, so a registration handed
    // one could be told a record is not a duplicate of the very record it
    // matches, and a recovery without one matches itself. Compile-time only:
    // these calls are never executed, because the point is that they do not
    // type-check.
    const d = deps();
    const never = () => {
      // @ts-expect-error register mode has no record to exclude
      void settleInRequest(input(), d.deps, { mode: 'register', currentRecordId: 'record-1' });
      // @ts-expect-error recover mode must name the record being recovered and its acquisition mode
      void settleInRequest(input(), d.deps, { mode: 'recover' });
      // @ts-expect-error a stored-copy acquisition cannot omit the checks its read earned
      void settleInRequest(input(), d.deps, {
        mode: 'recover',
        currentRecordId: 'record-1',
        holdsIdentity: false,
        acquisition: {
          from: 'stored-copy',
          document: { bytes: bytes(ENCRYPTED), contentType: 'application/json', finalUrl: 'x' },
          storageUri: 'https://storage.example/copy',
        },
      });
    };
    expect(never).toBeInstanceOf(Function);
  });
});
