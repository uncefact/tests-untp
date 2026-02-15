import type { DidDocument, DidVerificationResult, DidVerificationCheck, MethodVerificationResult } from '../types.js';
import { DidVerificationCheckName } from '../types.js';
import type { JsonLdDocument } from 'jsonld';
import { parseDidMethod } from './utils.js';
import { didDocumentSchema } from '../schemas.js';
import { verifyDidWeb } from './verify-did-web.js';
import { verifyDidWebVh } from './verify-did-webvh.js';
import { DidInputError } from '../errors.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface VerifyDidOptions {
  /** Keys from the DID provider, used for the key_material check. */
  providerKeys: Array<{ kid: string }>;
}

// ── Method verifier registry ────────────────────────────────────────────────

type MethodVerifier = (did: string) => Promise<MethodVerificationResult>;

const methodVerifiers: Record<string, MethodVerifier> = {
  web: verifyDidWeb,
  webvh: verifyDidWebVh,
};

// ── Main verification function ──────────────────────────────────────────────

/**
 * Provider-agnostic DID verification.
 *
 * Dispatches to a method-specific verifier (did:web, did:webvh) for resolution,
 * then runs shared checks against the resolved document:
 *   1. Method-specific — RESOLVE, HTTPS, etc. (delegated)
 *   2. STRUCTURE       — validates against the DID Document Zod schema
 *   3. IDENTITY_MATCH  — `didDocument.id === did`
 *   4. KEY_MATERIAL    — match provider keys against verificationMethod entries
 *   5. JSONLD_VALIDITY — JSON-LD expansion succeeds
 */
export async function verifyDid(did: string, options: VerifyDidOptions): Promise<DidVerificationResult> {
  if (!did) {
    throw new DidInputError('DID string is required for verification');
  }

  const C = DidVerificationCheckName;
  const method = parseDidMethod(did); // Throws for unsupported methods

  // Dispatch to method-specific verifier
  const verifier = methodVerifiers[method];
  let document: DidDocument | null = null;
  const checks: DidVerificationCheck[] = [];

  const methodResult = await verifier(did);
  document = methodResult.document;
  checks.push(...methodResult.checks);

  // Shared check: Structure — validate against the DID Document schema
  if (document) {
    const parsed = didDocumentSchema.safeParse(document);
    checks.push({
      name: C.STRUCTURE,
      passed: parsed.success,
      message: parsed.success ? undefined : parsed.error.issues.map((i) => i.message).join('; '),
    });
  } else {
    checks.push({ name: C.STRUCTURE, passed: false, message: 'No document to validate' });
  }

  // Shared check: Identity match — does didDocument.id match the DID string?
  if (document) {
    const matches = document.id === did;
    checks.push({
      name: C.IDENTITY_MATCH,
      passed: matches,
      message: matches ? undefined : `Document id "${document.id}" does not match DID "${did}"`,
    });
  } else {
    checks.push({ name: C.IDENTITY_MATCH, passed: false, message: 'No document to validate' });
  }

  // Shared check: Key material — match provider keys against verificationMethod entries
  if (document) {
    const providerKeys = options.providerKeys;
    const docMethods = document.verificationMethod ?? [];

    let keyFound = false;
    for (const providerKey of providerKeys) {
      const providerKid = providerKey.kid;
      for (const vm of docMethods) {
        const vmKid = vm.id?.split('#')[1];
        if (vm.publicKeyJwk?.kid === providerKid || vmKid === providerKid) {
          keyFound = true;
          break;
        }
      }
      if (keyFound) break;
    }

    checks.push({
      name: C.KEY_MATERIAL,
      passed: keyFound || providerKeys.length === 0,
      message: keyFound
        ? undefined
        : providerKeys.length === 0
          ? 'No provider keys to compare'
          : 'No matching keys found in DID document',
    });
  } else {
    checks.push({ name: C.KEY_MATERIAL, passed: false, message: 'No document to validate' });
  }

  // Shared check: JSON-LD validity — expand and convert to RDF.
  // toRDF with {safe: true} is stricter than expand alone.
  // @see https://opensource.unicc.org/un/unece/uncefact/spec-untp/-/issues/369#issuecomment-2878856840
  // Dynamic import avoids pulling jsonld (and its Node-only deps) into the
  // module graph at parse time, which breaks test environments that lack
  // TextDecoder.
  if (document) {
    try {
      const jsonld = await import('jsonld');
      await jsonld.toRDF(document as JsonLdDocument, { safe: true } as Parameters<typeof jsonld.toRDF>[1]);
      checks.push({ name: C.JSONLD_VALIDITY, passed: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'JSON-LD validation failed';
      checks.push({ name: C.JSONLD_VALIDITY, passed: false, message });
    }
  } else {
    checks.push({ name: C.JSONLD_VALIDITY, passed: false, message: 'No document to validate' });
  }

  const verified = checks.every((c) => c.passed);
  const errors = checks.filter((c) => !c.passed).map((c) => ({ check: c.name, message: c.message ?? 'Check failed' }));

  return {
    verified,
    checks,
    errors: errors.length > 0 ? errors : undefined,
  };
}
