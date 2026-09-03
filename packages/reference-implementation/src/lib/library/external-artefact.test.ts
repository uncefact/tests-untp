export {};

const loggerCalls = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('@/lib/api/logger', () => {
  const logger: Record<string, unknown> = {
    info: (...args: unknown[]) => loggerCalls.info(...args),
    warn: (...args: unknown[]) => loggerCalls.warn(...args),
    error: (...args: unknown[]) => loggerCalls.error(...args),
  };
  logger.child = () => logger;
  return { apiLogger: logger };
});

/** Set by a test to stand in for the registry lookup; the real one otherwise. */
let getBridgeOverride: ((name: string, version: string) => unknown) | undefined;
jest.mock('@uncefact/untp-ri-services', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services');
  return {
    ...actual,
    getBridge: (name: string, version: string) =>
      getBridgeOverride ? getBridgeOverride(name, version) : actual.getBridge(name, version),
  };
});

/** Set by a test to make the chosen bridge throw while reading the subject. */
let extractOverride: (() => never) | undefined;
jest.mock('@/lib/credentials/extract-credential-details', () => {
  const actual = jest.requireActual('@/lib/credentials/extract-credential-details');
  return {
    ...actual,
    extractCredentialDetails: (...args: unknown[]) =>
      extractOverride ? extractOverride() : actual.extractCredentialDetails(...args),
  };
});

import { decodeJwt } from 'jose';
import { AesGcmEncryptionAdapter, EncryptionAlgorithm } from '@uncefact/untp-ri-services/encryption';
import type { UNTPVerifiableCredential } from '@uncefact/untp-ri-services';
import {
  CoreCredentialType,
  CredentialDetailsError,
  CredentialDetailsStatus,
  ExternalContentKind,
} from '@/lib/prisma/generated';
import { captureExternalDetails, readExternalArtefact } from './external-artefact';

const DPP_060_CONTEXT = 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/';
const DPP_061_CONTEXT = 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/';
const VC_CONTEXT = 'https://www.w3.org/ns/credentials/v2';

/** A 32-byte hex key, the only shape the AES-GCM adapter accepts. */
const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

const mockLogger = { child: () => mockLogger, debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function compactJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

/** Stands in for jose's decoder: reads the payload, throws on anything that is not a compact JWT. */
function decodeCompactJwt(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new Error('Invalid JWT');
  }
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

function dppPayload(overrides: Record<string, unknown> = {}) {
  return {
    '@context': [VC_CONTEXT, DPP_061_CONTEXT],
    type: ['VerifiableCredential', 'DigitalProductPassport'],
    name: 'Wool Passport',
    issuer: { id: 'did:web:issuer.example', name: 'Example Issuer' },
    credentialSubject: { product: { id: 'https://example.com/product/1', name: 'Merino batch' } },
    validFrom: '2024-01-15T00:00:00.000Z',
    validUntil: '2025-01-15T00:00:00.000Z',
    ...overrides,
  };
}

function enveloped(payload: Record<string, unknown>) {
  return {
    '@context': [VC_CONTEXT],
    id: `data:application/vc+jwt,${compactJwt(payload)}`,
    type: 'EnvelopedVerifiableCredential',
  };
}

function bytes(value: unknown): Uint8Array {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return new TextEncoder().encode(text);
}

function encryptedEnvelope(plaintext: string, key = KEY) {
  const adapter = new AesGcmEncryptionAdapter(key, mockLogger as never);
  return adapter.encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM);
}

beforeEach(() => {
  jest.clearAllMocks();
  getBridgeOverride = undefined;
  extractOverride = undefined;
  (decodeJwt as jest.Mock).mockImplementation(decodeCompactJwt);
});

