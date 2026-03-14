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

// ── Resolved entities (input to buildSubject) ─────────────────────────────────

export type ResolvedEntities = {
  organisation?: OrganisationEntity;
  facility?: FacilityEntity;
  product?: ProductEntity;
  conformity?: ConformityInput[];
};

// ── Data model config ─────────────────────────────────────────────────────────

export type DataModelConfig = {
  core: { contextUrl: string; credentialType: string };
  extension?: { contextUrl: string; credentialType: string };
};

// ── Extracted refs (output from extractRefs) ──────────────────────────────────

export type ExtractedRefs = {
  organisation?: { id: string };
  facility?: { id: string };
  product?: { id: string; batchNumber?: string; serialNumber?: string };
  conformity?: {
    schemeUrl?: string;
    standardUrls: string[];
    regulationUrls: string[];
    criteriaUrls: string[];
  };
};

// ── Bridge interface ──────────────────────────────────────────────────────────

export interface IDataModelBridge {
  buildSubject(entities: ResolvedEntities): CredentialSubject;
  extractRefs(subject: CredentialSubject): ExtractedRefs;
}

// ── Internal types (not exported from index.ts) ───────────────────────────────

export type SubjectBuilder = (entities: ResolvedEntities) => CredentialSubject;
export type RefsExtractor = (subject: CredentialSubject) => ExtractedRefs;

export interface VersionSpec {
  builder: SubjectBuilder;
  extractor: RefsExtractor;
}
