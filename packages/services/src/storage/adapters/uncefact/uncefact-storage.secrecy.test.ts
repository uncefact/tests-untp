import { TextEncoder } from 'node:util';
import { UncefactStorageAdapter } from './uncefact-storage.adapter';
import { StoragePayloadError, StorageStoreError } from '../../errors';
import { createLogger } from '../../../logging/factory';
import type { UncefactStorageConfig } from './uncefact-storage.schema';
import type { EnvelopedVerifiableCredential } from '../../../verifiable-credential/types';

const PLAINTEXT_SENTINEL = 'PLAINTEXT-SENTINEL-decrypted-credential-body';
const KEY_SENTINEL = 'KEY-SENTINEL-' + 'a'.repeat(51);
const VALID_KEY = 'a'.repeat(64);
const VALID_KEY_SENTINEL = 'd'.repeat(64);
const LONG_RESPONSE_TEXT = `<html>proxy error: ${PLAINTEXT_SENTINEL}${'x'.repeat(300)}</html>`;

const HEX_A = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const MULTIBASE_A = `zTEST${HEX_A}`;

const config: UncefactStorageConfig = {
  baseUrl: 'https://storage.example.com',
  apiKey: 'test-api-key',
  apiVersion: '4.0',
  publicBucket: 'public-data',
  privateBucket: 'private-data',
};

const credential: EnvelopedVerifiableCredential = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id: 'data:application/vc+jwt,eyJhbGciOiJFZERTQSJ9.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.signature',
  type: 'EnvelopedVerifiableCredential',
};

const capturedLines: string[] = [];
const logger = createLogger({
  level: 'debug',
  destination: { write: (line: string) => capturedLines.push(line) },
});

function rendered(): string {
  return capturedLines.join('');
}

let mockFetch: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  capturedLines.length = 0;
  mockFetch = jest.fn();
  global.fetch = mockFetch as unknown as typeof fetch;
  globalThis.crypto.randomUUID = jest
    .fn()
    .mockReturnValue('a1b2c3d4-e5f6-7890-abcd-ef1234567890') as unknown as Crypto['randomUUID'];
});

const writeMethods = [
  ['store', (adapter: UncefactStorageAdapter) => adapter.store(credential, true)],
  [
    'storeBinary',
    (adapter: UncefactStorageAdapter) =>
      adapter.storeBinary(new TextEncoder().encode(PLAINTEXT_SENTINEL), 'copy.json', 'application/json', true),
  ],
] as const;

type ResponseValidationCase = {
  name: string;
  classification: string;
  detail: string;
  body?: unknown;
  responseText?: string;
  jsonError?: Error;
  expectedFields: Record<string, string>;
  /** The thrown status: the upstream 2xx, except a malformed legacy hash, which is a 502 as on every release. */
  expectedStatus?: number;
};

