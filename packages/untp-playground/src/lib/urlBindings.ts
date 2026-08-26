import type { ArtefactSlot, InstanceId } from '@/types/artefact';

/**
 * URL-to-instance bindings for credentials ingested from a URL (#812).
 *
 * The credentials collection identifies instances by content hash (ADR-041), so "which instance
 * did this URL produce most recently" cannot be derived from the collection itself: content drift
 * at one URL appends a second instance, and identical content at two URLs replaces in place while
 * rewriting the stored source. The bindings record causal recency instead: every accepted URL
 * ingestion (uploader fetch or link set Verify) overwrites its URLs' entries, so a binding always
 * names the instance the latest ingestion of that URL produced. A Map keyed by untrusted resolver
 * hrefs, never a plain object, so prototype names cannot collide.
 */
export type UrlBindings = ReadonlyMap<string, InstanceId>;

export const emptyUrlBindings: UrlBindings = new Map();

/** Returns new bindings with each url pointing at the instance; later recordings win. */
export function recordUrlBinding(
  bindings: UrlBindings,
  urls: Array<string | undefined>,
  instanceId: InstanceId,
): UrlBindings {
  const next = new Map(bindings);
  for (const url of urls) {
    if (typeof url === 'string' && url.length > 0) next.set(url, instanceId);
  }
  return next;
}

/**
 * The instance a URL's latest accepted ingestion produced, or undefined when the URL was never
 * ingested or its instance has since been removed (fail open: a stale binding must read as
 * unbound, not point a settled note at nothing).
 */
export function resolveBoundInstance<P, R>(
  bindings: UrlBindings,
  url: string,
  items: ReadonlyArray<ArtefactSlot<P, R>>,
): ArtefactSlot<P, R> | undefined {
  const instanceId = bindings.get(url);
  if (!instanceId) return undefined;
  return items.find((item) => item.instanceId === instanceId);
}

/** Returns new bindings with every URL that pointed at fromId now pointing at toId (#813 merge). */
export function remapUrlBindings(bindings: UrlBindings, fromId: InstanceId, toId: InstanceId): UrlBindings {
  const next = new Map(bindings);
  for (const [url, instanceId] of next) {
    if (instanceId === fromId) next.set(url, toId);
  }
  return next;
}