describe('readExternalArtefact', () => {
  it('opens a plaintext enveloped credential and reports it was never encrypted', () => {
    const body = enveloped(dppPayload());
    const reading = readExternalArtefact(bytes(body), undefined);

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.encrypted).toBe(false);
    expect(reading.keyUnused).toBe(false);
    expect(reading.content.kind).toBe(ExternalContentKind.CREDENTIAL);
    if (reading.content.kind !== ExternalContentKind.CREDENTIAL) return;
    expect(reading.content.bytes).toEqual(bytes(body));
    expect(reading.content.credential).toEqual(body);
    expect(reading.content.decoded).toEqual(dppPayload());
  });

  it('reports a key as unused when the body turned out to be plaintext', () => {
    const reading = readExternalArtefact(bytes(enveloped(dppPayload())), KEY);

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.keyUnused).toBe(true);
    expect(reading.encrypted).toBe(false);
  });

  it('leaves an encrypted envelope closed when no key was supplied, keeping the ciphertext as fetched', () => {
    const envelope = encryptedEnvelope(JSON.stringify(enveloped(dppPayload())));
    const raw = JSON.stringify(envelope);

    const reading = readExternalArtefact(bytes(raw), undefined);

    expect(reading).toEqual({ outcome: 'encrypted-no-key', bytes: bytes(raw) });
  });

  it('reports a key mismatch when the supplied key does not open the envelope', () => {
    const envelope = encryptedEnvelope(JSON.stringify(enveloped(dppPayload())));
    const raw = JSON.stringify(envelope);

    const reading = readExternalArtefact(bytes(raw), OTHER_KEY);

    expect(reading).toEqual({ outcome: 'encrypted-key-failed', bytes: bytes(raw), reason: 'key-mismatch' });
  });

  it('distinguishes a corrupt envelope from a wrong key when the iv is the wrong length', () => {
    const envelope = encryptedEnvelope(JSON.stringify(enveloped(dppPayload())));
    const corrupt = { ...envelope, iv: Buffer.alloc(8).toString('base64') };
    const raw = JSON.stringify(corrupt);

    const reading = readExternalArtefact(bytes(raw), KEY);

    expect(reading).toEqual({ outcome: 'encrypted-key-failed', bytes: bytes(raw), reason: 'envelope-invalid' });
  });

  it('opens an encrypted envelope with the right key and classifies the plaintext', () => {
    const body = enveloped(dppPayload());
    const envelope = encryptedEnvelope(JSON.stringify(body));

    const reading = readExternalArtefact(bytes(JSON.stringify(envelope)), KEY);

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.encrypted).toBe(true);
    expect(reading.keyUnused).toBe(false);
    expect(reading.content.kind).toBe(ExternalContentKind.CREDENTIAL);
    if (reading.content.kind !== ExternalContentKind.CREDENTIAL) return;
    expect(reading.content.bytes).toEqual(bytes(body));
    expect(reading.content.decoded).toEqual(dppPayload());
  });

  it('opens an encrypted envelope whose plaintext is some other JSON object', () => {
    const envelope = encryptedEnvelope(JSON.stringify({ hello: 'world' }));

    const reading = readExternalArtefact(bytes(JSON.stringify(envelope)), KEY);

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.encrypted).toBe(true);
    expect(reading.content).toEqual({ kind: ExternalContentKind.JSON_OBJECT, bytes: bytes('{"hello":"world"}') });
  });

  it('classifies a JSON object that is not an enveloped credential', () => {
    const reading = readExternalArtefact(bytes({ '@context': [VC_CONTEXT], type: 'VerifiableCredential' }), undefined);

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.content.kind).toBe(ExternalContentKind.JSON_OBJECT);
  });

  it('classifies an enveloped credential whose JWT cannot be read as a plain JSON object', () => {
    const reading = readExternalArtefact(
      bytes({
        '@context': [VC_CONTEXT],
        id: 'data:application/vc+jwt,not-a-jwt',
        type: 'EnvelopedVerifiableCredential',
      }),
      undefined,
    );

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.content.kind).toBe(ExternalContentKind.JSON_OBJECT);
  });

  it('classifies a type array as a plain JSON object, because the decoder wants the exact string', () => {
    const reading = readExternalArtefact(
      bytes({
        '@context': [VC_CONTEXT],
        id: `data:application/vc+jwt,${compactJwt(dppPayload())}`,
        type: ['EnvelopedVerifiableCredential'],
      }),
      undefined,
    );

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.content.kind).toBe(ExternalContentKind.JSON_OBJECT);
  });

  it('classifies bytes that are not JSON at all as opaque', () => {
    const reading = readExternalArtefact(bytes('not json at all'), undefined);

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.content).toEqual({ kind: ExternalContentKind.OPAQUE, bytes: bytes('not json at all') });
  });

  it('classifies a JSON array as opaque', () => {
    const reading = readExternalArtefact(bytes([1, 2, 3]), undefined);

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.content).toEqual({ kind: ExternalContentKind.OPAQUE, bytes: bytes('[1,2,3]') });
  });

  it('classifies JSON null as opaque', () => {
    const reading = readExternalArtefact(bytes('null'), undefined);

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.content).toEqual({ kind: ExternalContentKind.OPAQUE, bytes: bytes('null') });
  });
});

