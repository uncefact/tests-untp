/**
 * Public entry for the bundled UNTP and VCDM artefacts
 * (`@uncefact/untp-utils/bundled-artefacts`).
 *
 * The loaders use these copies as a fallback when a fetch fails; a consumer
 * can also read them directly, for example to validate against a schema
 * without any network access. Keyed by the URL the artefact is published at,
 * which is the URL a credential or link set references. The bundle is around
 * a megabyte and loads on first use, not at import.
 */
import { findBundledArtefact } from './lookup.js';

export { findBundledArtefact, normaliseArtefactUrl } from './lookup.js';
export { isHostDeliveryFailure } from './fallback.js';
export type { BundledFallbackEvent, BundledFallbackOptions } from './fallback.js';

/** Every bundled artefact keyed by its published URL (and each alias it is also published under), as fresh clones. */
export async function loadBundledArtefacts(): Promise<ReadonlyMap<string, Record<string, unknown>>> {
  const { BUNDLED_ARTEFACTS } = await import('./index.js');
  return new Map([...BUNDLED_ARTEFACTS].map(([url, artefact]) => [url, structuredClone(artefact)]));
}

/** UNTP versions the bundle carries, ascending (for example `['0.6.0', '0.6.1', '0.7.0']`). */
export async function bundledUntpVersions(): Promise<readonly string[]> {
  const { BUNDLED_UNTP_VERSIONS } = await import('./index.js');
  return BUNDLED_UNTP_VERSIONS;
}

/**
 * The bundled JSON Schema for a UNTP credential type and version, for example
 * `bundledSchema('DigitalProductPassport', '0.6.0')`, or `undefined` when the
 * bundle does not carry that version. `type` accepts the names
 * `buildUntpArtefactUrls` accepts.
 */
export async function bundledSchema(type: string, version: string): Promise<Record<string, unknown> | undefined> {
  const { buildUntpArtefactUrls } = await import('../artefacts/urls.js');
  return findBundledArtefact(buildUntpArtefactUrls(type, version).schemaUrl);
}

/**
 * The bundled JSON-LD context a UNTP credential type declares at a version:
 * the per-type context before 0.7.0, the unified UNTP context from 0.7.0.
 */
export async function bundledContext(type: string, version: string): Promise<Record<string, unknown> | undefined> {
  const { buildUntpArtefactUrls } = await import('../artefacts/urls.js');
  return findBundledArtefact(buildUntpArtefactUrls(type, version).contextUrl);
}

/** The bundled Identity Resolver link set schema for a UNTP version (published from 0.7.0). */
export async function bundledLinkSetSchema(version: string): Promise<Record<string, unknown> | undefined> {
  const { buildLinkSetSchemaUrl } = await import('../artefacts/urls.js');
  return findBundledArtefact(buildLinkSetSchemaUrl(version));
}

/** The W3C Verifiable Credentials Data Model context for a major version (`'2'` today). */
export async function bundledVcdmContext(version: '2'): Promise<Record<string, unknown> | undefined> {
  return findBundledArtefact(`https://www.w3.org/ns/credentials/v${version}`);
}

/** The W3C Verifiable Credentials Data Model JSON Schema for a major version (`'2'` today). */
export async function bundledVcdmSchema(version: '2'): Promise<Record<string, unknown> | undefined> {
  void version;
  return findBundledArtefact(
    'https://w3c.github.io/vc-data-model/schema/verifiable-credential/verifiable-credential-schema.json',
  );
}
