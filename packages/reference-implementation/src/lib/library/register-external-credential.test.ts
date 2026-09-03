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
  SourceRejectedError,
  StorageKeyMissingError,
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
  return {
    MultibaseDigest: {
      fromData: async (data: Uint8Array) => ({ toString: () => `z${createHash('sha256').update(data).digest('hex')}` }),
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

  it('records a key supplied against a plaintext source as unused and still registers', async () => {
    const { created } = await persisted({ decryptionKey: SUPPLIER_KEY });
    expect(created.decryptionKeyUnused).toBe(true);
    expect(created.checkRun.state).toBe(CheckRunState.PENDING);
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
        message: expect.stringContaining('no decryption key'),
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
        message: expect.stringMatching(/storage[\s\S]*no decryption key/),
      },
    });
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
        err: failure,
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