describe('readExternalArtefact byte fidelity', () => {
  /** The bytes of `value` with a UTF-8 byte-order mark in front of them. */
  function withBom(value: string): Uint8Array {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(value, 'utf8')]);
  }

  it('keeps the byte-order mark on an unopened envelope, which decoding to text would strip', () => {
    // The decoder drops a leading BOM, so a reading that carried text would
    // hand storage a body three bytes shorter than the one fetched. Fails if
    // the outcome goes back to carrying decoded text.
    const raw = JSON.stringify(encryptedEnvelope(JSON.stringify(enveloped(dppPayload()))));
    const fetched = withBom(raw);

    const reading = readExternalArtefact(fetched, undefined);

    expect(reading).toEqual({ outcome: 'encrypted-no-key', bytes: fetched });
    expect(Buffer.from(reading.outcome === 'encrypted-no-key' ? reading.bytes : new Uint8Array()).equals(fetched)).toBe(
      true,
    );
  });

  it('keeps the byte-order mark on an opaque body', () => {
    // Same loss, on the outcome that stores the body verbatim. Fails if
    // classify is handed decoded text again.
    const fetched = withBom('not json at all');

    const reading = readExternalArtefact(fetched, undefined);

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.content).toEqual({ kind: ExternalContentKind.OPAQUE, bytes: fetched });
  });

  it('keeps an invalid UTF-8 sequence in an opaque body rather than replacing it', () => {
    // A lone 0x80 continuation byte decodes to U+FFFD, which encodes back as
    // three different bytes. Fails if the stored copy is a re-encoding of
    // decoded text rather than the bytes as fetched.
    const fetched = Buffer.concat([Buffer.from('binary '), Buffer.from([0x80, 0xff, 0xfe]), Buffer.from(' tail')]);

    const reading = readExternalArtefact(fetched, undefined);

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.content.kind).toBe(ExternalContentKind.OPAQUE);
    expect(Buffer.from(reading.content.bytes).equals(fetched)).toBe(true);
  });

  it('keeps an invalid UTF-8 sequence carried inside an unopened envelope', () => {
    // The envelope still parses, because the bad bytes sit inside a string
    // value, so this reaches the unopened outcome with bytes no decoder
    // round-trip could reproduce.
    const raw = JSON.stringify({ ...encryptedEnvelope(JSON.stringify(enveloped(dppPayload()))), note: 'PLACEHOLDER' });
    const fetched = Buffer.concat([
      Buffer.from(raw.slice(0, raw.indexOf('PLACEHOLDER'))),
      Buffer.from([0x80, 0xff]),
      Buffer.from(raw.slice(raw.indexOf('PLACEHOLDER') + 'PLACEHOLDER'.length)),
    ]);

    const reading = readExternalArtefact(fetched, undefined);

    expect(reading.outcome).toBe('encrypted-no-key');
    if (reading.outcome !== 'encrypted-no-key') return;
    expect(Buffer.from(reading.bytes).equals(fetched)).toBe(true);
  });
});