const responseValidationCases: ResponseValidationCase[] = [
  {
    name: 'invalid JSON',
    classification: 'invalid-json',
    detail: 'Storage API returned invalid JSON response',
    responseText: LONG_RESPONSE_TEXT,
    jsonError: new SyntaxError('Unexpected token'),
    expectedFields: { untrustedResponseBody: LONG_RESPONSE_TEXT },
  },
  {
    name: 'a non-object body',
    classification: 'invalid-body',
    detail: 'Storage API returned invalid response: body is not an object',
    body: `body contains ${PLAINTEXT_SENTINEL}`,
    expectedFields: { responseBody: `body contains ${PLAINTEXT_SENTINEL}` },
  },
  {
    name: 'an invalid URI',
    classification: 'invalid-uri',
    detail: 'Storage API returned invalid response',
    body: {
      uri: { leaked: PLAINTEXT_SENTINEL, key: KEY_SENTINEL },
      digestMultibase: MULTIBASE_A,
    },
    expectedFields: { uri: `{"leaked":"${PLAINTEXT_SENTINEL}","key":"[REDACTED]"}` },
  },
  {
    name: 'an invalid decryption key',
    classification: 'invalid-decryption-key',
    detail: 'Storage API returned invalid response',
    body: {
      uri: 'https://storage.example.com/documents/abc',
      decryptionKey: [KEY_SENTINEL],
      digestMultibase: MULTIBASE_A,
    },
    expectedFields: { decryptionKeyType: 'object', decryptionKeyLength: '1' },
  },
  {
    name: 'an invalid digest',
    classification: 'invalid-digest',
    detail: 'Storage API returned invalid response',
    body: {
      uri: 'https://storage.example.com/documents/abc',
      decryptionKey: VALID_KEY,
      digestMultibase: `bad-${PLAINTEXT_SENTINEL}`,
    },
    expectedFields: { digestMultibase: `bad-${PLAINTEXT_SENTINEL}` },
  },
  {
    name: 'an invalid legacy hash',
    classification: 'invalid-hash',
    detail: 'Storage API returned invalid response',
    body: {
      uri: 'https://storage.example.com/documents/abc',
      decryptionKey: VALID_KEY,
      hash: `bad-${PLAINTEXT_SENTINEL}`,
    },
    expectedFields: { hash: `bad-${PLAINTEXT_SENTINEL}` },
    expectedStatus: 502,
  },
  {
    name: 'a body with no digest',
    classification: 'missing-digest',
    detail: 'Storage API returned invalid response',
    body: {
      uri: 'https://storage.example.com/documents/abc',
      decryptionKey: VALID_KEY,
      carried: PLAINTEXT_SENTINEL,
    },
    expectedFields: { responseFields: '["uri","decryptionKey","carried"]' },
  },
  {
    name: 'an unexpected validation error',
    classification: 'invalid-response',
    detail: 'Storage API returned invalid response',
    body: {
      uri: 'https://storage.example.com/documents/abc',
      decryptionKey: VALID_KEY,
      get hash(): string {
        throw new Error('response hash could not be read');
      },
    },
    expectedFields: { validationError: 'response hash could not be read' },
  },
];

function responseFor(testCase: ResponseValidationCase): Record<string, unknown> {
  return {
    ok: true,
    status: 201,
    json: testCase.jsonError
      ? jest.fn().mockRejectedValue(testCase.jsonError)
      : jest.fn().mockResolvedValue(testCase.body),
    ...(testCase.responseText !== undefined ? { text: jest.fn().mockResolvedValue(testCase.responseText) } : {}),
  };
}

