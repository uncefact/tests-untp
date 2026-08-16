import type { ConformityClaim } from '@uncefact/untp-utils/conformity-vocabulary';

// Bridge-specific CredentialSubject (object-only, NOT the VC payload union)
export type CredentialSubject = Record<string, unknown>;

// ── Entity types ──────────────────────────────────────────────────────────────

export type EntityIdentifier = { value: string; scheme: { id?: string; name?: string } | null };

export type OrganisationEntity = {
  id?: string;
  name?: string;
  description?: string;
  primaryIdentifier?: EntityIdentifier | null;
};

export type FacilityEntity = {
  id?: string;
  name?: string;
  description?: string;
  primaryIdentifier?: EntityIdentifier | null;
  location?: UntpLocation | null;
};

export type ProductLevel = 'MODEL' | 'BATCH' | 'ITEM';

export type ProductEntity = {
  id?: string;
  name?: string;
  description?: string;
  level?: ProductLevel;
  batchNumber?: string;
  serialNumber?: string;
  primaryIdentifier?: EntityIdentifier | null;
};

// ── UntpLocation ──────────────────────────────────────────────────────────────

export interface UntpLocation {
  address?: {
    streetAddress?: string;
    postalCode?: string;
    addressLocality?: string;
    addressRegion?: string;
    addressCountry?: string;
  };
  plusCode?: string;
  geoLocation?: { type: 'Point'; coordinates: [number, number] };
  geoBoundary?: { type: 'Polygon'; coordinates: [number, number][][] };
}

// ── Conformity input ──────────────────────────────────────────────────────────

export type ConformityInput = {
  scheme?: { id: string; name?: string };
  standard?: { id: string; name?: string };
  regulation?: { id: string; name?: string };
  criteria?: { id: string; name: string; conformityTopic?: string }[];
};

// ── Bridge entities (input to buildSubject) ──────────────────────────────────

export type TraceabilityEventInput = {
  eventType: 'object' | 'transformation' | 'aggregation' | 'transaction' | 'association';
  products?: ProductEntity[];
  inputProducts?: ProductEntity[];
  outputProducts?: ProductEntity[];
  parentProduct?: ProductEntity;
  childProducts?: ProductEntity[];
  sourceParty?: string;
  destinationParty?: string;
};

export type BridgeEntities = {
  organisation?: OrganisationEntity;
  facility?: FacilityEntity;
  product?: ProductEntity;
  conformity?: ConformityInput[];
  event?: TraceabilityEventInput;
};

// ── Data model config ─────────────────────────────────────────────────────────

export type DataModelConfig = {
  core: { contextUrl: string; credentialType: string };
  extension?: { contextUrl: string; credentialType: string };
};

// ── Extracted refs (output from extractRefs) ──────────────────────────────────

export type ExtractedRefs = {
  organisations: { id: string }[];
  facilities: { id: string }[];
  products: { id: string; batchNumber?: string; serialNumber?: string }[];
  conformity?: {
    schemeUrl?: string;
    standardUrls: string[];
    regulationUrls: string[];
    criteriaUrls: string[];
  };
};

export type ConformityRefs = NonNullable<ExtractedRefs['conformity']>;

// ── Bridge interface ──────────────────────────────────────────────────────────

export interface IDataModelBridge<TSubject extends CredentialSubject = CredentialSubject> {
  buildSubject(entities: BridgeEntities): TSubject;
  extractRefs(subject: TSubject): ExtractedRefs;
  /**
   * Extracts the conformity claim from the subject for conformity vocabulary
   * validation, or
   * `null` when the credential type / version carries no conformity claim
   * (only the Digital Conformity Credential does). Bridges without a claim
   * extractor return `null`.
   */
  extractConformityClaim(subject: TSubject): ConformityClaim | null;
  /**
   * Extracts the conformity claim together with a map from claim pointers to
   * the subject paths each projected value came from, or `null` on the same
   * terms as {@link IDataModelBridge.extractConformityClaim}: the credential
   * type carries no conformity claim, or this subject has none.
   *
   * The claim is a synthesised projection rather than a sub-document of the
   * credential: `criteria` is flattened across every assessment, and the
   * projection's field names and indices need not match the source. A warning
   * pointer therefore cannot be resolved against the submitted credential by
   * prepending a wrapper path, which is what this map exists to make possible
   * (#753).
   *
   * A version that extracts a claim but records no provenance returns that
   * claim with an empty map, so its claim is still validated and only the
   * pointers are missing. A consumer omits a pointer it cannot translate
   * rather than returning an untranslated one.
   */
  extractConformityClaimWithProvenance(subject: TSubject): ConformityClaimWithProvenance | null;
}

/**
 * A conformity claim together with the provenance of the values in it.
 *
 * `sourceMap` keys are JSON pointers into the claim, exactly as
 * `validateConformityClaim` emits them; values are JSON pointers into the
 * `credentialSubject` the claim was extracted from. Both follow RFC 6901.
 * Paths are subject-relative because the extractor is given the subject and
 * nothing above it, so a consumer holding the whole credential prepends its
 * own path to the subject.
 *
 * Entries are recorded per addressable value rather than per parent, because
 * a suffix appended to a parent's path can name the wrong value: topic entries
 * without a usable `id` are dropped while extracting, so a projected topic
 * index need not match its source index.
 */
export type ConformityClaimWithProvenance = {
  claim: ConformityClaim;
  sourceMap: ClaimSourceMap;
};

/** Claim JSON pointer to subject JSON pointer, per {@link ConformityClaimWithProvenance}. */
export type ClaimSourceMap = Record<string, string>;

// ── Internal types (not exported from index.ts) ───────────────────────────────

export type SubjectBuilder = (entities: BridgeEntities) => CredentialSubject;
export type RefsExtractor = (subject: CredentialSubject) => ExtractedRefs;
export type ConformityClaimExtractor = (subject: CredentialSubject) => ConformityClaim | null;
export type ConformityClaimProvenanceExtractor = (subject: CredentialSubject) => ConformityClaimWithProvenance | null;

export interface VersionSpec {
  builder: SubjectBuilder;
  extractor: RefsExtractor;
  /** Optional; only credential types carrying a conformity claim (DCC) set this. */
  conformityClaimExtractor?: ConformityClaimExtractor;
  /**
   * Optional; set by versions that record where each projected value came
   * from. A version setting this derives its
   * {@link VersionSpec.conformityClaimExtractor} from the same projection
   * rather than building the claim twice.
   */
  conformityClaimProvenanceExtractor?: ConformityClaimProvenanceExtractor;
}
