import {
  PrivateAddressError,
  PrivateHostnameError,
  UrlValidationError,
  validatePublicUrl,
} from '@uncefact/untp-utils/node';
import { httpFetch } from '../../http/client.js';
import type { DidDocument, DidVerificationCheck, MethodVerificationResult } from '../types.js';
import { DidVerificationCheckName } from '../types.js';
import { didWebToUrl } from './utils.js';

const C = DidVerificationCheckName;

/**
 * did:web method-specific verification.
 *
 * Runs two checks:
 *   1. RESOLVE — fetch the DID document from the resolution URL
 *   2. HTTPS   — verify the final response URL (after redirects) is HTTPS
 *
 * The resolution URL is validated with the canonical SSRF guard before any
 * request is made; see `validatePublicUrl` in `@uncefact/untp-utils/node`
 * for the rejection classes. The subsequent fetch connects via the hostname
 * rather than the validated IP: a pinned-fetch path that closes the DNS
 * rebinding window already exists in `@uncefact/untp-utils/resolvers`, and
 * this call site does not yet use it.
 *
 * @see https://w3c-ccg.github.io/did-method-web/
 * @see https://www.w3.org/TR/did-1.0/
 */
export async function verifyDidWeb(did: string): Promise<MethodVerificationResult> {
  const checks: DidVerificationCheck[] = [];
  let document: DidDocument | null = null;

  const url = didWebToUrl(did);

  try {
    await validatePublicUrl(url);
  } catch (error) {
    // Only the guard's own error hierarchy is a verification outcome;
    // anything else is a programming error and must surface as one rather
    // than masquerade as a failed check.
    if (!(error instanceof UrlValidationError)) throw error;
    const message =
      error instanceof PrivateHostnameError || error instanceof PrivateAddressError
        ? 'Private or localhost URLs are not permitted for DID resolution'
        : `DID resolution URL rejected: ${error.message}`;
    checks.push({ name: C.RESOLVE, passed: false, message });
    checks.push({ name: C.HTTPS, passed: false, message: 'Could not verify HTTPS (resolution blocked)' });
    return { document, checks };
  }

  // Check 1: Resolve — fetch the DID document
  let response: Response | null = null;
  try {
    // Third-party host (the DID's own domain): no correlation header, so
    // internal request identifiers stay within the operator's services (#654).
    response = await httpFetch(url, { correlate: false });

    if (!response.ok) {
      checks.push({ name: C.RESOLVE, passed: false, message: `HTTP ${response.status} from ${url}` });
    } else {
      document = await response.json();
      checks.push({ name: C.RESOLVE, passed: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    checks.push({ name: C.RESOLVE, passed: false, message: `Resolution failed: ${message}` });
  }

  // Check 2: HTTPS — did:web requires HTTPS by spec.
  // Verify the final response URL (after any redirects) is still HTTPS.
  if (response) {
    const finalUrl = response.url || url;
    const isHttps = finalUrl.startsWith('https://');
    checks.push({
      name: C.HTTPS,
      passed: isHttps,
      message: isHttps ? undefined : `Response served over insecure connection: ${finalUrl}`,
    });
  } else {
    checks.push({ name: C.HTTPS, passed: false, message: 'Could not verify HTTPS (resolution failed)' });
  }

  return { document, checks };
}
