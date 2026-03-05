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
});
