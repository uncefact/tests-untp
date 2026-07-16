import { isEncryptedEnvelope, hasValidEnvelopeStructure } from './is-encrypted-envelope.js';
import { AesGcmEncryptionAdapter } from './adapters/aes-gcm/aes-gcm.adapter.js';
import { EncryptionAlgorithm } from './encryption.interface.js';
import crypto from 'crypto';

const NOOP_LOGGER = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => NOOP_LOGGER };

/** A genuine envelope produced by the real adapter — valid Base64, correct field lengths. */
function realEnvelope() {
  const adapter = new AesGcmEncryptionAdapter('a'.repeat(64), NOOP_LOGGER as never);
  return adapter.encrypt('hello world', EncryptionAlgorithm.AES_256_GCM);
}

describe('isEncryptedEnvelope', () => {
  it('returns true for a genuine envelope produced by the real adapter', () => {
    expect(isEncryptedEnvelope(realEnvelope())).toBe(true);
  });

  it('returns false for null', () => {
    expect(isEncryptedEnvelope(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isEncryptedEnvelope('hello')).toBe(false);
  });

  it('returns false when cipherText is missing', () => {
    expect(isEncryptedEnvelope({ iv: 'YWJjZGVmZ2hpams=', tag: 'YWJjZGVmZ2hpamtsbW5vcA==', type: 'aes-256-gcm' })).toBe(
      false,
    );
  });

  it('returns false for an empty object', () => {
    expect(isEncryptedEnvelope({})).toBe(false);
  });

  it('returns false when all required fields are present but null', () => {
    // Passes a "has these keys" check but is not decryptable data — must
    // be classified as corrupted, not as a genuine envelope, or a
    // downstream decrypt attempt fails with a confusing crypto error
    // (or "Unsupported algorithm: null") instead of a clear corruption
    // signal.
    expect(isEncryptedEnvelope({ cipherText: null, iv: null, tag: null, type: null })).toBe(false);
  });

  it('returns false when a field has the wrong type', () => {
    const envelope = realEnvelope();
    expect(isEncryptedEnvelope({ ...envelope, cipherText: 1 })).toBe(false);
    expect(isEncryptedEnvelope({ ...envelope, iv: 2 })).toBe(false);
    expect(isEncryptedEnvelope({ ...envelope, tag: 3 })).toBe(false);
  });

  it('returns false for an unsupported algorithm in type', () => {
    const envelope = realEnvelope();
    expect(isEncryptedEnvelope({ ...envelope, type: 'des-ede3-cbc' })).toBe(false);
  });

  it('returns false when type is not a string', () => {
    const envelope = realEnvelope();
    expect(isEncryptedEnvelope({ ...envelope, type: 123 })).toBe(false);
  });

  describe('Base64 field validation', () => {
    // Reproduces the reported crash: 'a', 'iv': 'b', 'tag': 'c' each decode
    // leniently to 0 bytes via Node's Buffer.from(str, 'base64') instead of
    // throwing, so a presence-and-type-only check waves them through. That
    // sent a caller into decrypt(), which threw "Invalid initialization
    // vector" at createDecipheriv — a structural error misreported as a
    // DATA_ENCRYPTION_KEY mismatch.
    it('returns false for single-character fields that decode to 0 bytes', () => {
      expect(isEncryptedEnvelope({ cipherText: 'a', iv: 'b', tag: 'c', type: 'aes-256-gcm' })).toBe(false);
    });

    it('returns false for an empty string field', () => {
      const envelope = realEnvelope();
      expect(isEncryptedEnvelope({ ...envelope, cipherText: '' })).toBe(false);
      expect(isEncryptedEnvelope({ ...envelope, iv: '' })).toBe(false);
      expect(isEncryptedEnvelope({ ...envelope, tag: '' })).toBe(false);
    });

    it('returns false for a field containing non-Base64 characters', () => {
      const envelope = realEnvelope();
      expect(isEncryptedEnvelope({ ...envelope, cipherText: 'not base64!!' })).toBe(false);
      expect(isEncryptedEnvelope({ ...envelope, iv: 'not base64!!' })).toBe(false);
      expect(isEncryptedEnvelope({ ...envelope, tag: 'not base64!!' })).toBe(false);
    });

    it('returns false for a field whose length is mathematically impossible for Base64 (length % 4 === 1)', () => {
      const envelope = realEnvelope();
      // Five well-formed Base64 characters is not a length any Base64
      // encoder can produce (each 4-character group encodes 3 bytes; a
      // trailing group can only be 2, 3, or 4 characters, never 1).
      expect(isEncryptedEnvelope({ ...envelope, cipherText: 'AAAAA' })).toBe(false);
    });
  });
});

describe('hasValidEnvelopeStructure', () => {
  it('returns true for a genuine envelope produced by the real adapter', () => {
    expect(hasValidEnvelopeStructure(realEnvelope())).toBe(true);
  });

  it('returns false for an IV that is valid Base64 but the wrong decoded length', () => {
    // Node's AES-GCM does not reject this at construction — a caller that
    // only inspects decrypt()'s thrown error cannot tell this apart from a
    // genuinely wrong key (both throw "Unsupported state or unable to
    // authenticate data" from the same call), so this must be checked
    // structurally, before decrypt is ever attempted.
    const envelope = realEnvelope();
    const wrongLengthIv = crypto.randomBytes(8).toString('base64');
    expect(hasValidEnvelopeStructure({ ...envelope, iv: wrongLengthIv })).toBe(false);
  });

  it('returns false for a tag that is valid Base64 but the wrong decoded length', () => {
    const envelope = realEnvelope();
    const wrongLengthTag = crypto.randomBytes(8).toString('base64');
    expect(hasValidEnvelopeStructure({ ...envelope, tag: wrongLengthTag })).toBe(false);
  });

  it('returns false for an IV one byte short of the required length', () => {
    const envelope = realEnvelope();
    const almostRightIv = crypto.randomBytes(11).toString('base64');
    expect(hasValidEnvelopeStructure({ ...envelope, iv: almostRightIv })).toBe(false);
  });

  it('returns false for a tag one byte longer than the required length', () => {
    const envelope = realEnvelope();
    const almostRightTag = crypto.randomBytes(17).toString('base64');
    expect(hasValidEnvelopeStructure({ ...envelope, tag: almostRightTag })).toBe(false);
  });
});
