import * as Digest from 'multiformats/hashes/digest';
import { sha256, sha512 } from 'multiformats/hashes/sha2';
import { base58btc } from 'multiformats/bases/base58';
import { base64 } from 'multiformats/bases/base64';
import type { MultihashHasher, MultihashDigest } from 'multiformats/hashes/interface';
import type { MultibaseCodec } from 'multiformats/bases/interface';

export type HashAlgorithm = 'sha2-256' | 'sha2-512';

export type MultibaseEncoding = 'base58btc' | 'base64';

export interface MultibaseDigestOptions {
  algorithm: HashAlgorithm;
  base: MultibaseEncoding;
}

const HASHERS: Record<HashAlgorithm, MultihashHasher<number>> = {
  'sha2-256': sha256,
  'sha2-512': sha512,
};

const HASH_CODE_TO_ALGORITHM: Record<number, HashAlgorithm> = {
  [sha256.code]: 'sha2-256',
  [sha512.code]: 'sha2-512',
};

const DIGEST_LENGTHS: Record<HashAlgorithm, number> = {
  'sha2-256': 32,
  'sha2-512': 64,
};

const BASES: Record<MultibaseEncoding, MultibaseCodec<string>> = {
  base58btc,
  base64,
};

const BASE_PREFIX_TO_ENCODING: Record<string, MultibaseEncoding> = {
  [base58btc.prefix]: 'base58btc',
  [base64.prefix]: 'base64',
};

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function assertSupportedAlgorithm(algorithm: HashAlgorithm): void {
  if (!HASHERS[algorithm]) {
    throw new Error(`Unsupported hash algorithm: "${algorithm}"`);
  }
}

function assertSupportedBase(base: MultibaseEncoding): void {
  if (!BASES[base]) {
    throw new Error(`Unsupported multibase encoding: "${base}"`);
  }
}

export class MultibaseDigest {
  readonly algorithm: HashAlgorithm;
  readonly base: MultibaseEncoding;
  readonly digest: Uint8Array;
  readonly multihash: Uint8Array;

  private constructor(algorithm: HashAlgorithm, base: MultibaseEncoding, digest: Uint8Array, multihash: Uint8Array) {
    this.algorithm = algorithm;
    this.base = base;
    this.digest = digest;
    this.multihash = multihash;
  }

  static async fromData(data: Uint8Array, opts: MultibaseDigestOptions): Promise<MultibaseDigest> {
    assertSupportedAlgorithm(opts.algorithm);
    assertSupportedBase(opts.base);
    const hasher = HASHERS[opts.algorithm];
    const mh = await hasher.digest(data);
    return new MultibaseDigest(opts.algorithm, opts.base, mh.digest, mh.bytes);
  }

  static fromDigest(digest: Uint8Array, opts: MultibaseDigestOptions): MultibaseDigest {
    assertSupportedAlgorithm(opts.algorithm);
    assertSupportedBase(opts.base);
    const expectedLength = DIGEST_LENGTHS[opts.algorithm];
    if (digest.length !== expectedLength) {
      throw new Error(`Digest length ${digest.length} does not match "${opts.algorithm}" (expected ${expectedLength})`);
    }
    const hasher = HASHERS[opts.algorithm];
    const mh = Digest.create(hasher.code, digest);
    return new MultibaseDigest(opts.algorithm, opts.base, mh.digest, mh.bytes);
  }

  static fromString(encoded: string): MultibaseDigest {
    if (typeof encoded !== 'string' || encoded.length === 0) {
      throw new Error('Multibase string must be a non-empty string');
    }
    const prefix = encoded[0];
    const base = BASE_PREFIX_TO_ENCODING[prefix];
    if (!base) {
      throw new Error(`Unsupported multibase prefix: "${prefix}"`);
    }
    const codec = BASES[base];

    let mhBytes: Uint8Array;
    try {
      mhBytes = codec.decoder.decode(encoded);
    } catch (err) {
      throw new Error(`Failed to decode multibase string: ${errorMessage(err)}`, { cause: err });
    }

    let mh: MultihashDigest<number>;
    try {
      mh = Digest.decode(mhBytes);
    } catch (err) {
      throw new Error(`Failed to parse multihash: ${errorMessage(err)}`, { cause: err });
    }

    const algorithm = HASH_CODE_TO_ALGORITHM[mh.code];
    if (!algorithm) {
      throw new Error(`Unsupported multihash algorithm code: 0x${mh.code.toString(16)}`);
    }

    return new MultibaseDigest(algorithm, base, mh.digest, mh.bytes);
  }

  toString(base?: MultibaseEncoding): string {
    const target = base ?? this.base;
    assertSupportedBase(target);
    return BASES[target].encoder.encode(this.multihash);
  }

  equals(other: MultibaseDigest): boolean {
    return this.algorithm === other.algorithm && bytesEqual(this.multihash, other.multihash);
  }

  /**
   * Re-hashes `data` with this digest's own algorithm and compares against the
   * stored digest. Returns `false` only on a genuine digest mismatch; throws if
   * `data` cannot be hashed (e.g. invalid input type). Callers must not wrap
   * this in `.catch(() => false)`, which would mask real failures as mismatches.
   */
  async verify(data: Uint8Array): Promise<boolean> {
    const recomputed = await MultibaseDigest.fromData(data, {
      algorithm: this.algorithm,
      base: this.base,
    });
    return this.equals(recomputed);
  }
}
