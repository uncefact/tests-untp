import type { MethodVerificationResult } from '../types.js';
import { DidMethodNotSupportedError } from '../errors.js';

/**
 * did:webvh method-specific verification.
 *
 * @todo Implement did:webvh resolution and verification.
 * did:webvh (Verifiable History) extends did:web with verifiable history
 * via a hash-linked log. Resolution requires fetching and validating
 * the DID log in addition to the DID document.
 *
 * @see https://identity.foundation/didwebvh/v1.0/
 * @see https://didwebvh.info/latest/overview/
 */
export async function verifyDidWebVh(_did: string): Promise<MethodVerificationResult> {
  throw new DidMethodNotSupportedError('webvh', 'verification');
}
