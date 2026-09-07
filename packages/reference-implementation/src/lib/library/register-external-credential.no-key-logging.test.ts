/**
 * @jest-environment node
 */
process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);

const mockCapturedLogLines: string[] = [];

jest.mock('@uncefact/untp-ri-services/logging', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services/logging');
  return {
    ...actual,
    createLogger: (config: Record<string, unknown> = {}) =>
      actual.createLogger({
        ...config,
        level: 'debug',
        destination: { write: (line: string) => mockCapturedLogLines.push(line) },
      }),
  };
});

// The resolver package ships as ESM this runtime cannot load, and the fetch
// helper is injected here anyway.
jest.mock('@uncefact/untp-utils/resolvers', () => ({
  ...jest.requireActual('@uncefact/untp-utils/resolvers/errors'),
  resolveDocument: jest.fn(),
}));

import { decodeJwt } from 'jose';
import { AesGcmEncryptionAdapter, EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import type { StorageRecord } from '@uncefact/untp-ri-services';
import { CoreCredentialType } from '@/lib/prisma/generated';
import { apiLogger } from '@/lib/api/logger';
import {
  registerExternalCredential,
  type RegisterExternalCredentialDependencies,
} from './register-external-credential';

const SENTINEL_KEY = 'deadbeefcafe0042'.repeat(4);
const WRONG_KEY = 'b'.repeat(64);

const quietLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quietLogger,
};
const encryptor = new AesGcmEncryptionAdapter(SENTINEL_KEY, quietLogger as never);

beforeAll(() => {
  (decodeJwt as jest.Mock).mockImplementation((jwt: string) =>
    JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()),
  );
});

beforeEach(() => {
  mockCapturedLogLines.length = 0;
  storeCalls.store.mockClear();
  storeCalls.storeBinary.mockClear();
});