describe('a 2xx response-validation refusal carries serialised evidence only in its log', () => {
  describe.each(writeMethods)('%s', (_operation, write) => {
    it.each(responseValidationCases)(
      'logs the serialised value for %s without changing the thrown message',
      async (testCase) => {
        mockFetch.mockResolvedValue(responseFor(testCase));
        const adapter = new UncefactStorageAdapter(config, logger);

        const thrown = await write(adapter).then(
          () => undefined,
          (error: unknown) => error,
        );

        expect(thrown).toBeInstanceOf(StorageStoreError);
        expect((thrown as Error).message).toBe(
          `Failed to store credential: HTTP ${testCase.expectedStatus ?? 201}: ${testCase.detail} (${
            testCase.classification
          }) (object a1b2c3d4-e5f6-7890-abcd-ef1234567890 in bucket private-data may have been created)`,
        );
        expect(rendered()).toContain(`"classification":"${testCase.classification}"`);
        for (const [field, value] of Object.entries(testCase.expectedFields)) {
          expect(rendered()).toContain(`"${field}":${JSON.stringify(value)}`);
        }
        expect(rendered()).not.toContain(KEY_SENTINEL);
        expect((thrown as Error).message).not.toContain(PLAINTEXT_SENTINEL);
      },
    );
  });

  it('logs a 400-character signed URL in an invalid URI value in full', async () => {
    const signedUrl = `https://storage.example.com/documents/signed?token=${'x'.repeat(349)}`;
    expect(signedUrl).toHaveLength(400);
    const invalidUri = { signedUrl };
    mockFetch.mockResolvedValue(
      responseFor({
        name: 'long signed URL',
        classification: 'invalid-uri',
        detail: 'Storage API returned invalid response',
        body: { uri: invalidUri, digestMultibase: MULTIBASE_A },
        expectedFields: {},
      }),
    );
    const adapter = new UncefactStorageAdapter(config, logger);

    await expect(adapter.store(credential)).rejects.toThrow(
      'Failed to store credential: HTTP 201: Storage API returned invalid response (invalid-uri) (object a1b2c3d4-e5f6-7890-abcd-ef1234567890 in bucket public-data may have been created)',
    );

    const serialisedUri = JSON.stringify(invalidUri);
    expect(rendered()).toContain(`"uri":${JSON.stringify(serialisedUri)}`);
    expect(rendered()).not.toContain('"uriTruncated"');
  });

  it('does not log the characters of an invalid decryption key', async () => {
    mockFetch.mockResolvedValue(
      responseFor({
        name: 'wrong-shaped key',
        classification: 'invalid-decryption-key',
        detail: 'Storage API returned invalid response',
        body: {
          uri: 'https://storage.example.com/documents/abc',
          decryptionKey: [KEY_SENTINEL],
          digestMultibase: MULTIBASE_A,
        },
        expectedFields: {},
      }),
    );
    const adapter = new UncefactStorageAdapter(config, logger);

    await expect(adapter.store(credential, true)).rejects.toThrow(
      'Failed to store credential: HTTP 201: Storage API returned invalid response (invalid-decryption-key) (object a1b2c3d4-e5f6-7890-abcd-ef1234567890 in bucket private-data may have been created)',
    );

    expect(rendered()).toContain('"decryptionKeyType":"object"');
    expect(rendered()).toContain('"decryptionKeyLength":"1"');
    expect(rendered()).not.toContain(KEY_SENTINEL);
  });

  it('keeps a valid returned key available to the caller without rendering it', async () => {
    mockFetch.mockResolvedValue(
      responseFor({
        name: 'valid key',
        classification: 'not-a-refusal',
        detail: '',
        body: {
          uri: 'https://storage.example.com/documents/abc',
          decryptionKey: VALID_KEY_SENTINEL,
          digestMultibase: MULTIBASE_A,
        },
        expectedFields: {},
      }),
    );
    const adapter = new UncefactStorageAdapter(config, logger);

    const record = await adapter.store(credential, true);

    expect(record.decryptionKey).toBe(VALID_KEY_SENTINEL);
    expect(rendered()).toContain('Credential stored successfully');
    expect(rendered()).not.toContain(VALID_KEY_SENTINEL);
  });
});

describe('a storage service refusal carries the service message and nothing else', () => {
  const UPSTREAM_MESSAGE = 'bucket private-data is over quota';

  describe.each(writeMethods)('%s', (_operation, write) => {
    it.each([
      [400, 'Storage API rejected payload', StoragePayloadError],
      [503, 'Storage API request failed', StorageStoreError],
    ] as const)('renders the upstream message on HTTP %i', async (status, logMessage, errorType) => {
      mockFetch.mockResolvedValue({
        ok: false,
        status,
        statusText: 'Upstream failure',
        json: jest.fn().mockResolvedValue({ message: UPSTREAM_MESSAGE, code: PLAINTEXT_SENTINEL }),
      });
      const adapter = new UncefactStorageAdapter(config, logger);

      const thrown = await write(adapter).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(thrown).toBeInstanceOf(errorType);
      expect(rendered()).toContain(logMessage);
      expect((thrown as Error).message).toContain(UPSTREAM_MESSAGE);
      expect(rendered()).toContain(`"detail":"${UPSTREAM_MESSAGE}"`);
      expect(rendered()).not.toContain('"code"');
      expect(rendered()).not.toContain(KEY_SENTINEL);
    });
  });
});

it('proves this capture would see either sentinel if a line carried one', () => {
  logger.warn({ leakCheck: PLAINTEXT_SENTINEL, key: KEY_SENTINEL }, 'deliberate sentinel write');

  expect(rendered()).toContain(PLAINTEXT_SENTINEL);
  expect(rendered()).toContain(KEY_SENTINEL);
});
