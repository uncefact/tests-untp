import type { TtlCache } from '@uncefact/untp-utils/cache';
import type { LoadedRemoteDocument, SchemaLoader } from '@uncefact/untp-utils/loaders';
import type { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import type { ConformityScheme } from '@uncefact/untp-utils/conformity-vocabulary';
import type { ConformitySchemeResolveError } from './errors.js';

export const RESOLVE_FAILURE_STATUS = {
  FetchFailed: 'FETCH_FAILED',
  TooLarge: 'TOO_LARGE',
  InvalidJson: 'INVALID_JSON',
  SchemaInvalid: 'SCHEMA_INVALID',
  JsonLdExpansionFailed: 'JSONLD_EXPANSION_FAILED',
  ParseFailed: 'PARSE_FAILED',
  DigestFailed: 'DIGEST_FAILED',
} as const;

export type ResolveFailureStatus = (typeof RESOLVE_FAILURE_STATUS)[keyof typeof RESOLVE_FAILURE_STATUS];

/** Source category for a {@link ConformityScheme} row; mirrors the RI's `ConformitySchemeSource` Prisma enum. */
export type ConformitySchemeSource = 'UNTP' | 'SYSTEM_SEED' | 'TENANT_IMPORTED';

/**
 * Bytes the caller has on hand (typically a seed loader that has already read
 * from disk). When present, the function bypasses `resolveDocumentIfChanged`
 * and processes these bytes directly.
 */
export interface PrefetchedDocument {
  body: Uint8Array;
  etag?: string;
  lastModifiedHeader?: string;
}

/**
 * Previously-cached resource fields the function feeds to
 * `resolveDocumentIfChanged` for the conditional-fetch skip chain.
 */
export interface CachedResource {
  etag?: string;
  lastModifiedHeader?: string;
  bodyDigest?: MultibaseDigest;
}

/** @see {@link resolveAndParseConformityScheme} for the contract this input drives. */
export interface ResolveAndParseConformitySchemeInput {
  /** Also persisted as the row's `sourceUrl`; surfaced in error messages for triage. */
  sourceUrl: string;
  source: ConformitySchemeSource;
  /** Use the system tenant id for `UNTP` / `SYSTEM_SEED` sources. */
  tenantId: string;
  /**
   * URL of the `ConformityScheme.json` JSON Schema the document must
   * conform to. The RI resolves this from its `DataModel` table by
   * `(credentialType: 'ConformityScheme', version: conformityVocabularySpecVersion ?? '0.7.0')`.
   */
  conformitySchemaUrl: string;
  /** Loader used by the inner `validateAgainstSchemas` call to fetch the JSON Schema. */
  schemaLoader: SchemaLoader;
  /** When present, bypasses `resolveDocumentIfChanged` and processes these bytes directly. */
  prefetched?: PrefetchedDocument;
  /**
   * Validators from the previous successful run. On the fetched path all
   * three feed the conditional-fetch skip chain; on the prefetched path the
   * HTTP validators are ignored but `bodyDigest` is still compared locally,
   * so unchanged bytes return `unchanged` without a parse or persist.
   */
  cached?: CachedResource;
  /** Override the spec-version detection that `parseConformityScheme` performs from `@context`. */
  conformityVocabularySpecVersion?: string;
  /**
   * Optional shared cache for remote JSON-LD `@context` documents, forwarded
   * to `validateJsonLd` so a pass over many schemes fetches each context once
   * per TTL instead of once per scheme. Same cache contract as the issuance
   * path's (see the reference implementation's `context-cache.ts`).
   */
  contextCache?: TtlCache<LoadedRemoteDocument>;
}

/** Outcome of a successful run; everything the caller needs to upsert the row. */
export interface ResolveAndParseConformitySchemeSuccess {
  kind: 'success';
  scheme: ConformityScheme;
  /** Raw resolved JSON-LD document, ready to persist on `ConformityScheme.rawDocument`. */
  raw: unknown;
  bodyDigest: MultibaseDigest;
  etag?: string;
  lastModifiedHeader?: string;
}

/** The skip chain hit; persist `lastFetchedAt` only and retain previous content. */
export interface ResolveAndParseConformitySchemeUnchanged {
  kind: 'unchanged';
}

/** A gate failed; persist `lastFetchStatus` from `error.status` and retain previous content. */
export interface ResolveAndParseConformitySchemeFailure {
  kind: 'failure';
  error: ConformitySchemeResolveError;
}

export type ResolveAndParseConformitySchemeResult =
  | ResolveAndParseConformitySchemeSuccess
  | ResolveAndParseConformitySchemeUnchanged
  | ResolveAndParseConformitySchemeFailure;
