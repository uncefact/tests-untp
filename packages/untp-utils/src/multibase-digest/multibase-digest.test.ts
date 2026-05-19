import { base58btc } from 'multiformats/bases/base58';
import { MultibaseDigest, type HashAlgorithm, type MultibaseEncoding } from './multibase-digest.js';

const encoder = new TextEncoder();
const helloBytes = encoder.encode('hello');
const worldBytes = encoder.encode('world');

const SHA256_HELLO_HEX = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const SHA256_EMPTY_HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('MultibaseDigest', () => {
  describe('fromData', () => {
    it('produces the expected SHA-256 digest of "hello"', async () => {
      const digest = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      expect(digest.algorithm).toBe('sha2-256');
      expect(digest.base).toBe('base58btc');
      expect(digest.digest).toHaveLength(32);
      expect(toHex(digest.digest)).toBe(SHA256_HELLO_HEX);
    });

    it('produces the expected SHA-256 digest of empty input', async () => {
      const digest = await MultibaseDigest.fromData(new Uint8Array(0), {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      expect(toHex(digest.digest)).toBe(SHA256_EMPTY_HEX);
    });

    it('encodes as base58btc with a leading "z"', async () => {
      const digest = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      expect(digest.toString().startsWith('z')).toBe(true);
    });

    it('encodes as base64 with a leading "m"', async () => {
      const digest = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base64',
      });
      expect(digest.toString().startsWith('m')).toBe(true);
    });

    it('produces sha2-512 digests of length 64', async () => {
      const digest = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-512',
        base: 'base58btc',
      });
      expect(digest.algorithm).toBe('sha2-512');
      expect(digest.digest).toHaveLength(64);
    });

    it('rejects unsupported algorithms', async () => {
      await expect(
        MultibaseDigest.fromData(helloBytes, {
          algorithm: 'md5' as unknown as 'sha2-256',
          base: 'base58btc',
        }),
      ).rejects.toThrow('Unsupported hash algorithm');
    });

    it('rejects unsupported bases', async () => {
      await expect(
        MultibaseDigest.fromData(helloBytes, {
          algorithm: 'sha2-256',
          base: 'base16' as unknown as MultibaseEncoding,
        }),
      ).rejects.toThrow('Unsupported multibase encoding');
    });
  });

  describe('fromDigest', () => {
    it('wraps a precomputed digest without rehashing', async () => {
      const hashed = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      const wrapped = MultibaseDigest.fromDigest(hashed.digest, {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      expect(wrapped.toString()).toBe(hashed.toString());
      expect(wrapped.equals(hashed)).toBe(true);
    });

    it('rejects unsupported algorithms', () => {
      expect(() =>
        MultibaseDigest.fromDigest(new Uint8Array(32), {
          algorithm: 'md5' as unknown as 'sha2-256',
          base: 'base58btc',
        }),
      ).toThrow('Unsupported hash algorithm');
    });

    it('rejects unsupported bases', () => {
      expect(() =>
        MultibaseDigest.fromDigest(new Uint8Array(32), {
          algorithm: 'sha2-256',
          base: 'base16' as unknown as MultibaseEncoding,
        }),
      ).toThrow('Unsupported multibase encoding');
    });

    it('rejects a digest whose length does not match the algorithm', () => {
      // sha2-256 expects 32 bytes; a 16-byte digest is invalid.
      expect(() =>
        MultibaseDigest.fromDigest(new Uint8Array(16), {
          algorithm: 'sha2-256',
          base: 'base58btc',
        }),
      ).toThrow('Digest length 16 does not match "sha2-256" (expected 32)');

      // sha2-512 expects 64 bytes; a 32-byte digest is invalid.
      expect(() =>
        MultibaseDigest.fromDigest(new Uint8Array(32), {
          algorithm: 'sha2-512',
          base: 'base58btc',
        }),
      ).toThrow('Digest length 32 does not match "sha2-512" (expected 64)');
    });
  });

  describe('fromText', () => {
    it('matches fromData with TextEncoder-encoded bytes', async () => {
      const text = 'hello world';
      const viaText = await MultibaseDigest.fromText(text, { algorithm: 'sha2-256', base: 'base58btc' });
      const viaData = await MultibaseDigest.fromData(new TextEncoder().encode(text), {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      expect(viaText.toString()).toBe(viaData.toString());
    });

    it('rejects unsupported algorithms', async () => {
      await expect(
        MultibaseDigest.fromText('x', { algorithm: 'md5' as unknown as 'sha2-256', base: 'base58btc' }),
      ).rejects.toThrow('Unsupported hash algorithm');
    });
  });

  describe('fromHex', () => {
    it('decodes a sha2-256 hex digest and round-trips through fromDigest', async () => {
      const hashed = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      const hex = Array.from(hashed.digest)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const wrapped = MultibaseDigest.fromHex(hex, { algorithm: 'sha2-256', base: 'base58btc' });
      expect(wrapped.toString()).toBe(hashed.toString());
    });

    it('accepts uppercase hex', () => {
      const hex = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
      const result = MultibaseDigest.fromHex(hex, { algorithm: 'sha2-256', base: 'base58btc' });
      expect(result.algorithm).toBe('sha2-256');
      expect(result.toString()).toMatch(/^z/);
    });

    it('rejects an empty string', () => {
      expect(() => MultibaseDigest.fromHex('', { algorithm: 'sha2-256', base: 'base58btc' })).toThrow(
        'Hex digest must be a non-empty string',
      );
    });

    it('rejects odd-length input', () => {
      expect(() => MultibaseDigest.fromHex('abc', { algorithm: 'sha2-256', base: 'base58btc' })).toThrow(
        'Hex digest must have an even number of characters',
      );
    });

    it('rejects non-hex characters', () => {
      expect(() => MultibaseDigest.fromHex('xx'.repeat(32), { algorithm: 'sha2-256', base: 'base58btc' })).toThrow(
        'Hex digest contains non-hex characters',
      );
    });

    it('rejects hex that decodes to the wrong byte length for the algorithm', () => {
      // 16 bytes (32 hex chars) is too short for sha2-256 (32 bytes).
      expect(() => MultibaseDigest.fromHex('ab'.repeat(16), { algorithm: 'sha2-256', base: 'base58btc' })).toThrow(
        'Digest length 16 does not match "sha2-256" (expected 32)',
      );
    });
  });

  describe('fromString', () => {
    const supportedBases: MultibaseEncoding[] = ['base58btc', 'base64'];
    const algorithms: HashAlgorithm[] = ['sha2-256', 'sha2-512'];

    it.each(supportedBases.flatMap((b) => algorithms.map((a) => [a, b] as const)))(
      'round-trips %s through %s',
      async (algorithm, base) => {
        const original = await MultibaseDigest.fromData(helloBytes, { algorithm, base });
        const encoded = original.toString();
        const parsed = MultibaseDigest.fromString(encoded);

        expect(parsed.algorithm).toBe(algorithm);
        expect(parsed.base).toBe(base);
        expect(parsed.equals(original)).toBe(true);
        expect(parsed.toString()).toBe(encoded);
      },
    );

    it('throws on an empty string', () => {
      expect(() => MultibaseDigest.fromString('')).toThrow('non-empty');
    });

    it('throws on an unknown multibase prefix', () => {
      // 'f' is the base16 prefix, which is not in our allow-list.
      expect(() => MultibaseDigest.fromString('f1220')).toThrow('Unsupported multibase prefix');
    });

    it('throws with a decode error when the base58btc body contains non-alphabet characters', () => {
      // 'z' selects base58btc; '0', 'O', 'I', 'l' are explicitly outside its alphabet.
      expect(() => MultibaseDigest.fromString('z0OIl')).toThrow('Failed to decode multibase string');
    });

    it('throws on an unsupported multihash algorithm code', () => {
      // sha1 = code 0x11, digest length 20. We don't support sha1.
      const sha1Like = new Uint8Array(22);
      sha1Like[0] = 0x11;
      sha1Like[1] = 0x14;
      const encoded = base58btc.encoder.encode(sha1Like);
      expect(() => MultibaseDigest.fromString(encoded)).toThrow('Unsupported multihash algorithm code');
    });

    it('throws on malformed multihash bytes', () => {
      // Claims sha2-256 (code 0x12) with 32-byte digest length (0x20) but has no data bytes.
      const truncated = new Uint8Array([0x12, 0x20]);
      const encoded = base58btc.encoder.encode(truncated);
      expect(() => MultibaseDigest.fromString(encoded)).toThrow();
    });
  });

  describe('toString', () => {
    it('re-encodes in a different base without rehashing', async () => {
      const digest = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base64',
      });
      const b58 = digest.toString('base58btc');
      expect(b58.startsWith('z')).toBe(true);

      const reparsed = MultibaseDigest.fromString(b58);
      expect(reparsed.equals(digest)).toBe(true);
    });

    it('rejects unsupported base requests', async () => {
      const digest = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      expect(() => digest.toString('base16' as unknown as MultibaseEncoding)).toThrow('Unsupported multibase encoding');
    });
  });

  describe('equals', () => {
    it('treats the same digest encoded in different bases as equal', async () => {
      const a = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base64',
      });
      const b = MultibaseDigest.fromString(a.toString('base58btc'));
      expect(a.equals(b)).toBe(true);
    });

    it('returns false for different data', async () => {
      const a = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      const b = await MultibaseDigest.fromData(worldBytes, {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      expect(a.equals(b)).toBe(false);
    });

    it('returns false for a single-byte difference at the same length', () => {
      const base = new Uint8Array(32);
      const variant = new Uint8Array(32);
      variant[7] = 0x01;
      const a = MultibaseDigest.fromDigest(base, { algorithm: 'sha2-256', base: 'base58btc' });
      const b = MultibaseDigest.fromDigest(variant, { algorithm: 'sha2-256', base: 'base58btc' });
      expect(a.equals(b)).toBe(false);
    });

    it('returns false for different algorithms over the same data', async () => {
      const a = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      const b = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-512',
        base: 'base58btc',
      });
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('verify', () => {
    it('returns true for matching data', async () => {
      const digest = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      expect(await digest.verify(helloBytes)).toBe(true);
    });

    it('returns false for non-matching data', async () => {
      const digest = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-256',
        base: 'base58btc',
      });
      expect(await digest.verify(worldBytes)).toBe(false);
    });

    it("uses the digest's own algorithm, not the caller's", async () => {
      const digest512 = await MultibaseDigest.fromData(helloBytes, {
        algorithm: 'sha2-512',
        base: 'base58btc',
      });
      // verify() must re-hash with sha2-512, not assume sha2-256.
      expect(await digest512.verify(helloBytes)).toBe(true);
    });
  });
});
