'use client';

import { Buffer } from 'buffer';
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}

export function detectDevice(userAgent: string) {
  const userAgentLowerCase = userAgent.toLowerCase();

  if (/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgentLowerCase)) {
    return 'mobile';
  }

  if (/mac|win/i.test(userAgentLowerCase)) {
    return 'laptop';
  }

  return 'unknown';
}

export function convertBase64ToString(base64: string) {
  return Buffer.from(base64, 'base64').toString('utf8');
}

// ---------------------------------------------------------------------------
// TODO: These utilities hardcode base58btc encoding and sha2-256 hashing
// rather than reading the multibase prefix and multihash header to determine
// the encoding and algorithm dynamically. This is because vckit-renderer
// performs naive string equality on the encoded digest rather than decoding
// the multibase/multihash, so the producer and consumer must agree on a
// single encoding. Once vckit-renderer is updated to properly decode and
// compare multibase/multihash values, these utilities should be refactored
// to support arbitrary encodings and hash algorithms as the specs intend.
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes: Uint8Array): string {
  let n = BigInt(0);
  for (const b of bytes) n = n * BigInt(256) + BigInt(b);
  let result = '';
  while (n > BigInt(0)) {
    const [q, r] = [n / BigInt(58), n % BigInt(58)];
    result = BASE58_ALPHABET[Number(r)] + result;
    n = q;
  }
  for (const b of bytes) {
    if (b === 0) result = '1' + result;
    else break;
  }
  return result;
}

/**
 * Computes a multibase-encoded multihash (sha2-256) digest using Web Crypto.
 * Returns a string in the format expected by vckit-renderer's digestMultibase
 * verification (z-prefixed base58btc of a sha2-256 multihash).
 */
export async function computeDigestMultibase({ content }: { content: string }): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashBytes = new Uint8Array(hashBuffer);
  // Multihash: 0x12 = sha2-256, 0x20 = 32 bytes
  const multihash = new Uint8Array([0x12, 0x20, ...hashBytes]);
  return 'z' + base58Encode(multihash);
}
