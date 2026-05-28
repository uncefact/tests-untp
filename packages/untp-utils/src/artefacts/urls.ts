/**
 * Construction of UNTP artefact URLs (JSON Schema and JSON-LD context) for a
 * given credential / artefact type and spec version.
 *
 * UNTP v0.7.0 relocated the artefacts. Schemas moved from the legacy
 * per-credential-type layout on `test.uncefact.org` to the unece.org
 * artefacts origin, and the JSON-LD context was unified into a single
 * per-version context on `vocabulary.uncefact.org` (the same context URL for
 * every type, including the Conformity Vocabulary Catalogue `ConformityScheme`
 * artefact, which was introduced in v0.7.0). Earlier versions (v0.6.x)
 * continue to be served from the legacy layout. This is the forward
 * counterpart to {@link detectVersionFromContext}, which derives the version
 * from a context URL.
 *
 * @see https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json
 * @see https://vocabulary.uncefact.org/untp/0.7.0/context/
 */

import { isV070OrAbove } from './version.js';

const LEGACY_BASE = 'https://test.uncefact.org/vocabulary/untp';
const ARTEFACTS_SCHEMA_BASE = 'https://untp.unece.org/artefacts/schema';
const UNIFIED_CONTEXT_BASE = 'https://vocabulary.uncefact.org/untp';

/** Short artefact codes used in UNTP artefact paths, keyed by credential / artefact type. */
export const UNTP_SHORT_CREDENTIAL_TYPES: Record<string, string> = {
  DigitalProductPassport: 'dpp',
  DigitalConformityCredential: 'dcc',
  DigitalTraceabilityEvent: 'dte',
  DigitalFacilityRecord: 'dfr',
  DigitalIdentityAnchor: 'dia',
  ConformityScheme: 'cvc',
};

/**
 * v0.7.0+ core schema file names keyed by credential / artefact type. Most
 * match the type verbatim; `DigitalConformityCredential` is published as
 * `ConformityCredential`.
 */
export const UNTP_CORE_SCHEMA_FILENAMES: Record<string, string> = {
  DigitalProductPassport: 'DigitalProductPassport',
  DigitalConformityCredential: 'ConformityCredential',
  DigitalTraceabilityEvent: 'DigitalTraceabilityEvent',
  DigitalFacilityRecord: 'DigitalFacilityRecord',
  DigitalIdentityAnchor: 'DigitalIdentityAnchor',
  ConformityScheme: 'ConformityScheme',
};

const DOCS_BASE = 'https://untp.unece.org/docs';

/**
 * UNTP specification page slugs keyed by credential / artefact type. Slugs are
 * version-independent. Several differ from the credential type name:
 * `DigitalConformityCredential` is documented at `ConformityCredential`,
 * `DigitalTraceabilityEvent` at the plural `DigitalTraceabilityEvents`, and
 * `ConformityScheme` at `ConformityVocabularyCatalog`.
 */
export const UNTP_SPECIFICATION_PAGE_SLUGS: Record<string, string> = {
  DigitalProductPassport: 'DigitalProductPassport',
  DigitalConformityCredential: 'ConformityCredential',
  DigitalTraceabilityEvent: 'DigitalTraceabilityEvents',
  DigitalFacilityRecord: 'DigitalFacilityRecord',
  DigitalIdentityAnchor: 'DigitalIdentityAnchor',
  ConformityScheme: 'ConformityVocabularyCatalog',
};

/**
 * The UNTP docs version currently served at the unversioned ("current") docs
 * path. This version is linked at `/docs/specification/<slug>`; older versions
 * are linked at `/docs/<version>/specification/<slug>`.
 *
 * Maintenance point: update this when UNTP promotes a newer docs version to
 * current. The previously-current version then gains its own
 * `/docs/<version>/` path, so this constant moving keeps existing links
 * pointing at the right version.
 */
export const CURRENT_UNTP_DOCS_VERSION = '0.7.0';

/**
 * Versions that ship no docs of their own, mapped to the published docs
 * version that covers them. UNTP released 0.6.1 schemas without separate
 * 0.6.1 docs; the 0.6.0 docs document the whole 0.6.x line.
 */
const DOCS_VERSION_FALLBACKS: Record<string, string> = {
  '0.6.1': '0.6.0',
};

/**
 * Builds the human-readable UNTP specification page URL for a credential /
 * artefact type at a given version.
 *
 * The current docs version ({@link CURRENT_UNTP_DOCS_VERSION}) is served at
 * the unversioned `/docs/specification/<slug>` path; older versions resolve to
 * `/docs/<version>/specification/<slug>`. Versions without their own docs fall
 * back to the nearest published docs version (see `DOCS_VERSION_FALLBACKS`).
 *
 * @param type - UNTP credential / artefact type (e.g. `DigitalProductPassport`).
 * @param version - Semantic version of the artefact (e.g. `0.7.0`).
 * @returns The specification page URL.
 * @throws {Error} When `type` is not a recognised UNTP artefact type.
 */
export function buildSpecificationPageUrl(type: string, version: string): string {
  const slug = UNTP_SPECIFICATION_PAGE_SLUGS[type];
  if (!slug) {
    throw new Error(
      `Unknown UNTP artefact type "${type}". Expected one of: ${Object.keys(UNTP_SPECIFICATION_PAGE_SLUGS).join(
        ', ',
      )}.`,
    );
  }

  const docsVersion = DOCS_VERSION_FALLBACKS[version] ?? version;
  if (docsVersion === CURRENT_UNTP_DOCS_VERSION) {
    return `${DOCS_BASE}/specification/${slug}`;
  }
  return `${DOCS_BASE}/${docsVersion}/specification/${slug}`;
}

/** The schema and context URLs for a UNTP artefact. */
export interface UntpArtefactUrls {
  /** URL of the JSON Schema the document validates against. */
  schemaUrl: string;
  /** URL of the JSON-LD context the document references in `@context`. */
  contextUrl: string;
}

/**
 * Builds the JSON Schema and JSON-LD context URLs for a UNTP artefact.
 *
 * `ConformityScheme` was introduced in v0.7.0 and has no legacy layout; only
 * call it with a v0.7.0+ version.
 *
 * @param type - UNTP credential / artefact type (e.g. `DigitalProductPassport`,
 *   `ConformityScheme`). Must be a recognised type.
 * @param version - Semantic version of the artefact (e.g. `0.7.0`).
 * @returns The {@link UntpArtefactUrls} appropriate for the version.
 * @throws {Error} When `type` is not a recognised UNTP artefact type.
 */
export function buildUntpArtefactUrls(type: string, version: string): UntpArtefactUrls {
  const shortCode = UNTP_SHORT_CREDENTIAL_TYPES[type];
  if (!shortCode) {
    throw new Error(
      `Unknown UNTP artefact type "${type}". Expected one of: ${Object.keys(UNTP_SHORT_CREDENTIAL_TYPES).join(', ')}.`,
    );
  }

  if (isV070OrAbove(version)) {
    const fileName = UNTP_CORE_SCHEMA_FILENAMES[type];
    return {
      schemaUrl: `${ARTEFACTS_SCHEMA_BASE}/v${version}/${shortCode}/${fileName}.json`,
      contextUrl: `${UNIFIED_CONTEXT_BASE}/${version}/context/`,
    };
  }

  return {
    schemaUrl: `${LEGACY_BASE}/${shortCode}/untp-${shortCode}-schema-${version}.json`,
    contextUrl: `${LEGACY_BASE}/${shortCode}/${version}/context/`,
  };
}
