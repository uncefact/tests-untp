/**
 * Full-payload deterministic stub for `@uncefact/untp-utils/multibase-digest`,
 * wired via `moduleNameMapper` in `jest.integration.config.mjs`.
 *
 * The real package ships as ESM through `multiformats` subpath exports the
 * RI's Jest resolver cannot unpack (same constraint as the unit stub). The
 * unit stub is unusable here for a different reason: it digests only the
 * first 8 payload bytes, so two JSON-LD documents sharing an opening
 * collide and re-ingest takes the `unchanged` path, false-passing the
 * convergence suites. This stub hashes the full payload with sha-256, so
 * changed-versus-unchanged detection carries the same information as the
 * real digest. Multibase encoding correctness lives in `@uncefact/untp-utils`.
 */

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

type HashAlgorithm = 'sha2-256' | 'sha2-512';
type MultibaseEncoding = 'base58btc' | 'base64';

export class MultibaseDigest {
  constructor(public readonly encoded: string) {}

  static fromDigest(digest: Uint8Array, _opts: { algorithm: HashAlgorithm; base: MultibaseEncoding }): MultibaseDigest {
    return new MultibaseDigest(`zINTEG${Buffer.from(digest).toString('hex')}`);
  }

  static fromHex(hex: string, opts: { algorithm: HashAlgorithm; base: MultibaseEncoding }): MultibaseDigest {
    if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || !/^[a-fA-F0-9]+$/.test(hex)) {
      throw new Error(`Invalid hex digest: "${hex}"`);
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return MultibaseDigest.fromDigest(bytes, opts);
  }

  static async fromData(
    data: Uint8Array,
    _opts: { algorithm: HashAlgorithm; base: MultibaseEncoding },
  ): Promise<MultibaseDigest> {
    return new MultibaseDigest(`zINTEG${createHash('sha256').update(data).digest('hex')}`);
  }

  static async fromText(
    text: string,
    opts: { algorithm: HashAlgorithm; base: MultibaseEncoding },
  ): Promise<MultibaseDigest> {
    return MultibaseDigest.fromData(new TextEncoder().encode(text), opts);
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

  async verify(data: Uint8Array): Promise<boolean> {
    return this.encoded === `zINTEG${createHash('sha256').update(data).digest('hex')}`;
  }
}
