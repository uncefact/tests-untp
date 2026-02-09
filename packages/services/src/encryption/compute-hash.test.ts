import crypto from 'crypto';
import { computeHash, HashAlgorithm } from './compute-hash';

describe('computeHash', () => {
  const credential = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential'],
    issuer: 'did:web:example.com',
    credentialSubject: {
      id: 'did:web:subject.example.com',
      name: 'Test Subject',
    },
  };

  it('should produce a valid SHA256 hex hash for a credential object', () => {
    const hash = computeHash(credential);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should produce different hashes for different objects', () => {
    const otherObject = { foo: 'bar', baz: 42 };
    const hashA = computeHash(credential);
    const hashB = computeHash(otherObject);
    expect(hashA).not.toEqual(hashB);
  });

  it('should produce the same hash for the same object', () => {
    const hashA = computeHash(credential);
    const hashB = computeHash(credential);
    expect(hashA).toEqual(hashB);
  });

  it('should default to SHA256 and match a manual crypto.createHash result', () => {
    const expected = crypto.createHash('sha256').update(JSON.stringify(credential)).digest('hex');
    const hash = computeHash(credential);
    expect(hash).toEqual(expected);
  });

  it('should hash a plain string input', () => {
    const input = 'hello world';
    const expected = crypto.createHash('sha256').update(input).digest('hex');
    const hash = computeHash(input);
    expect(hash).toEqual(expected);
  });

  it('should hash a Uint8Array input and match the Buffer equivalent', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]);
    const expected = crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    const hash = computeHash(bytes);
    expect(hash).toEqual(expected);
  });
});
