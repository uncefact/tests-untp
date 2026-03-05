import type { CredentialPayload, CredentialSubject } from '../verifiable-credential/types.js';

// ── Entity types (minimal projections) ──────────────────────────────────────

export type EntityIdentifier = {
  value: string;
  scheme: { id?: string; name?: string } | null;
};

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

export type ResolvedEntities = {
  organisation?: OrganisationEntity;
  facility?: FacilityEntity;
  product?: ProductEntity;
};

// ── UntpLocation ────────────────────────────────────────────────────────────

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

// ── Data model config ───────────────────────────────────────────────────────

export type DataModelConfig = {
  core: { contextUrl: string; credentialType: string };
  extension?: { contextUrl: string; credentialType: string };
};

// ── Mapper output ───────────────────────────────────────────────────────────

export type MapperOutput = {
  '@context': string[];
  type: string[];
  credentialSubject: CredentialSubject;
};

// ── Extracted identifier refs ───────────────────────────────────────────────

export type ExtractedIdentifierRefs = {
  primaryIdentifier?: string;
  product?: { registeredId: string; batchNumber?: string; serialNumber?: string };
  organisation?: { registeredId: string };
  facility?: { registeredId: string };
};

// ── Extracted CVC refs ──────────────────────────────────────────────────────

export type ExtractedCvcRefs = {
  scopeUrl?: string;
  criteriaUrls: string[];
};

// ── Mapper interface ────────────────────────────────────────────────────────

export interface ICredentialMapper {
  buildPayload(entities: ResolvedEntities, config: DataModelConfig): Promise<MapperOutput>;
  extractEntityRefs(payload: MapperOutput): ExtractedIdentifierRefs;
}

export interface ICvcAwareMapper {
  extractCvcRefs(credentialPayload: CredentialPayload): ExtractedCvcRefs;
}
