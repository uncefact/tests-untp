import * as Digest from 'multiformats/hashes/digest';
import { sha256, sha512 } from 'multiformats/hashes/sha2';
import { base58btc } from 'multiformats/bases/base58';
import { base64 } from 'multiformats/bases/base64';
import type { MultihashHasher, MultihashDigest } from 'multiformats/hashes/interface';
import type { MultibaseCodec } from 'multiformats/bases/interface';

/**
 * Hash algorithms accepted by {@link MultibaseDigest}. Recovered from the
 * multihash prefix on decode, supplied by the caller on encode.
 */
export type HashAlgorithm = 'sha2-256' | 'sha2-512';

/**
 * Multibase encodings accepted by {@link MultibaseDigest}. Recovered from the
 * single-character prefix on a multibase string (`z` for base58btc, `m` for
 * base64), supplied by the caller on encode.
 */
export type MultibaseEncoding = 'base58btc' | 'base64';

/**
 * Algorithm and base selection for the encode-side {@link MultibaseDigest}
 * constructors ({@link MultibaseDigest.fromData}, {@link MultibaseDigest.fromDigest}).
 * Decode-side construction reads both from the input string and takes no options.
 */
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

/**
 * Immutable value object representing a multibase-encoded multihash: a hash
 * digest wrapped with its algorithm code (multihash) and paired with a chosen
 * text encoding (multibase). Instances are only obtainable through the static
 * constructors, which validate inputs against the allow-lists.
 *
 * Two instances are equal when their underlying multihash bytes match. The
 * chosen `base` is presentational and does not affect identity, so the same
 * digest re-encoded under a different base compares equal.
 */
export class MultibaseDigest {
  /** Hash algorithm used to produce {@link digest}. */
  readonly algorithm: HashAlgorithm;
  /** Multibase encoding used by {@link toString} when no override is supplied. */
  readonly base: MultibaseEncoding;
  /** Raw hash bytes (no multihash prefix). Length matches {@link algorithm}. */
  readonly digest: Uint8Array;
  /** Multihash bytes (varint code + varint length + {@link digest}). */
  readonly multihash: Uint8Array;

  private constructor(algorithm: HashAlgorithm, base: MultibaseEncoding, digest: Uint8Array, multihash: Uint8Array) {
    this.algorithm = algorithm;
    this.base = base;
    this.digest = digest;
    this.multihash = multihash;
  }

  /**
   * Hashes `data` with the requested algorithm, wraps it as a multihash, and
   * tags it with the requested multibase encoding for serialisation.
   *
   * @throws If `algorithm` or `base` is not in the allow-list.
   */
  static async fromData(data: Uint8Array, opts: MultibaseDigestOptions): Promise<MultibaseDigest> {
    assertSupportedAlgorithm(opts.algorithm);
    assertSupportedBase(opts.base);
    const hasher = HASHERS[opts.algorithm];
    const mh = await hasher.digest(data);
    return new MultibaseDigest(opts.algorithm, opts.base, mh.digest, mh.bytes);
  }

  /**
   * Wraps an already-computed raw `digest` (the bytes a hash function produces,
   * no multihash prefix) and tags it with the requested multibase encoding. The
   * caller asserts the algorithm; the byte length must match its expected
   * digest size.
   *
   * @throws If `algorithm` or `base` is not in the allow-list, or if `digest.length`
   *   does not match the expected size for `algorithm`.
   */
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

  /**
   * Parses a multibase string into a {@link MultibaseDigest}. The algorithm and
   * multibase encoding are both recovered from the string itself: the leading
   * character names the multibase, and the multihash prefix bytes name the
   * algorithm.
   *
   * Decode and multihash-parse errors are rethrown with `{ cause }` so the
   * underlying multiformats error is preserved for debugging.
   *
   * @throws If `encoded` is empty, the multibase prefix is unknown, the body
   *   cannot be decoded, the multihash bytes are malformed, or the multihash
   *   algorithm code is not in the allow-list.
   */
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

  /**
   * Returns the multibase-encoded multihash as a string. When called without
   * arguments, uses {@link base}; pass a supported encoding to re-encode without
   * rehashing.
   *
   * @throws If `base` is not in the allow-list.
   */
  toString(base?: MultibaseEncoding): string {
    const target = base ?? this.base;
    assertSupportedBase(target);
    return BASES[target].encoder.encode(this.multihash);
  }

  /**
   * Returns `true` when `other` has the same algorithm and identical multihash
   * bytes. The base is presentational and does not participate in equality, so
   * the same digest encoded under different bases compares equal.
   */
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
