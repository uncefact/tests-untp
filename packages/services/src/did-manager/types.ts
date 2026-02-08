/**
 * DID Management Types
 *
 * Types, enums, and interfaces for the three-tier DID onboarding ramp:
 * - DEFAULT: system-wide DID, zero-knowledge entry point
 * - MANAGED: tenant-scoped, created via the RI, hosted by VCKit
 * - SELF_MANAGED: tenant-scoped, keys in VCKit, document self-hosted
 */

/** Service type identifier for DID management. */
export const DID_SERVICE_TYPE = 'DID' as const;

// ── Enums ──────────────────────────────────────────────────────────────────

export enum DidType {
  DEFAULT = 'DEFAULT',
  MANAGED = 'MANAGED',
  SELF_MANAGED = 'SELF_MANAGED',
}

/**
 * DID method identifier.
 * Only DID_WEB is currently supported. DID_WEB_VH is included to prepare
 * for future UNTP compliance where did:webvh is RECOMMENDED for verifiable history.
 */
export enum DidMethod {
  DID_WEB = 'DID_WEB',
  DID_WEB_VH = 'DID_WEB_VH',
}

/** Maps DID URI method strings (e.g. "web", "webvh") to DidMethod enum values. */
export const DID_METHOD_BY_URI: Record<string, DidMethod> = {
  web: DidMethod.DID_WEB,
  webvh: DidMethod.DID_WEB_VH,
};


export enum DidStatus {
  /** DID is active and usable (default for DEFAULT and MANAGED) */
  ACTIVE = 'ACTIVE',
  /** DID has been deactivated */
  INACTIVE = 'INACTIVE',
  /** Self-managed DID document has been verified as accessible and conformant */
  VERIFIED = 'VERIFIED',
  /** Self-managed DID created but not yet verified (initial state for SELF_MANAGED) */
  UNVERIFIED = 'UNVERIFIED',
}

/** DID types that can be created via the API (excludes DEFAULT, which is system-managed). */
export const CREATABLE_DID_TYPES = [DidType.MANAGED, DidType.SELF_MANAGED] as const;


// ── Input / option types ───────────────────────────────────────────────────

export type CreateDidOptions = {
  /** DID type (DEFAULT, MANAGED, SELF_MANAGED) */
  type: DidType;
  /** DID method to use for creation */
  method: DidMethod;
  /** URL-safe identifier used as the path segment in the DID (e.g. "my-org" in did:web:example.com:my-org) */
  alias: string;
  /** Human-readable display name for the DID */
  name?: string;
  /** Optional freeform description */
  description?: string;
};

// ── Creation result ───────────────────────────────────────────────────────

/** Provider-agnostic result returned after creating a DID */
export type DidRecord = {
  did: string;
  keyId: string;
  document: DidDocument;
};

// ── W3C DID Document types ────────────────────────────────────────────────
// Inferred from Zod schemas in schemas.ts (single source of truth).
// Runtime validation via schemas.ts; semantic validation via JSON-LD
// expansion in verify().

import type { z } from 'zod';
import type { verificationMethodSchema, didDocumentSchema } from './schemas.js';

export type VerificationMethod = z.infer<typeof verificationMethodSchema>;
export type DidDocument = z.infer<typeof didDocumentSchema>;

// ── Verification types ─────────────────────────────────────────────────────

export enum DidVerificationCheckName {
  RESOLVE = 'resolve',
  STRUCTURE = 'structure',
  IDENTITY_MATCH = 'identity_match',
  HTTPS = 'https',
  KEY_MATERIAL = 'key_material',
  JSONLD_VALIDITY = 'jsonld_validity',
}

export type DidVerificationCheck = {
  name: DidVerificationCheckName;
  passed: boolean;
  message?: string;
};

export type DidVerificationError = {
  check: DidVerificationCheckName;
  message: string;
};

export type DidVerificationResult = {
  verified: boolean;
  checks: DidVerificationCheck[];
  errors?: DidVerificationError[];
};

/** Result returned by a method-specific verifier (e.g. did:web, did:webvh). */
export type MethodVerificationResult = {
  document: DidDocument | null;
  checks: DidVerificationCheck[];
};

// ── Service interface ──────────────────────────────────────────────────────

export interface IDidService {
  /** Normalise and validate an alias for the given DID method. Throws if invalid. */
  normaliseAlias(alias: string, method: DidMethod): string;
  /** Create a new DID in the provider */
  create(options: CreateDidOptions): Promise<DidRecord>;
  /** Get the full DID Document */
  getDocument(did: string): Promise<DidDocument>;
  /** Verify a DID and its document against a series of checks */
  verify(did: string): Promise<DidVerificationResult>;
  /** DID types this adapter supports */
  getSupportedTypes(): DidType[];
  /** DID methods this adapter supports */
  getSupportedMethods(): DidMethod[];
  /** Key algorithms this adapter supports */
  getSupportedKeyTypes(): string[];
}
