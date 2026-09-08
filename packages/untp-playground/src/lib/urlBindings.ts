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

/**
 * Returns bindings with each url pointing at the instance; later recordings win. When every url
 * already points at the instance the same Map comes back, so a repeat Verify of an href that is
 * already bound does not read as a change downstream (the report resets on binding identity, #814).
 */
export function recordUrlBinding(
  bindings: UrlBindings,
  urls: Array<string | undefined>,
  instanceId: InstanceId,
): UrlBindings {
  const wanted = urls.filter((url): url is string => typeof url === 'string' && url.length > 0);
  if (wanted.every((url) => bindings.get(url) === instanceId)) return bindings;
  const next = new Map(bindings);
  for (const url of wanted) next.set(url, instanceId);
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

/**
 * Forgets a URL's binding (#1007). A Verify of an already-bound href that produces no accepted
 * credential (the fetch failed, or the body was refused) is evidence that the previous result no
 * longer describes what is at the URL, so the row fails open to Verify and coverage reverts to
 * pending instead of repeating a stale match.
 */
export function dropUrlBinding(bindings: UrlBindings, url: string): UrlBindings {
  if (!bindings.has(url)) return bindings;
  const next = new Map(bindings);
  next.delete(url);
  return next;
}

/** Returns new bindings with every URL that pointed at fromId now pointing at toId (#813 merge). */
export function remapUrlBindings(bindings: UrlBindings, fromId: InstanceId, toId: InstanceId): UrlBindings {
  const next = new Map(bindings);
  for (const [url, instanceId] of next) {
    if (instanceId === fromId) next.set(url, toId);
  }
  return next;
}
