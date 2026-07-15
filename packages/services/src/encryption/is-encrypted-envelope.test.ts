import { isEncryptedEnvelope } from './is-encrypted-envelope.js';

describe('isEncryptedEnvelope', () => {
  it('returns true for an object with all required fields', () => {
    expect(isEncryptedEnvelope({ cipherText: 'a', iv: 'b', tag: 'c', type: 'aes-256-gcm' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isEncryptedEnvelope(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isEncryptedEnvelope('hello')).toBe(false);
  });

  it('returns false when cipherText is missing', () => {
    expect(isEncryptedEnvelope({ iv: 'b', tag: 'c', type: 'aes-256-gcm' })).toBe(false);
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
    expect(isEncryptedEnvelope({ cipherText: 1, iv: 'b', tag: 'c', type: 'aes-256-gcm' })).toBe(false);
    expect(isEncryptedEnvelope({ cipherText: 'a', iv: 2, tag: 'c', type: 'aes-256-gcm' })).toBe(false);
    expect(isEncryptedEnvelope({ cipherText: 'a', iv: 'b', tag: 3, type: 'aes-256-gcm' })).toBe(false);
  });

  it('returns false for an unsupported algorithm in type', () => {
    expect(isEncryptedEnvelope({ cipherText: 'a', iv: 'b', tag: 'c', type: 'des-ede3-cbc' })).toBe(false);
  });

  it('returns false when type is not a string', () => {
    expect(isEncryptedEnvelope({ cipherText: 'a', iv: 'b', tag: 'c', type: 123 })).toBe(false);
  });

  it('still returns true for a well-formed envelope with a permitted algorithm', () => {
    expect(isEncryptedEnvelope({ cipherText: 'a', iv: 'b', tag: 'c', type: 'aes-256-gcm' })).toBe(true);
  });
});
