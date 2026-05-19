/**
 * Deterministic test stub for `@uncefact/untp-utils/multibase-digest`.
 *
 * Wired via `moduleNameMapper` in `jest.config.mjs`. The real package
 * ships as ESM and imports from `multiformats` via subpath exports, which
 * the RI's Jest CJS resolver cannot unpack without a bigger toolchain
 * change. Production code consumes the real package; only tests see this
 * stub. Round-trip multibase encoding coverage lives in `@uncefact/untp-utils`.
 */

import { Buffer } from 'node:buffer';

type HashAlgorithm = 'sha2-256' | 'sha2-512';
type MultibaseEncoding = 'base58btc' | 'base64';

export class MultibaseDigest {
  constructor(public readonly encoded: string) {}

  static fromDigest(digest: Uint8Array, _opts: { algorithm: HashAlgorithm; base: MultibaseEncoding }): MultibaseDigest {
    return new MultibaseDigest(`zTEST${Buffer.from(digest).toString('hex')}`);
  }

  static async fromData(
    data: Uint8Array,
    _opts: { algorithm: HashAlgorithm; base: MultibaseEncoding },
  ): Promise<MultibaseDigest> {
    return new MultibaseDigest(`zTESTDATA${Buffer.from(data).toString('hex').slice(0, 16)}`);
  }

  static fromString(encoded: string): MultibaseDigest {
    if (typeof encoded !== 'string' || encoded.length < 2 || !/^[zm]/.test(encoded)) {
      throw new Error(`Invalid multibase-encoded multihash: "${encoded}"`);
    }
    return new MultibaseDigest(encoded);
  }

  toString(): string {
    return this.encoded;
  }

  async verify(_data: Uint8Array): Promise<boolean> {
    return true;
  }
}