function envelopedCredential(): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${b64({ alg: 'ES256', typ: 'vc+jwt' })}.${b64({
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/'],
    type: ['VerifiableCredential', 'DigitalProductPassport'],
    name: 'Battery pack passport',
    issuer: { id: 'did:web:supplier.example', name: 'Supplier Ltd' },
    credentialSubject: { id: 'https://supplier.example/products/1', name: 'Battery pack' },
  })}.sig`;
  return JSON.stringify({
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: `data:application/vc+jwt,${jwt}`,
  });
}

const ENCRYPTED = JSON.stringify(encryptor.encrypt(envelopedCredential(), EncryptionAlgorithm.AES_256_GCM));

const storeCalls = { store: jest.fn(), storeBinary: jest.fn() };

function deps(existingRecordId: string | null, storeFailure?: Error): RegisterExternalCredentialDependencies {
  const stored: StorageRecord = {
    uri: 'https://storage.example/private/copy',
    digestMultibase: 'zStoredDigest',
    decryptionKey: 'c'.repeat(64),
    externalId: 'copy-1',
    bucket: 'private',
    mimeType: 'application/json',
  };
  const write = async () => {
    if (storeFailure !== undefined) throw storeFailure;
    return stored;
  };
  return {
    fetchDocument: async () => ({
      bytes: new TextEncoder().encode(ENCRYPTED),
      contentType: 'application/json',
      finalUrl: 'https://supplier.example/a',
    }),
    resolveStorage: async () => ({
      service: {
        store: async (...args: unknown[]) => {
          storeCalls.store(...args);
          return write();
        },
        storeBinary: async (bytes: Uint8Array, name: string, type: string, encrypt?: boolean) => {
          storeCalls.storeBinary(bytes, name, type, encrypt);
          const record = await write();
          return encrypt ? record : { ...record, decryptionKey: undefined, bucket: 'public' };
        },
        delete: jest.fn(),
      } as never,
      instanceId: 'storage-1',
    }),
    assertEncryptionReady: () => undefined,
    enqueueVerification: async () => undefined,
    persist: async (created) => created as never,
    findExistingExternal: async () => existingRecordId,
  };
}

function input(decryptionKey: string) {
  return {
    tenantId: 'tenant-1',
    sourceUrl: 'https://supplier.example/a?token=capability-token',
    decryptionKey,
    annotations: { displayName: 'Supplier DPP', declaredCredentialType: CoreCredentialType.DPP },
  };
}

function parsedLines(): Record<string, unknown>[] {
  return mockCapturedLogLines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('registering an encrypted duplicate leaves the supplier key out of the rendered log', () => {
  it('writes the duplicate breadcrumb with the tenant, the origin and the existing record, and nothing else', async () => {
    await expect(registerExternalCredential(input(SENTINEL_KEY), deps('existing-record'))).rejects.toMatchObject({
      name: 'DuplicateCredentialError',
      existingRecordId: 'existing-record',
    });

    expect(mockCapturedLogLines.length).toBeGreaterThan(0);
    const breadcrumb = parsedLines().find((line) => line.msg === 'Credential content is already registered');
    expect(breadcrumb).toMatchObject({
      tenantId: 'tenant-1',
      source: 'https://supplier.example',
      existingRecordId: 'existing-record',
    });
    const captured = mockCapturedLogLines.join('');
    expect(captured).not.toContain(SENTINEL_KEY);
    // The origin is logged, never the capability token the path carries.
    expect(captured).not.toContain('capability-token');
  });

  it('renders the decrypt failure without the key that produced it', async () => {
    // A failure raised while the key was in hand is the case worth pinning.
    // Its rendered line carries the failure's name and message and nothing
    // else, and neither may carry the key.
    await registerExternalCredential(input(WRONG_KEY), deps(null));

    const failure = parsedLines().find((line) => line.msg === 'The supplied key did not open the fetched envelope');
    expect(failure).toBeDefined();
    expect(failure?.error).toMatchObject({ name: expect.any(String), message: expect.any(String) });
    expect(failure).not.toHaveProperty('err');
    const captured = mockCapturedLogLines.join('');
    expect(captured).not.toContain(WRONG_KEY);
    expect(captured).not.toContain(SENTINEL_KEY);
  });

  it('reduces a storage failure to a name and a message, so its nested cause never reaches the log', async () => {
    // The real failure path: a non-duplicate registration that stores and
    // fails. Pino renders an error's whole cause chain, so passing the raw
    // error under `err` would write the nested cause out in full. This is
    // the case the `safeError` reduction exists for. Fails the moment any
    // line on this path goes back to logging the error object itself.
    const leaky = new Error('the durable copy could not be written', {
      cause: new Error(`supplier key ${SENTINEL_KEY} was in scope when this failed`),
    });

    await registerExternalCredential(input(SENTINEL_KEY), deps(null, leaky));

    const line = parsedLines().find((entry) => entry.msg === 'Durable copy could not be stored');
    expect(line).toBeDefined();
    expect(line?.error).toEqual({ name: 'Error', message: 'the durable copy could not be written' });
    expect(line).not.toHaveProperty('err');
    expect(mockCapturedLogLines.join('')).not.toContain(SENTINEL_KEY);
  });

  it('refuses the duplicate before it reaches the store at all', async () => {
    // The store is rigged to fail, and the ordering is what decides whether
    // that failure ever happens. The sentinel's absence no longer proves the
    // order on its own, because the store line is reduced either way, so the
    // store itself is asserted untouched.
    const leaky = new Error('the durable copy could not be written', {
      cause: new Error(`supplier key ${SENTINEL_KEY} was in scope when this failed`),
    });

    await expect(registerExternalCredential(input(SENTINEL_KEY), deps('existing-record', leaky))).rejects.toMatchObject(
      { name: 'DuplicateCredentialError' },
    );

    expect(storeCalls.store).not.toHaveBeenCalled();
    expect(storeCalls.storeBinary).not.toHaveBeenCalled();
    expect(mockCapturedLogLines.length).toBeGreaterThan(0);
    expect(mockCapturedLogLines.join('')).not.toContain(SENTINEL_KEY);
  });

  it('proves the capture would catch a key written through the logger this pipeline uses', () => {
    // Without this the two assertions above would also pass on a logger that
    // rendered nothing, and on a cause chain that was silently dropped.
    apiLogger
      .child({ module: 'register-external-credential' })
      .warn({ err: new Error('outer', { cause: new Error(`inner ${SENTINEL_KEY}`) }) }, 'deliberate sentinel write');

    const captured = mockCapturedLogLines.join('');
    expect(captured).toContain('deliberate sentinel write');
    expect(captured).toContain(SENTINEL_KEY);
  });
});
