import type { StructuredWarning } from '../structured-error.js';
import type { ConformityWarningCode } from './codes.js';

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
 *
 * @see https://untp.unece.org/docs/specification/ConformityVocabularyCatalog
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

/**
 * One entry in the UNTP Conformity Vocabulary Catalogue Register. Ingestion
 * consumers route on {@link status} (skipping deprecated entries) and fetch
 * the scheme document from {@link vocabularyUrl}.
 */
export interface ConformityCatalogueEntry {
  /** CVC-canonical scheme URI; from the register entry's `id`. */
  canonicalId: string;
  /** Owner-published scheme document URL; from the register entry's `vocabularyURL`. Validated as a parseable URL at parse time. */
  vocabularyUrl: string;
  /** Human-readable scheme name. */
  name: string;
  /** Lifecycle status of the scheme in the register, when supplied (`'pilot'`, `'active'`, `'deprecated'`, etc.). */
  status?: string;
}

/**
 * Warnings emitted by {@link validateConformityClaim}. Narrows
 * {@link StructuredWarning} so the `code` is one of the validator's known codes.
 */
export type ConformityWarning = StructuredWarning & { code: ConformityWarningCode };

// ---------------------------------------------------------------------------
// Claim validation
// ---------------------------------------------------------------------------

/**
 * A single criterion entry on a credential's conformity claim. The credential
 * issuer asserts conformity to `criterion` and may classify it with conformity
 * topics.
 */
export interface ConformityClaimCriterion {
  /** Criterion URI the claim references. */
  criterion: string;
  /**
   * Topic URIs the claim declares for this criterion. Optional and
   * version-specific: an extractor populates it only when its data model
   * carries criterion topics. A criterion may be classified by more than one
   * topic, so it is a list; when present, the validator checks every entry
   * against the criterion's published topic set.
   */
  conformityTopics?: string[];
}

/**
 * A single assessment entry on a credential's conformity claim: the criteria
 * the assessment references and the topics it declares for itself. The
 * declared topics are validated against the deduplicated union of the
 * published topics of the assessment's criteria, in one direction only: a
 * declared topic outside the union warns, while a union topic the assessment
 * does not declare is acceptable, because the assessment's topics are a
 * categorisation rather than an exhaustive enumeration.
 */
export interface ConformityClaimAssessment {
  /**
   * Criterion URIs the assessment references. Extractors must also emit every
   * entry here as a {@link ConformityClaimCriterion} in the claim's `criteria`
   * list: the validator's assessment check skips unresolved criteria on the
   * assumption that `conformity-criterion.not-in-profile` has already surfaced
   * them from `criteria`, so an entry present only here would silently escape
   * both checks.
   */
  criteria: string[];
  /** Topic URIs the assessment declares for itself. */
  conformityTopics: string[];
}

/**
 * A conformity claim extracted from a Digital Conformity Credential, in the
 * minimal shape the validator needs.
 *
 * This type is the version-neutral interlingua between the version-specific
 * data model bridge extractors and {@link validateConformityClaim}. Its fields
 * are optional capabilities keyed on presence, not on spec version: an
 * extractor populates a field only when its data model carries the concept,
 * and the validator runs a rule only when the data is present. Never repurpose
 * a field with changed semantics for a new spec version; add a new field, or
 * fork the validation rules into versioned modules (the delta pattern the
 * `parsers/` directory already uses) the first time a rule genuinely differs
 * between versions. A version conditional inside the shared validator is the
 * signal to fork, not a fix. See ADR-033 (update of 2026-07-13).
 */
export interface ConformityClaim {
  /** Scheme URI the claim references. */
  scheme: string;
  /**
   * Profile URI the claim references. Optional because not every data model
   * requires a profile reference. When absent, the validator checks the scheme
   * reference only and emits a `conformity-profile.not-specified` advisory,
   * since criteria are published per versioned profile.
   */
  profile?: string;
  /** Criteria the claim addresses. */
  criteria: ConformityClaimCriterion[];
  /**
   * Assessment-level topic declarations. Optional and version-specific: an
   * extractor populates it only when its data model classifies assessments by
   * topic.
   */
  assessments?: ConformityClaimAssessment[];
}
