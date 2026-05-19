'use client';

import { Buffer } from 'buffer';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
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

/**
 * Computes a multibase-encoded multihash (sha2-256, base58btc) digest of the
 * input content. Returns a `z`-prefixed base58btc-encoded multihash, the
 * format expected by vckit-renderer's digestMultibase verification. Delegates
 * to `MultibaseDigest` from `@uncefact/untp-utils` so the encoding stays in
 * lock-step with how the rest of the codebase produces digests.
 */
export async function computeDigestMultibase({ content }: { content: string }): Promise<string> {
  const digest = await MultibaseDigest.fromText(content, { algorithm: 'sha2-256', base: 'base58btc' });
  return digest.toString();
}
