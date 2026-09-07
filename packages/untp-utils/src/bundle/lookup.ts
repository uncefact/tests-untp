/**
 * Lookup over the bundled UNTP artefacts (see `scripts/refresh-artefacts.mjs`
 * and `artefacts/manifest.json`). The bundle itself is imported lazily so a
 * consumer that never needs the fallback never loads it.
 */

/** Trailing-slash and scheme-case differences never mean a different artefact. */
export function normaliseArtefactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

let index: Promise<ReadonlyMap<string, Record<string, unknown>>> | undefined;

async function bundledByNormalisedUrl(): Promise<ReadonlyMap<string, Record<string, unknown>>> {
  if (!index) {
    index = import('./index.js').then(({ BUNDLED_ARTEFACTS }) => {
      const map = new Map<string, Record<string, unknown>>();
      for (const [url, artefact] of BUNDLED_ARTEFACTS) map.set(normaliseArtefactUrl(url), artefact);
      return map;
    });
  }
  return index;
}

/** The bundled copy of the artefact published at `url`, or `undefined` when the bundle does not carry it. */
export async function findBundledArtefact(url: string): Promise<Record<string, unknown> | undefined> {
  return (await bundledByNormalisedUrl()).get(normaliseArtefactUrl(url));
}
