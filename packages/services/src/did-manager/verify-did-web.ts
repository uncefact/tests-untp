import type {
  DidDocument,
  DidVerificationCheck,
  MethodVerificationResult,
} from './types.js';
import { DidVerificationCheckName } from './types.js';
import { didWebToUrl } from './utils.js';

const C = DidVerificationCheckName;

/**
 * Blocks resolution of private and localhost URLs to prevent SSRF attacks.
 */
function isPrivateUrl(urlString: string): boolean {
  try {
    const { hostname } = new URL(urlString);
    return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|localhost$|::1$|\[::1\]$)/i.test(hostname);
  } catch {
    return true; // Malformed URLs are blocked
  }
}

/**
 * did:web method-specific verification.
 *
 * Runs two checks:
 *   1. RESOLVE — fetch the DID document from the resolution URL
 *   2. HTTPS   — verify the final response URL (after redirects) is HTTPS
 *
 * @see https://w3c-ccg.github.io/did-method-web/
 * @see https://www.w3.org/TR/did-1.0/
 */
export async function verifyDidWeb(did: string): Promise<MethodVerificationResult> {
  const checks: DidVerificationCheck[] = [];
  let document: DidDocument | null = null;

  const url = didWebToUrl(did);

  if (isPrivateUrl(url)) {
    checks.push({ name: C.RESOLVE, passed: false, message: 'Private or localhost URLs are not permitted for DID resolution' });
    checks.push({ name: C.HTTPS, passed: false, message: 'Could not verify HTTPS (resolution blocked)' });
    return { document, checks };
  }


  // Check 1: Resolve — fetch the DID document
  let response: Response | null = null;
  try {
    response = await fetch(url);

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
