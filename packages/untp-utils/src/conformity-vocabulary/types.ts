import type { ValidationError, ValidationWarning } from '../validation-outcome.js';
import type { ConformitySchemeErrorCode, ConformityWarningCode } from './codes.js';

/**
 * Types for the UNTP Conformity Vocabulary primitives.
 *
 * Mirrors the v0.7 spec hierarchy: a Conformity Scheme inlines its versioned
 * Profiles, each of which inlines its versioned Criteria. Scheme URIs are
 * stable and not independently versioned; profile and criterion URIs include
 * a version segment per spec.
 *
 * @see https://untp.unece.org/docs/specification/ConformityVocabularyCatalog
 */

/**
 * Reference to the scheme owner. Optional; not all scheme documents carry it.
 */
export interface ConformitySchemeOwner {
  /** Owner URI (typically a website or registered identifier). */
  canonicalId?: string;
  /** Human-readable owner name. */
  name?: string;
}

/**
 * A topic the criterion addresses (e.g. a SKOS concept from the UNTP
 * conformity-topic vocabulary).
 */
export interface ConformityTopic {
  /** Topic URI. */
  canonicalId: string;
  /** Human-readable name, when the topic is inlined as a structured object. */
  name?: string;
  /** Free-text definition, when present. */
  definition?: string;
}

/**
 * A single auditable criterion within a profile.
 *
 * The criterion URI is stable and versioned per spec (e.g.
 * `myscheme.org/criterion/forced-labour/1.0.0`).
 */
export interface ConformityCriterion {
  /** Canonical (versioned) criterion URI. */
  canonicalId: string;
  /** Human-readable criterion name. */
  name: string;
  /** Criterion version string (also encoded in `canonicalId`). */
  version: string;
  /** Lifecycle status, e.g. `active`. */
  status: string;
  description?: string;
  documentation?: string;
  /** Conformity topics this criterion addresses. */
  topics: ConformityTopic[];
  /** Free-form tags attached to the criterion. */
  tags: string[];
}

/**
 * A profile within a scheme. Profile URI is stable and versioned per spec.
 */
export interface ConformityProfile {
  /** Canonical (versioned) profile URI. */
  canonicalId: string;
  name: string;
  /** Profile version string (also encoded in `canonicalId`). */
  version: string;
  /** Lifecycle status, e.g. `active`. */
  status: string;
  description?: string;
  documentation?: string;
  /** Optional ISO-8601 date the profile becomes valid. */
  validFrom?: string;
  /** Criteria inlined within this profile. */
  criteria: ConformityCriterion[];
}

/**
 * A parsed conformity scheme as published by a scheme owner.
 *
 * The scheme URI is stable but not independently versioned. Profiles and
 * criteria inside the scheme carry their own version segments.
 */
export interface ConformityScheme {
  /** Canonical scheme URI (no version segment). */
  canonicalId: string;
  /** URL the scheme document was fetched from (callers pass this in). */
  sourceUrl: string;
  /** CVC specification version that was used to parse this document. */
  specVersion: string;
  /** Human-readable scheme name. */
  name: string;
  description?: string;
  documentation?: string;
  owner?: ConformitySchemeOwner;
  profiles: ConformityProfile[];
}

// ---------------------------------------------------------------------------
// Errors and warnings narrowed to this sub-entry's codes.
// ---------------------------------------------------------------------------

/**
 * Parse errors emitted by {@link parseConformityScheme}. Narrows
 * {@link ValidationError} so the `code` is one of the parser's known codes.
 */
export type ConformitySchemeError = ValidationError & { code: ConformitySchemeErrorCode };

/**
 * Warnings emitted by {@link validateConformityClaim}. Narrows
 * {@link ValidationWarning} so the `code` is one of the validator's known codes.
 */
export type ConformityWarning = ValidationWarning & { code: ConformityWarningCode };

// ---------------------------------------------------------------------------
// Claim validation
// ---------------------------------------------------------------------------

/**
 * A single criterion entry on a credential's conformity claim. The credential
 * issuer asserts conformity to `criterion` and may declare a `conformityTopic`
 * that scopes the claim to one of the topics the criterion publishes.
 */
export interface ConformityClaimCriterion {
  /** Criterion URI the claim references. */
  criterion: string;
  /**
   * Topic URI the claim is scoped to. Optional; when present, the validator
   * checks it against the criterion's published topic set.
   */
  conformityTopic?: string;
}

/**
 * A conformity claim extracted from a Digital Conformity Credential, in the
 * minimal shape the validator needs.
 */
export interface ConformityClaim {
  /** Scheme URI the claim references. */
  scheme: string;
  /** Profile URI the claim references. */
  profile: string;
  /** Criteria the claim addresses. */
  criteria: ConformityClaimCriterion[];
}
