/**
 * Pins that the decryption key never appears in the crypto layer's serialised
 * log output. `decryptCredential` builds its own logger from the logging
 * factory (separate from any caller's logger), so the reference
 * implementation's route-level no-key-logging suite cannot see this
 * destination; this suite captures it at the source. Together the two suites
 * cover both destinations a submitted key could leak through.
 */

const capturedLogLines: string[] = [];

jest.mock('../logging/factory.js', () => {
  const actual = jest.requireActual('../logging/factory.js');
  return {
    createLogger: () =>
      actual.createLogger({
        level: 'debug',
        destination: {
          write: (msg: string) => {
            capturedLogLines.push(msg);
          },
        },
      }),
  };
});

import { createCipheriv, randomBytes } from 'node:crypto';
import { decryptCredential } from './decrypt-credential.js';
import { EncryptionAlgorithm } from './encryption.interface.js';

const SENTINEL_KEY = 'deadbeefcafe0042'.repeat(4); // 64 hex chars, distinctive
const WRONG_KEY = 'a'.repeat(64);
const PLAINTEXT = JSON.stringify({ type: 'EnvelopedVerifiableCredential', id: 'urn:uuid:no-key-logging' });

function encryptEnvelope(plaintext: string, hexKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(hexKey, 'hex') as unknown as Uint8Array,
    iv as unknown as Uint8Array,
  );
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()] as unknown as Uint8Array[]);
  return {
    cipherText: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    type: EncryptionAlgorithm.AES_256_GCM,
  };
}

describe('decryptCredential never logs the key', () => {
  beforeEach(() => {
    capturedLogLines.length = 0;
  });

  it('emits debug log lines but none containing the key on successful decryption', () => {
    const result = decryptCredential({ ...encryptEnvelope(PLAINTEXT, SENTINEL_KEY), key: SENTINEL_KEY });
    expect(result).toBe(PLAINTEXT);

    expect(capturedLogLines.length).toBeGreaterThan(0); // the capture actually captured
    expect(capturedLogLines.join('')).not.toContain(SENTINEL_KEY);
  });

  it('does not log either key when decryption fails with a wrong key', () => {
    expect(() => decryptCredential({ ...encryptEnvelope(PLAINTEXT, SENTINEL_KEY), key: WRONG_KEY })).toThrow();

    const output = capturedLogLines.join('');
    expect(output).not.toContain(SENTINEL_KEY);
    expect(output).not.toContain(WRONG_KEY);
  });

  it('the capture would catch a leak (self-check that this suite can fail)', () => {
    const { createLogger } = jest.requireMock('../logging/factory.js');
    createLogger().info({ leakCheck: SENTINEL_KEY }, 'deliberate sentinel write');
    expect(capturedLogLines.join('')).toContain(SENTINEL_KEY);
  });
});
