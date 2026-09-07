/** Reported to the consumer each time a bundled artefact stands in for a failed fetch. */
export interface BundledFallbackEvent {
  /** The URL whose fetch failed. */
  url: string;
  /** The error the fetch failed with; the consumer's log should carry it. */
  cause: unknown;
}

/**
 * Options shared by the loaders that can fall back to the bundled artefacts.
 * The fallback is on by default: the artefacts are versioned and immutable
 * once published, so a running service should not depend on the publishing
 * host being up to read one. Set `bundledFallback: false` to make every
 * fetch failure surface as it did before the bundle existed.
 */
export interface BundledFallbackOptions {
  bundledFallback?: boolean;
  /** Called when a fetch failed and the bundled copy was served instead. */
  onBundledFallback?: (event: BundledFallbackEvent) => void;
}

const codeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;

/**
 * Whether a fetch failure is one the publishing host is responsible for: it
 * could not be reached, answered a non-2xx status, sent a body that is not
 * JSON, or exceeded the resolver's size, redirect or time bounds. Those are
 * the failures the bundle exists to cover. Two kinds are deliberately
 * excluded: a URL the SSRF guard refused (a `url.*` code anywhere on the
 * cause chain), because a bundled host resolving to a private address is a
 * signal the operator must see, and any error that is not a typed
 * resolver or loader failure, because a bug in the fetch path must not read
 * as an outage.
 */
export function isHostDeliveryFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth += 1) {
    if (codeOf(current)?.startsWith('url.')) return false;
    current = (current as { cause?: unknown }).cause;
  }
  const code = codeOf(error);
  return code !== undefined && (code.startsWith('resolver.') || code.startsWith('schema-loader.'));
}

/**
 * Runs `fetcher`; on a host-delivery failure (see {@link isHostDeliveryFailure}),
 * serves the bundled artefact for `url` when the fallback is enabled and the
 * bundle carries it, otherwise rethrows. A listener that throws never turns
 * a served fallback into a failure.
 */
export async function withBundledFallback<T extends object>(
  url: string,
  options: BundledFallbackOptions | undefined,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    return await fetcher();
  } catch (cause) {
    if (options?.bundledFallback === false || !isHostDeliveryFailure(cause)) throw cause;
    const { findBundledArtefact } = await import('./lookup.js');
    const bundled = await findBundledArtefact(url);
    if (bundled === undefined) throw cause;
    try {
      options?.onBundledFallback?.({ url, cause });
    } catch {
      // The consumer's listener failing must not hide a copy already in hand.
    }
    return bundled as T;
  }
}
