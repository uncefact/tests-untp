/**
 * Deterministic test stub for `@uncefact/untp-utils/multibase-digest`.
 *
 * Wired up via `moduleNameMapper` in `jest.config.js` because the real
 * package ships as ESM-only and pulls in `multiformats` through subpath
 * exports, neither of which the services package's Jest CJS resolver can
 * handle without a bigger toolchain change. Production code still imports
 * and uses the real package; only tests see this stub.
 *
 * The stub mirrors the API shape (`fromDigest`, `fromString`) and emits a
 * recognisable `z`-prefixed string derived from the input bytes, so
 * assertions can match a known fixture value. `fromString` accepts any
 * `z` / `m` multibase-prefixed input and throws otherwise, mirroring the
 * real library's behaviour for the validation paths the adapter exercises.
 */

import { Buffer } from 'node:buffer';

export class MultibaseDigest {
  constructor(public readonly encoded: string) {}

  static fromDigest(
    digest: Uint8Array,
    _opts: { algorithm: 'sha2-256' | 'sha2-512'; base: 'base58btc' | 'base64' },
  ): MultibaseDigest {
    return new MultibaseDigest(`zTEST${Buffer.from(digest).toString('hex')}`);
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
}