describe('captureExternalDetails', () => {
  const decoded = (payload: Record<string, unknown>) => payload as unknown as UNTPVerifiableCredential;

  it('extracts the descriptive fields, the core kind and the version the @context names', () => {
    const result = captureExternalDetails(decoded(dppPayload()));

    expect(result.reason).toBeUndefined();
    expect(result.capture).toEqual({
      status: CredentialDetailsStatus.EXTRACTED,
      fields: {
        name: 'Wool Passport',
        issuerName: 'Example Issuer',
        issuerDid: 'did:web:issuer.example',
        subjectName: 'Merino batch',
        subjectId: 'https://example.com/product/1',
        validFrom: new Date('2024-01-15T00:00:00.000Z'),
        validUntil: new Date('2025-01-15T00:00:00.000Z'),
      },
      credentialType: 'DigitalProductPassport',
      coreCredentialType: CoreCredentialType.DPP,
      coreDataModelVersion: '0.6.1',
    });
  });

  it('records an extension type as the asserted type, keeping the core kind', () => {
    const result = captureExternalDetails(
      decoded(dppPayload({ type: ['VerifiableCredential', 'DigitalProductPassport', 'AustralianWoolPassport'] })),
    );

    expect(result.capture.status).toBe(CredentialDetailsStatus.EXTRACTED);
    expect(result.capture.credentialType).toBe('AustralianWoolPassport');
    expect(result.capture.coreCredentialType).toBe(CoreCredentialType.DPP);
  });

  it('fails with a bridge error when the type set names no core credential type', () => {
    const result = captureExternalDetails(decoded(dppPayload({ type: ['VerifiableCredential', 'SomethingElse'] })));

    expect(result.capture).toEqual({
      status: CredentialDetailsStatus.EXTRACTION_FAILED,
      error: CredentialDetailsError.BRIDGE_ERROR,
    });
    expect(result.reason).toBe("The credential's type names no core credential type, so no bridge can be chosen");
  });

  it('fails with a bridge error when the type set names two core credential types', () => {
    const result = captureExternalDetails(
      decoded(dppPayload({ type: ['VerifiableCredential', 'DigitalProductPassport', 'DigitalConformityCredential'] })),
    );

    expect(result.capture).toEqual({
      status: CredentialDetailsStatus.EXTRACTION_FAILED,
      error: CredentialDetailsError.BRIDGE_ERROR,
    });
    expect(result.reason).toBe(
      "The credential's type names more than one core credential type, so no bridge can be chosen",
    );
  });

  it('fails when no registered bridge version matches the @context', () => {
    const result = captureExternalDetails(
      decoded(dppPayload({ '@context': [VC_CONTEXT, 'https://example.com/untp/dpp/9.9.9/'] })),
    );

    expect(result.capture.status).toBe(CredentialDetailsStatus.EXTRACTION_FAILED);
    expect(result.capture.error).toBe(CredentialDetailsError.BRIDGE_ERROR);
    expect(result.reason).toBe(
      'No registered bridge version for DigitalProductPassport matched the credential @context',
    );
  });

  it('fails when the @context names two registered versions', () => {
    const result = captureExternalDetails(decoded(dppPayload({ '@context': [DPP_060_CONTEXT, DPP_061_CONTEXT] })));

    expect(result.capture.status).toBe(CredentialDetailsStatus.EXTRACTION_FAILED);
    expect(result.capture.error).toBe(CredentialDetailsError.BRIDGE_ERROR);
    expect(result.reason).toBe('Ambiguous bridge version for DigitalProductPassport from @context: 0.6.0, 0.6.1');
  });

  it('fails when the version the @context named has no bridge in the registry', () => {
    // The registry and the version table can disagree: a version the table
    // lists but the registry never registered must fail, not extract nothing.
    // Fails if that lookup's result stops being checked.
    getBridgeOverride = () => undefined;

    const result = captureExternalDetails(decoded(dppPayload()));

    expect(result.capture).toEqual({
      status: CredentialDetailsStatus.EXTRACTION_FAILED,
      error: CredentialDetailsError.BRIDGE_ERROR,
    });
    expect(result.reason).toBe('No bridge registered for DigitalProductPassport v0.6.1');
  });

  it("fails with the bridge's own message when it throws while reading the subject", () => {
    // A bridge that throws on an unexpected subject shape is a capture
    // failure, not a register failure. Fails if the try around the extraction
    // is removed and the throw escapes to the caller.
    extractOverride = () => {
      throw new Error('credentialSubject.product is not an object');
    };

    const result = captureExternalDetails(decoded(dppPayload()));

    expect(result.capture).toEqual({
      status: CredentialDetailsStatus.EXTRACTION_FAILED,
      error: CredentialDetailsError.BRIDGE_ERROR,
    });
    expect(result.reason).toBe('credentialSubject.product is not an object');
  });
});

describe('readExternalArtefact logging', () => {
  it('warns with the cause when the supplied key does not open the envelope', () => {
    // The cause tells a wrong key from a damaged ciphertext. Fails if the
    // catch goes back to swallowing it.
    const raw = JSON.stringify(encryptedEnvelope(JSON.stringify(enveloped(dppPayload()))));

    readExternalArtefact(bytes(raw), OTHER_KEY);

    // The realm's Error is not the one node's crypto throws, so the cause is
    // matched on the message it carries rather than on its constructor.
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: expect.any(String) }) },
      'The supplied key did not open the fetched envelope',
    );
  });

  it('warns with the cause when a JSON object is not a decodable enveloped credential', () => {
    // Fails if the classify catch goes back to swallowing the reason a body
    // that looks like a credential could not be read as one.
    (decodeJwt as jest.Mock).mockImplementation(() => {
      throw new Error('Invalid Compact JWS');
    });

    const reading = readExternalArtefact(bytes(enveloped(dppPayload())), undefined);

    expect(reading.outcome).toBe('opened');
    if (reading.outcome !== 'opened') return;
    expect(reading.content.kind).toBe(ExternalContentKind.JSON_OBJECT);
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: expect.stringContaining('Invalid Compact JWS') }) },
      'The fetched JSON object is not a decodable enveloped credential',
    );
  });

  it('never writes the supplied key into any log line', () => {
    // The haystack is not empty: this call is the one that warns above.
    const raw = JSON.stringify(encryptedEnvelope(JSON.stringify(enveloped(dppPayload()))));

    readExternalArtefact(bytes(raw), OTHER_KEY);

    const logged = [...loggerCalls.info.mock.calls, ...loggerCalls.warn.mock.calls, ...loggerCalls.error.mock.calls];
    expect(logged.length).toBeGreaterThan(0);
    for (const call of logged) {
      const text = JSON.stringify(call, (_key, value) => (value instanceof Error ? String(value.stack) : value));
      expect(text).not.toContain(OTHER_KEY);
    }
  });
});
