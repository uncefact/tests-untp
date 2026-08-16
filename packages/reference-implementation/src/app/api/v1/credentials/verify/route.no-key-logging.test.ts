/**
 * Pins that a submitted decryption key never appears in the verify route's
 * serialised log output, on the success path and on the decryption-failure
 * path. The route's main suite replaces the logger with a discarding mock, so
 * an assertion there could never fail; this suite runs a real pino logger
 * (production redaction config included) into a capturing destination, the
 * real withPublicRoute wrapper, and real AES-256-GCM decryption so the logged
 * `err` objects are the real ones. The crypto layer's own logger (built
 * inside the services package) is pinned by the sibling suite
 * packages/services/src/encryption/decrypt-credential.no-key-logging.test.ts;
 * the two suites together cover both destinations a key could leak through.
 */

// Polyfill AbortSignal.timeout for jsdom (not available in jsdom)
if (typeof AbortSignal.timeout !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (AbortSignal as any).timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// The real wrapper is used (with next/server mocked above) so its request and
// error logging goes through the same captured logger as the route's own.
jest.mock('@/lib/api/with-public-route', () => jest.requireActual('@/lib/api/with-public-route'));

const capturedLogLines: string[] = [];

jest.mock('@/lib/api/logger', () => {
  const { createLogger } = jest.requireActual('@uncefact/untp-ri-services/logging');
  return {
    apiLogger: createLogger({
      level: 'debug',
      destination: {
        write: (msg: string) => {
          capturedLogLines.push(msg);
        },
      },
    }).child({ module: 'api' }),
  };
});

const mockResolveVcService = jest.fn();
jest.mock('@/lib/services/resolve-vc-service', () => ({
  resolveVcService: (...args: unknown[]) => mockResolveVcService(...args),
}));

const mockResolveDocument = jest.fn();
jest.mock('@uncefact/untp-utils/resolvers', () => ({
  resolveDocument: (...args: unknown[]) => mockResolveDocument(...args),
  ResolverError: class ResolverError extends Error {},
  ResolverHttpError: class ResolverHttpError extends Error {},
  ResolverTooLargeError: class ResolverTooLargeError extends Error {},
  ResolverTimedOutError: class ResolverTimedOutError extends Error {},
}));
jest.mock('@uncefact/untp-utils/node', () => ({
  UrlValidationError: class UrlValidationError extends Error {},
}));

import { createCipheriv, randomBytes } from 'node:crypto';
import { POST } from './route';

const SENTINEL_KEY = 'deadbeefcafe0042'.repeat(4); // 64 hex chars, distinctive
const WRONG_KEY = 'a'.repeat(64);

const CREDENTIAL = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id: 'data:application/vc+jwt,eyJhbGciOiJFZDI1NTE5In0.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.sig',
  type: 'EnvelopedVerifiableCredential',
};

/** Real AES-256-GCM envelope in the storage service's shape. */
function encryptEnvelope(plaintext: string, hexKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    cipherText: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    type: 'aes-256-gcm',
  };
}

function createFakeRequest(body: Record<string, unknown>): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/credentials/verify',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
  } as unknown as Request;
}

function mockStorageDocument(body: unknown) {
  mockResolveDocument.mockResolvedValue({
    body: new TextEncoder().encode(JSON.stringify(body)),
  });
}

describe('verify route never logs the decryption key', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedLogLines.length = 0;
    delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
    mockResolveVcService.mockResolvedValue({
      service: { verify: jest.fn().mockResolvedValue({ verified: true }) },
      instanceId: 'inst-1',
    });
  });

  it('emits log lines but none containing the key on successful decryption and verification', async () => {
    mockStorageDocument(encryptEnvelope(JSON.stringify(CREDENTIAL), SENTINEL_KEY));

    const res = await POST(createFakeRequest({ uri: 'https://storage.example.com/cred', decryptionKey: SENTINEL_KEY }));
    expect(res.status).toBe(200);

    const output = capturedLogLines.join('');
    expect(capturedLogLines.length).toBeGreaterThan(0); // the capture actually captured
    expect(output).not.toContain(SENTINEL_KEY);
  });

  it('does not log the key when decryption fails with a wrong key (err serialisation included)', async () => {
    mockStorageDocument(encryptEnvelope(JSON.stringify(CREDENTIAL), SENTINEL_KEY));

    const res = await POST(createFakeRequest({ uri: 'https://storage.example.com/cred', decryptionKey: WRONG_KEY }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('DECRYPTION_FAILED');

    const output = capturedLogLines.join('');
    expect(capturedLogLines.length).toBeGreaterThan(0);
    expect(output).not.toContain(WRONG_KEY);
    expect(output).not.toContain(SENTINEL_KEY);
  });

  it('the capture would catch a leak (self-check that this suite can fail)', async () => {
    // Guard against the capture silently detaching from the logger: log the
    // sentinel deliberately and confirm it shows up in the captured output.
    mockStorageDocument(encryptEnvelope(JSON.stringify(CREDENTIAL), SENTINEL_KEY));
    await POST(createFakeRequest({ uri: 'https://storage.example.com/cred', decryptionKey: SENTINEL_KEY }));

    const { apiLogger } = jest.requireMock('@/lib/api/logger');
    apiLogger.info({ leakCheck: SENTINEL_KEY }, 'deliberate sentinel write');

    expect(capturedLogLines.join('')).toContain(SENTINEL_KEY);
  });
});
