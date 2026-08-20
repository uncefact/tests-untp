import {
  PrivateAddressError,
  PrivateHostnameError,
  UrlValidationError,
  validatePublicUrl,
} from '@uncefact/untp-utils/node';
import {
  resolveJsonDocument,
  ResolverError,
  ResolverHttpError,
  ResolverInvalidJsonError,
} from '@uncefact/untp-utils/resolvers';
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
 * for the rejection classes. The fetch itself goes through
 * `resolveJsonDocument` from `@uncefact/untp-utils/resolvers`, which
 * validates every redirect hop independently and pins each hop's connection
 * to the IP its validation resolved, closing the DNS rebinding window
 * between check and connect across the whole chain. The resolver's defaults
 * bound the resolution (1 MiB body, a 10 s timeout governing the fetch from connect onwards, 3 redirects), and
 * on the wire it sends `Accept: application/json` and a `User-Agent`
 * (default or the RI_HTTP_USER_AGENT override); it adds no
 * request-correlation header, so internal request identifiers stay within
 * the operator's services when contacting the DID's own domain (#654).
 *
 * An HTTP-error response and an unparseable body still receive an HTTPS
 * verdict on the final URL, which those two error classes carry; every
 * other failure (network, timeout, size, redirect caps, including one that
 * strikes mid-body after a response arrived) reports that HTTPS could not
 * be verified, because those error classes carry no final URL to judge.
 *
 * @see https://w3c-ccg.github.io/did-method-web/
 * @see https://www.w3.org/TR/did-1.0/
 */
export async function verifyDidWeb(did: string): Promise<MethodVerificationResult> {
  const checks: DidVerificationCheck[] = [];
  let document: DidDocument | null = null;

  const url = didWebToUrl(did);

  // The pre-fetch guard is what turns a private target into the explicit
  // "not permitted" verification outcome below; resolveJsonDocument would
  // also reject it, but as a generic resolution failure.
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

  // Check 1: Resolve — fetch the DID document over the pinned transport.
  let finalUrl: string | null = null;
  try {
    const result = await resolveJsonDocument(url);
    finalUrl = result.finalUrl;
    document = result.json as DidDocument;
    checks.push({ name: C.RESOLVE, passed: true });
  } catch (error) {
    if (error instanceof ResolverHttpError) {
      checks.push({ name: C.RESOLVE, passed: false, message: `HTTP ${error.status} from ${url}` });
      finalUrl = error.url;
    } else if (error instanceof ResolverInvalidJsonError) {
      checks.push({ name: C.RESOLVE, passed: false, message: `Resolution failed: ${error.message}` });
      finalUrl = error.url;
    } else if (error instanceof PrivateHostnameError || error instanceof PrivateAddressError) {
      // A redirect hop resolved to a private target: the same SSRF outcome
      // as the pre-fetch guard, worded the same way.
      checks.push({
        name: C.RESOLVE,
        passed: false,
        message: 'Private or localhost URLs are not permitted for DID resolution',
      });
    } else if (error instanceof ResolverError || error instanceof UrlValidationError) {
      // ResolverError covers network, timeout, size and redirect-cap
      // failures; UrlValidationError here means a redirect hop was rejected
      // by the guard for a non-private reason. All are properties of the
      // resolved DID, not of this system, so they are verification
      // outcomes. Anything else is a programming error and rethrows.
      checks.push({ name: C.RESOLVE, passed: false, message: `Resolution failed: ${error.message}` });
    } else {
      throw error;
    }
  }

  // Check 2: HTTPS — did:web requires HTTPS by spec.
  // Verify the final response URL (after any redirects) is still HTTPS.
  if (finalUrl) {
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
