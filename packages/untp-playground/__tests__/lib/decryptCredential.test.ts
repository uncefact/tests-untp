import {
  decryptCredential,
  describeUndecryptableEnvelope,
  isDecryptableEnvelope,
  isWellFormedKey,
} from '@/lib/decryptCredential';
import { createCipheriv, randomBytes, webcrypto } from 'crypto';
import { TextDecoder as NodeTextDecoder } from 'util';

// jsdom ships neither SubtleCrypto nor TextDecoder; Node's are the same APIs browsers provide.
beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  Object.defineProperty(globalThis, 'TextDecoder', { value: NodeTextDecoder, configurable: true });
});

const KEY = 'a'.repeat(64);

/** A real AES-256-GCM envelope, produced exactly as the services adapter produces one. */
function encryptForTest(plaintext: string, keyHex = KEY) {
  return encrypt(plaintext, keyHex);
}

function encrypt(plaintext: string, keyHex = KEY) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    cipherText: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    type: 'aes-256-gcm',
  };
}

describe('isWellFormedKey', () => {
  it.each([
    ['64 hex chars', KEY, true],
    ['uppercase hex', 'A'.repeat(64), true],
    ['padded with whitespace', `  ${KEY}  `, true],
    ['too short', 'a'.repeat(63), false],
    ['too long', 'a'.repeat(65), false],
    ['non-hex characters', 'g'.repeat(64), false],
    ['empty', '', false],
  ])('%s -> %s', (_name, key, expected) => {
    expect(isWellFormedKey(key)).toBe(expected);
  });
});

describe('decryptCredential', () => {
  it('round-trips a JSON credential with the right key', async () => {
    const credential = { type: ['VerifiableCredential', 'DigitalProductPassport'], id: 'urn:1' };
    const result = await decryptCredential(encrypt(JSON.stringify(credential)), KEY);
    expect(result).toEqual({ ok: true, credential });
  });

  it('decodes a compact JWS plaintext into its payload', async () => {
    const b64u = (value: string) => Buffer.from(value).toString('base64url');
    const jwt = `${b64u('{"alg":"none"}')}.${b64u('{"vc":7}')}.`;
    const result = await decryptCredential(encrypt(jwt), KEY);
    expect(result).toEqual({ ok: true, credential: { vc: 7 } });
  });

  it('fails with the wrong key', async () => {
    expect(await decryptCredential(encrypt('{"a":1}'), 'b'.repeat(64))).toEqual({
      ok: false,
      reason: 'decrypt-failed',
    });
  });

  it('fails without throwing on a malformed key', async () => {
    expect(await decryptCredential(encrypt('{"a":1}'), 'not a key')).toEqual({ ok: false, reason: 'malformed-key' });
  });

  it('fails on a tampered ciphertext (auth tag mismatch)', async () => {
    const envelope = encrypt('{"a":1}');
    const corrupted = { ...envelope, cipherText: envelope.cipherText.slice(0, -4) + 'AAAA' };
    expect(await decryptCredential(corrupted, KEY)).toEqual({ ok: false, reason: 'decrypt-failed' });
  });

  it('fails when the decrypted plaintext is neither JSON nor a JWT', async () => {
    expect(await decryptCredential(encrypt('just some prose'), KEY)).toEqual({ ok: false, reason: 'decrypt-failed' });
  });

  it('fails on garbage base64 fields without throwing', async () => {
    expect(await decryptCredential({ cipherText: '!!!', iv: '**', tag: '~~', type: 'aes-256-gcm' }, KEY)).toEqual({
      ok: false,
      reason: 'unsupported-envelope',
    });
  });
});

describe('key handling contract (#813 review findings)', () => {
  it('imports the key as non-extractable', async () => {
    const importSpy = jest.spyOn(crypto.subtle, 'importKey');
    await decryptCredential(encrypt('{"a":1}'), KEY);
    expect(importSpy).toHaveBeenCalledWith('raw', expect.anything(), 'AES-GCM', false, ['decrypt']);
    importSpy.mockRestore();
  });
});

describe('isDecryptableEnvelope and unsupported forms (#813 panel findings)', () => {
  it.each([
    ['canonical envelope', encryptForTest('{"a":1}'), true],
    ['non-canonical algorithm label', { ...encryptForTest('{"a":1}'), type: 'aes-128-gcm' }, false],
    ['wrong IV length', { ...encryptForTest('{"a":1}'), iv: Buffer.from('short').toString('base64') }, false],
    ['wrong tag length', { ...encryptForTest('{"a":1}'), tag: Buffer.from('too-short').toString('base64') }, false],
    ['JWE JSON shape', { protected: 'x', ciphertext: 'abc' } as any, false],
  ])('%s -> decryptable %s', (_name, envelope, expected) => {
    expect(isDecryptableEnvelope(envelope as any)).toBe(expected);
  });

  it('reports an unsupported envelope with its own reason before any crypto runs', async () => {
    const result = await decryptCredential({ ...encryptForTest('{"a":1}'), type: 'AES-128' }, KEY);
    expect(result).toEqual({ ok: false, reason: 'unsupported-envelope' });
  });
});

describe('describeUndecryptableEnvelope', () => {
  it.each([
    ['a compact JWE string', 'aaa.bbb.ccc.ddd.eee', 'JWE'],
    ['a JSON JWE', { protected: 'x', ciphertext: 'abc' }, 'JWE'],
    ['a declared AES variant', { type: 'AES-128', cipherText: 'x' }, '"AES-128"'],
    ['a malformed canonical envelope', { type: 'aes-256-gcm', cipherText: 'A=' }, 'a malformed aes-256-gcm envelope'],
    ['a very long declared type is capped', { type: 'x'.repeat(120) }, `"${'x'.repeat(40)}"`],
    ['no method at all', { cipherText: 'x' }, 'an unrecognised method'],
    ['null', null, 'an unrecognised method'],
  ])('%s -> %s', (_name, value, expected) => {
    expect(describeUndecryptableEnvelope(value)).toBe(expected);
  });
});
