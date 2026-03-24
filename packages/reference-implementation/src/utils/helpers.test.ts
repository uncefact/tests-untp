import { TextEncoder } from 'util';
import { webcrypto } from 'crypto';
import { base58Encode, computeDigestMultibase } from './helpers';

// jsdom doesn't provide TextEncoder or crypto.subtle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.TextEncoder = TextEncoder as any;
Object.defineProperty(global, 'crypto', { value: webcrypto });

describe('base58Encode', () => {
  it('encodes an empty byte array as empty string', () => {
    expect(base58Encode(new Uint8Array([]))).toBe('');
  });

  it('encodes a single zero byte as "1"', () => {
    expect(base58Encode(new Uint8Array([0]))).toBe('1');
  });

  it('encodes leading zero bytes as leading "1"s', () => {
    expect(base58Encode(new Uint8Array([0, 0, 1]))).toBe('112');
  });

  it('encodes known byte sequences correctly', () => {
    // "Hello" in ASCII = [72, 101, 108, 108, 111]
    // Known base58 encoding: 9Ajdvzr
    expect(base58Encode(new Uint8Array([72, 101, 108, 108, 111]))).toBe('9Ajdvzr');
  });

  it('encodes a sha2-256 multihash prefix correctly', () => {
    // Multihash header for sha2-256: [0x12, 0x20] = 0x1220 = 4640 decimal
    const result = base58Encode(new Uint8Array([0x12, 0x20]));
    expect(result).toBe('2P1');
  });
});

describe('computeDigestMultibase', () => {
  it('returns a z-prefixed base58btc string', async () => {
    const result = await computeDigestMultibase({ content: 'hello' });
    expect(result).toMatch(/^z/);
    expect(result.length).toBeGreaterThan(40);
  });

  it('produces consistent results for the same input', async () => {
    const a = await computeDigestMultibase({ content: 'test content' });
    const b = await computeDigestMultibase({ content: 'test content' });
    expect(a).toBe(b);
  });

  it('produces different results for different inputs', async () => {
    const a = await computeDigestMultibase({ content: 'input one' });
    const b = await computeDigestMultibase({ content: 'input two' });
    expect(a).not.toBe(b);
  });

  it('starts with zQm (sha2-256 multihash prefix in base58)', async () => {
    // sha2-256 multihash: 0x12 0x20 = "Qm" in base58
    const result = await computeDigestMultibase({ content: 'anything' });
    expect(result.startsWith('zQm')).toBe(true);
  });

  it('computes correct digest for a known input', async () => {
    const result = await computeDigestMultibase({ content: '' });
    // SHA-256 of empty string, wrapped as multihash, encoded as base58btc with z prefix
    expect(result).toBe('zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n');
  });
});
